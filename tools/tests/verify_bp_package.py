#!/usr/bin/env python3
"""Verify pinned phone assets and run all 189 synthetic candidates on host ORT.

Requires Node, NumPy and onnxruntime==1.19.2. This runs on the host computer,
not an iPhone; no physical-device timing, energy or BP-accuracy claim follows.
"""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import subprocess
import sys

EXPECTED = {
    "python code/cBP-Tnet_Model.pth": "2cabfe0c64bf2463495d9581dea837638c41c149948abd9730b8b6be25fd0169",
    "assets/models/onnx_export/cbp_tnet.onnx": "a8e26e25b852344814e4a474e73e92b9f8d40845c20948fdcce828c9e4f12fce",
    "assets/models/onnx_export/normalization.json": "bc8a28b7ca84faa00644fa7d13ae706705ecd47b9543296753273555be3aba41",
    "assets/ppg-expanded/full_ppg_reference_v1.json": "88e4ad195fe39cfdaebfa8f7c2cb7b76d0d29b9fd3fa63f61c7d3eae81d0117e",
}


def digest(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for block in iter(lambda: f.read(1048576), b""):
            h.update(block)
    return h.hexdigest()


def verify(project):
    import numpy as np
    import onnxruntime as ort
    project = Path(project).resolve()
    hashes = {name: digest(project / name) for name in EXPECTED}
    if hashes != EXPECTED:
        raise ValueError("Model/normalization/reference bytes differ from the pinned tested package.")
    node_source = r"""
const path=require('node:path');
const root=process.argv[1];
const core=require(path.join(root,'services/bpExpandedCore.js'));
const r=require(path.join(root,'assets/ppg-expanded/full_ppg_reference_v1.json'));
core.validate(r);
const windows=r.windows.map(w=>{
 const p=core.prepare(core.rotated(r.raw,w.offsetSamples),w,r.normalization);
 return {offset:w.offsetSamples,maxRaw:p.maxRaw,maxTiming:p.maxTiming,
 maxNormalized:p.maxNormalized,
 inputs:p.inputs.map(x=>({beat:Array.from(x.beat),timing:Array.from(x.timing)})),
 expected:w.outputs};
});
process.stdout.write(JSON.stringify(windows));
"""
    generated = subprocess.run(["node", "-e", node_source, str(project)],
                               check=True, capture_output=True, text=True, timeout=60)
    windows = json.loads(generated.stdout)
    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    options.inter_op_num_threads = 1
    session = ort.InferenceSession(str(project / "assets/models/onnx_export/cbp_tnet.onnx"),
                                   sess_options=options, providers=["CPUExecutionProvider"])
    assert [x.name for x in session.get_inputs()] == ["beat", "timing"]
    assert [x.name for x in session.get_outputs()] == ["bp"]
    rows, overall, count = [], np.zeros(2), 0
    for w in windows:
        errors = []
        for inputs, expected in zip(w["inputs"], w["expected"], strict=True):
            feed = {"beat": np.asarray(inputs["beat"], dtype=np.float32).reshape(1, 3, 250),
                    "timing": np.asarray(inputs["timing"], dtype=np.float32).reshape(1, 2)}
            value = session.run(["bp"], feed)[0]
            assert value.shape == (1, 2) and value.dtype == np.float32 and np.isfinite(value).all()
            error = np.abs(value[0].astype(np.float64) - np.array(expected))
            if np.any(error > .01):
                raise AssertionError(f"Output mismatch in window {w['offset']} candidate {len(errors)}")
            errors.append(error)
            count += 1
        maximum = np.max(errors, axis=0)
        overall = np.maximum(overall, maximum)
        rows.append({"offset_samples": w["offset"], "candidates": len(errors),
                     "max_output_difference_mmhg": maximum.tolist(),
                     "max_raw_difference": w["maxRaw"], "max_timing_difference": w["maxTiming"],
                     "max_normalized_difference": w["maxNormalized"]})
    assert count == 189 and rows[0]["candidates"] == 31 and len(rows) == 6
    source_hashes = {name: digest(project / name) for name in
                     ("services/bpExpandedCore.js", "services/bpPpgPreprocess.js",
                      "tools/tests/verify_bp_package.py")}
    return {"schema_version": 1, "scope": "Actual host CPU ONNX inference from repository JS preprocessing; not an iPhone run.",
            "passed": True, "synthetic": True, "calls": count, "windows": rows,
            "max_output_difference_mmhg": overall.tolist(), "tolerance_mmhg": .01,
            "python": platform.python_version(), "numpy": np.__version__, "onnxruntime": ort.__version__,
            "platform": platform.system(), "execution_provider": "CPUExecutionProvider", "threads": 1,
            "asset_sha256": hashes, "source_sha256": source_hashes,
            "physical_device_run": False, "bp_accuracy_evaluated": False,
            "memory_measured": False, "energy_measured": False}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    report = verify(args.project)
    content = json.dumps(report, indent=2, allow_nan=False) + "\n"
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        with args.report.open("x") as f:
            f.write(content)
    print(content, end="")

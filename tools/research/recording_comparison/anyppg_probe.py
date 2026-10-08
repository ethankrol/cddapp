#!/usr/bin/env python3
"""Optional, provenance-pinned frozen AnyPPG encoder + recording-level ridge probe.

No dataset download, pretraining, fine-tuning, test split, calibration or phone update.
This is an exploratory arm: MIMIC overlap with encoder pretraining is unresolved.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import time
import traceback
import math
import urllib.request

import numpy as np

COMMIT = "661b877aa96eac3bba320a462cb2a3bfea991103"
REPOSITORY = "https://github.com/PKUDigitalHealth/AnyPPG"
FILES = {
    "resnet1d.py": "2a6e1761c057820601c3085a493ee23fa0b2f3aef7c4d9812d54558d6ffe73c2",
    "anyppg_ckpt.pth": "99b9bb0a3c2b83a1f5d8ca2963fbd25329b6530e8d337de8825722fc6fd5f4fa",
}
ALPHAS = (0.1, 1.0, 10.0, 100.0)
LABEL_CONTRACT = "provided_recording_labels_sbp_dbp_semantics_uncertified_v1"
IDENTITY_CONTRACT = "named_train_val_lists_disjoint_global_numeric_ids_v1"


class BudgetExceeded(RuntimeError):
    pass


def check_budget(deadline):
    if deadline is not None and time.monotonic() >= deadline:
        raise BudgetExceeded("Declared worker wall-time budget reached.")
OVERLAP = (
    "AnyPPG pretraining includes PulseDB/MIMIC-III. Patient overlap with this "
    "MIMIC-derived cohort is unresolved. Results are exploratory development "
    "metrics, not certified performance on patients unseen during pretraining."
)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def write_json(path, value):
    path = Path(path)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n")
    temporary.replace(path)


def fetch_encoder(directory):
    """Fetch only two pinned, checksum-verified public files; never replace others."""
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    for name, expected in FILES.items():
        path = directory / name
        if path.exists():
            require(sha256(path) == expected, f"Existing {name} hash mismatch; not replaced.")
            continue
        url = f"https://raw.githubusercontent.com/PKUDigitalHealth/AnyPPG/{COMMIT}/load_anyppg/{name}"
        temporary = directory / (name + f".download-{os.getpid()}")
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "CDD-research-probe/1"})
            with urllib.request.urlopen(request, timeout=60) as response, temporary.open("xb") as handle:
                total = 0
                while True:
                    block = response.read(1024 * 1024)
                    if not block:
                        break
                    total += len(block)
                    require(total <= 32 * 1024 * 1024, "Pinned artifact exceeded the size limit.")
                    handle.write(block)
            require(sha256(temporary) == expected, f"Downloaded {name} hash mismatch.")
            # Refuse a competing writer's file rather than overwrite it.
            with path.open("xb") as destination, temporary.open("rb") as source:
                for block in iter(lambda: source.read(1024 * 1024), b""):
                    destination.write(block)
        finally:
            temporary.unlink(missing_ok=True)
    return {name: sha256(directory / name) for name in FILES}


def load_encoder(directory, device="cpu"):
    import torch

    directory = Path(directory)
    for name, expected in FILES.items():
        require(sha256(directory / name) == expected, f"Pinned author file differs: {name}")
    specification = importlib.util.spec_from_file_location("cdd_pinned_anyppg", directory / "resnet1d.py")
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    model = module.Net1D(
        in_channels=1, base_filters=64, ratio=1.0,
        filter_list=[64, 160, 160, 400, 400, 512],
        m_blocks_list=[2, 2, 2, 3, 3, 1], kernel_size=3,
        stride=2, groups_width=16, use_bn=True, use_do=True, verbose=False,
    )
    state = torch.load(directory / "anyppg_ckpt.pth", map_location="cpu", weights_only=True)
    model.load_state_dict(state, strict=True)
    model.eval().requires_grad_(False).to(device)
    return model


def chunk_and_standardize(recordings):
    """N x 1 x 3750 -> (N*3) x 1 x 1250; ddof=0 temporal z-score."""
    values = np.asarray(recordings, dtype=np.float64)
    require(values.ndim == 3 and values.shape[1:] == (1, 3750), "Expected N x 1 x 3750 raw PPG.")
    require(len(values) > 0 and np.isfinite(values).all(), "Empty or non-finite PPG.")
    chunks = values.reshape(-1, 1, 1250)
    means = chunks.mean(axis=-1, keepdims=True)
    stds = chunks.std(axis=-1, keepdims=True, ddof=0)
    require((stds > 1e-12).all(), "At least one 10-second chunk is constant; no silent cohort removal.")
    return np.ascontiguousarray((chunks - means) / (stds + 1e-8), dtype=np.float32)


def encode_recordings(model, recordings, device="cpu", batch_size=32, deadline=None):
    import torch

    require(batch_size > 0, "batch_size must be positive.")
    require(not model.training, "Encoder must be in evaluation mode.")
    result = np.empty((len(recordings), 512), dtype=np.float32)
    with torch.inference_mode():
        for start in range(0, len(recordings), batch_size):
            check_budget(deadline)
            stop = min(start + batch_size, len(recordings))
            chunks = chunk_and_standardize(recordings[start:stop])
            features = model(torch.from_numpy(chunks).to(device)).cpu().numpy()
            check_budget(deadline)
            require(features.shape == ((stop - start) * 3, 512), "Unexpected encoder feature shape.")
            require(np.isfinite(features).all(), "Non-finite encoder features.")
            result[start:stop] = features.reshape(stop - start, 3, 512).mean(axis=1)
    return result


def fit_ridge(train_x, train_y, alpha):
    """Train-only standardization, intercept, and positive-penalty ridge solution."""
    x, y = np.asarray(train_x, dtype=np.float64), np.asarray(train_y, dtype=np.float64)
    require(x.ndim == 2 and y.shape == (len(x), 2) and len(x) >= 2, "Invalid ridge train arrays.")
    require(np.isfinite(x).all() and np.isfinite(y).all(), "Non-finite ridge train arrays.")
    require(np.isfinite(alpha) and alpha > 0, "alpha must be positive and finite.")
    mean, std, target_mean = x.mean(axis=0), x.std(axis=0), y.mean(axis=0)
    std = np.where(std > 1e-12, std, 1.0)
    z = (x - mean) / std
    system = z.T @ z + alpha * np.eye(z.shape[1])
    coefficients = np.linalg.solve(system, z.T @ (y - target_mean))
    return {"feature_mean": mean, "feature_std": std, "target_mean": target_mean, "coefficients": coefficients}


def predict_ridge(model, features):
    x = np.asarray(features, dtype=np.float64)
    require(x.ndim == 2 and np.isfinite(x).all(), "Invalid ridge inference arrays.")
    return ((x - model["feature_mean"]) / model["feature_std"]) @ model["coefficients"] + model["target_mean"]


def metrics(targets, predictions, patients):
    actual, predicted = np.asarray(targets, dtype=np.float64), np.asarray(predictions, dtype=np.float64)
    require(actual.shape == predicted.shape and actual.ndim == 2 and actual.shape[1] == 2,
            "Metric shapes differ.")
    require(np.isfinite(actual).all() and np.isfinite(predicted).all(), "Non-finite metric arrays.")
    ids, inverse = np.unique(patients, return_inverse=True)
    counts = np.bincount(inverse)
    result = {}
    for column, label in enumerate(("SBP", "DBP")):
        a, p = actual[:, column], predicted[:, column]
        error = p - a
        correlation = None
        if np.std(a) > 1e-12 and np.std(p) > 1e-12:
            correlation = float(np.corrcoef(a, p)[0, 1])
        result[label] = {
            "mae": float(np.mean(np.abs(error))), "mean_error": float(error.mean()),
            "correlation": correlation, "prediction_sd": float(np.std(p)),
            "target_sd": float(np.std(a)),
            "patient_macro_mae": float((np.bincount(inverse, weights=np.abs(error)) / counts).mean()),
        }
    return {"recording_count": len(actual), "patient_count": len(ids), "outputs": result}


def load_prepared(directory):
    """Load only fresh train/validation recording arrays, never the test split."""
    directory = Path(directory).resolve()
    manifest_path = directory / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    require(manifest.get("schema_version") == 1 and manifest.get("complete") is True,
            "Preparation manifest must be schema 1 and complete=true.")
    require(manifest.get("label_contract") == LABEL_CONTRACT, "Wrong recording-label contract.")
    require(manifest.get("identity_contract") == IDENTITY_CONTRACT, "Wrong patient-identity contract.")
    require(manifest.get("sampling_rate_hz") == 125 and manifest.get("samples_per_recording") == 3750
            and manifest.get("input_channels") == 1, "Expected one-channel 30-second recordings at 125 Hz.")
    require(manifest.get("output_order") == ["SBP", "DBP"] and "raw" in manifest.get("arms", []),
            "Missing raw arm or wrong output order.")
    hashes, arrays = {"manifest.json": sha256(manifest_path)}, {}
    for split in ("train", "val"):
        for key in (f"X_raw_{split}", f"y_{split}", f"patient_{split}", f"row_{split}"):
            name = key + ".npy"
            descriptor = manifest["arrays"].get(name)
            path = directory / name
            require(isinstance(descriptor, dict) and path.is_file() and path.resolve().parent == directory,
                    f"Missing declared local input: {name}")
            hashes[name] = sha256(path)
            require(hashes[name] == descriptor.get("sha256"), f"Prepared input hash mismatch: {name}")
            array = np.load(path, mmap_mode="r", allow_pickle=False)
            require(list(array.shape) == descriptor.get("shape") and str(array.dtype) == descriptor.get("dtype"),
                    f"Prepared input metadata mismatch: {name}")
            arrays[key] = array
        x, y, subjects, rows = (arrays[f"{prefix}_{split}"] for prefix in ("X_raw", "y", "patient", "row"))
        n = len(x)
        require(n >= 2 and n == manifest["split_counts"][split], "Unexpected recording count.")
        require(x.shape == (n, 1, 3750) and x.dtype == np.float32, "Unexpected recording shape/dtype.")
        require(y.shape == (n, 2) and y.dtype == np.float32, "Unexpected label shape/dtype.")
        require(np.isfinite(y).all() and np.all(y[:, 0] > y[:, 1]) and np.all(y[:, 1] > 0), "Invalid BP targets.")
        for values in (subjects, rows):
            require(values.shape == (n,) and values.dtype == np.int64 and np.all(values >= 0), "Invalid identity array.")
        require(len(np.unique(rows)) == n and np.array_equal(rows // 30, subjects), "Invalid recording identity mapping.")
        for start in range(0, n, 256):
            require(np.isfinite(x[start:start + 256]).all(), "Non-finite waveform.")
    for prefix in ("patient", "row"):
        require(np.intersect1d(arrays[f"{prefix}_train"], arrays[f"{prefix}_val"]).size == 0,
                f"Train/validation {prefix} identities overlap.")
    return manifest, arrays, hashes


def provenance():
    import torch

    return {
        "repository": REPOSITORY, "commit": COMMIT, "author_file_sha256": FILES,
        "paper": "https://arxiv.org/html/2511.01747v3",
        "python": platform.python_version(), "numpy": np.__version__, "torch": torch.__version__,
        "pretraining_overlap_status": "unresolved", "pretraining_overlap_warning": OVERLAP,
        "encoder_frozen": True, "chunk_samples": 1250, "chunks_per_recording": 3,
        "chunk_normalization": "time-axis z-score: (x-mean)/(population std+1e-8), computed in float64 then float32",
        "additional_filter": "none", "feature_aggregation": "equal mean of three 512-value chunk embeddings",
        "target_scope": "one original 30-second recording target; no copied chunk labels",
    }


def smoke(directory, output, threads=2):
    import torch

    torch.set_num_threads(threads)
    started = time.perf_counter()
    model = load_encoder(directory)
    clock = np.arange(3750, dtype=np.float64) / 125.0
    waveform = np.sin(2 * np.pi * 1.2 * clock) + 0.2 * np.sin(2 * np.pi * 2.4 * clock)
    values = waveform.astype(np.float32)[None, None, :]
    first = encode_recordings(model, values)
    second = encode_recordings(model, values)
    require(np.array_equal(first, second), "Repeated CPU inference differed.")
    report = {
        "schema_version": 1, "test": "anyppg_pinned_encoder_synthetic_smoke",
        "complete": True, "passed": True, "synthetic": True, "device": "cpu",
        "raw_input_shape": list(values.shape), "encoder_input_shape": [3, 1, 1250],
        "recording_feature_shape": list(first.shape), "parameter_count": sum(p.numel() for p in model.parameters()),
        "checkpoint_bytes": (Path(directory) / "anyppg_ckpt.pth").stat().st_size,
        "finite_features": bool(np.isfinite(first).all()), "repeated_output_exact": bool(np.array_equal(first, second)),
        "feature_min": float(first.min()), "feature_max": float(first.max()),
        "total_wall_seconds": time.perf_counter() - started,
        "bp_accuracy_evaluated": False, "phone_inference_run": False, "provenance": provenance(),
    }
    write_json(output, report)
    return report


def fit(directory, prepared, output, device="cpu", batch_size=32, threads=4, minutes=45):
    import torch

    require(math.isfinite(minutes) and 0 < minutes <= 45,
            "Worker budget must be positive, finite, and at most 45 minutes.")
    require(threads >= 1 and batch_size >= 1, "Threads and batch size must be positive.")
    torch.set_num_threads(threads)
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False, mode=0o700)
    started = time.monotonic()
    deadline = started + minutes * 60
    report = {
        "schema_version": 1, "arm": "raw", "model": "anyppg_frozen_ridge", "seed": None,
        "complete": False, "status": "running", "synthetic": False, "failure": None,
        "scope": "Exploratory train/validation development; unresolved encoder-pretraining patient overlap. Recording label semantics uncertified.",
        "device": device, "test_split_used": False, "phone_updated": False,
        "minutes_budget": minutes, "time_limit_reached": False,
        "source_sha256": sha256(__file__), "provenance": provenance(),
        "selection_rule": "Lowest equal-weight mean SBP/DBP validation MAE; first alpha wins exact ties.",
    }
    try:
        require(device != "cuda" or torch.cuda.is_available(), "CUDA requested but unavailable.")
        manifest, arrays, hashes = load_prepared(prepared)
        report.update({"input_fingerprints": {"manifest_sha256": hashes["manifest.json"],
                       "arrays": {k: v for k, v in hashes.items() if k != "manifest.json"}},
                       "preparation_manifest_sha256": hashes["manifest.json"],
                       "synthetic": manifest.get("synthetic") is True,
                       "label_contract": LABEL_CONTRACT, "identity_contract": IDENTITY_CONTRACT})
        check_budget(deadline)
        model = load_encoder(directory, device)
        report["encoder_parameter_count"] = sum(p.numel() for p in model.parameters())
        encoded = {}
        for split in ("train", "val"):
            print(f"AnyPPG frozen encoder: {split}, {len(arrays[f'X_raw_{split}'])} complete recordings", flush=True)
            encoded[split] = encode_recordings(model, arrays[f"X_raw_{split}"], device, batch_size, deadline)
            report[f"{split}_encoded_count"] = len(encoded[split])
            write_json(output / "progress.json", report)
        del model
        trials, selected = [], None
        for alpha in ALPHAS:
            check_budget(deadline)
            probe = fit_ridge(encoded["train"], arrays["y_train"], alpha)
            predicted = predict_ridge(probe, encoded["val"])
            validation = metrics(arrays["y_val"], predicted, arrays["patient_val"])
            score = (validation["outputs"]["SBP"]["mae"] + validation["outputs"]["DBP"]["mae"]) / 2
            trials.append({"alpha": alpha, "validation": validation, "selection_score_mean_mae": score})
            if selected is None or score < selected[0]:
                selected = score, alpha, probe
            report["alpha_trials"] = trials
            write_json(output / "progress.json", report)
        check_budget(deadline)
        _, alpha, probe = selected
        report["selected_alpha"] = alpha
        report["metrics"], report["baselines"], predictions = {}, {}, {}
        for split in ("train", "val"):
            y, patients = arrays[f"y_{split}"], arrays[f"patient_{split}"]
            predictions[split] = predict_ridge(probe, encoded[split])
            report["metrics"][split] = metrics(y, predictions[split], patients)
        train_targets = np.asarray(arrays["y_train"], dtype=np.float64)
        for name, function in (("train_mean", np.mean), ("train_median", np.median)):
            constant = function(train_targets, axis=0)
            report["baselines"][name] = {split: metrics(arrays[f"y_{split}"],
                np.broadcast_to(constant, arrays[f"y_{split}"].shape), arrays[f"patient_{split}"])
                for split in ("train", "val")}
        for name, digest in hashes.items():
            check_budget(deadline)
            require(sha256(Path(prepared) / name) == digest, f"Input changed during probe: {name}")
        for name, digest in FILES.items():
            require(sha256(Path(directory) / name) == digest, f"Author source/weights changed during probe: {name}")
        require(sha256(__file__) == report["source_sha256"], "Worker source changed during probe.")
        checkpoint = output / "ridge_probe.npz"
        with checkpoint.open("xb") as f:
            np.savez(f, **probe, alpha=np.asarray(alpha))
        checkpoint.chmod(0o600)
        report["private_prediction_sha256"] = {}
        for split in ("train", "val"):
            check_budget(deadline)
            path = output / f"private_{split}_predictions.npz"
            with path.open("xb") as handle:
                np.savez_compressed(handle, prediction=predictions[split], target=arrays[f"y_{split}"],
                                    patient=arrays[f"patient_{split}"], row=arrays[f"row_{split}"])
            path.chmod(0o600)
            report["private_prediction_sha256"][split] = sha256(path)
        report.update({"complete": True, "status": "complete", "ridge_probe_sha256": sha256(checkpoint),
                       "bp_accuracy_evaluated": not report["synthetic"], "source_and_input_hashes_unchanged": True})
    except Exception as exc:
        timed_out = isinstance(exc, BudgetExceeded)
        report.update({"complete": False, "status": "time_limit" if timed_out else "failed",
                       "time_limit_reached": timed_out, "failure": f"{type(exc).__name__}: {exc}"})
        traceback.print_exc()
    finally:
        report["elapsed_seconds"] = time.monotonic() - started
        write_json(output / "report.json", report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, required=True,
                        help="Folder containing pinned resnet1d.py and anyppg_ckpt.pth (repository load_anyppg folder).")
    parser.add_argument("--data-dir", type=Path)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--fetch-only", action="store_true")
    parser.add_argument("--smoke", action="store_true", help="Actual CPU synthetic encoder inference, no dataset required.")
    parser.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    parser.add_argument("--minutes", type=float, default=45)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--threads", type=int, default=4)
    args = parser.parse_args()
    require(not (args.fetch_only and args.smoke), "Choose either fetch or smoke mode.")
    if args.fetch_only:
        result = fetch_encoder(args.source_dir)
    else:
        require(args.output_dir is not None, "--output-dir is required.")
        if args.smoke:
            args.output_dir.mkdir(parents=True, exist_ok=False, mode=0o700)
            result = smoke(args.source_dir, args.output_dir / "report.json", args.threads)
        else:
            require(args.data_dir is not None, "--data-dir is required for fitting.")
            result = fit(args.source_dir, args.data_dir, args.output_dir,
                         args.device, args.batch_size, args.threads, args.minutes)
    print(json.dumps(result, indent=2, allow_nan=False))
    if result.get("status") in ("failed", "time_limit"):
        raise SystemExit(1)


if __name__ == "__main__":
    main()

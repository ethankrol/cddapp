"""Prepare a new matched train/validation recording experiment; never read test data.

This uses existing recording-level labels as supplied. It does not certify those
labels, re-create the old beat labels, or modify any existing cache/model.
"""
from __future__ import annotations

import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import re
import sys

import numpy as np
import scipy

try:
    from .features import (ARMS, FEATURE_NAMES, RECORD_SAMPLES, SAMPLE_RATE,
                           extract_features, feature_contract, filter_records)
except ImportError:
    from features import (ARMS, FEATURE_NAMES, RECORD_SAMPLES, SAMPLE_RATE,
                          extract_features, feature_contract, filter_records)

LABEL_CONTRACT = "provided_recording_labels_sbp_dbp_semantics_uncertified_v1"
IDENTITY_CONTRACT = "named_train_val_lists_disjoint_global_numeric_ids_v1"
SPLITS = ("train", "val")
RECORDS_PER_PATIENT = 30


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def atomic_json(path, value):
    path = Path(path)
    temporary = path.with_name(path.name + ".partial")
    with temporary.open("x", encoding="utf8") as stream:
        json.dump(value, stream, indent=2, allow_nan=False)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def stable_text(path, role):
    require(path.is_file(), f"Missing {role}.")
    before = sha256(path)
    content = path.read_text(encoding="utf8")
    require(sha256(path) == before, f"{role} changed while being read.")
    return content, before


def read_subjects(path, split):
    text, digest = stable_text(path, f"{split} subject list")
    text = text.strip()
    if text.startswith("["):
        try:
            names = ast.literal_eval(text)
        except (ValueError, SyntaxError):
            raise ValueError(f"Invalid {split} subject-list syntax.") from None
        require(isinstance(names, list) and all(isinstance(x, str) for x in names),
                f"{split} subject list must contain strings.")
    else:
        names = [line.strip() for line in text.splitlines() if line.strip()]
    names = [name.strip().lower() for name in names]
    require(bool(names), f"Empty {split} subject list.")
    require(all(re.fullmatch(r"[a-z0-9][a-z0-9_.-]*", name) and name not in (".", "..")
                for name in names), f"Unsafe or invalid identifier in {split} subject list.")
    require(len(names) == len(set(names)), f"Duplicate identifiers in {split} subject list.")
    return sorted(names), digest


def source_paths(root, name):
    paths = {"ppg": root / "ppg" / f"{name}_ppg.npy",
             "labels": root / "labels" / f"{name}_labels.npy"}
    for role, path in paths.items():
        require(path.is_file(), f"A listed patient's {role} file is missing.")
        require(path.resolve().parent == (root / role).resolve(),
                f"A {role} file resolves outside its expected directory.")
    return paths


def read_pair(paths, expected_hashes=None):
    arrays, hashes = {}, {}
    for role, path in paths.items():
        before = sha256(path)
        if expected_hashes is not None:
            require(before == expected_hashes[role], f"Source {role} changed after preflight.")
        try:
            array = np.load(path, allow_pickle=False)
        except Exception:
            raise ValueError(f"Unable to load a listed patient's {role} numeric array.") from None
        require(sha256(path) == before, f"Source {role} changed while being read.")
        require(isinstance(array, np.ndarray) and array.dtype.kind in "fiu",
                f"Source {role} must be a real numeric array.")
        expected_shape = (30, RECORD_SAMPLES) if role == "ppg" else (30, 2)
        require(array.shape == expected_shape,
                f"Source {role} has wrong shape; required {expected_shape}.")
        arrays[role], hashes[role] = array, before
    return arrays["ppg"], arrays["labels"], hashes


def accepted_rows(ppg, labels):
    """Minimal numeric/order checks shared by every arm; no BP range selection."""
    limit = np.finfo(np.float32).max
    with np.errstate(over="ignore", invalid="ignore"):
        y32 = labels.astype(np.float32)
    reasons = {
        "nonfinite_ppg": ~np.isfinite(ppg).all(axis=1),
        "ppg_not_float32_representable": (np.abs(ppg.astype(np.float64)) > limit).any(axis=1),
        "nonfinite_labels": ~np.isfinite(labels).all(axis=1),
        "labels_not_float32_representable": ~np.isfinite(y32).all(axis=1),
        "nonpositive_dbp": ~(labels[:, 1] > 0),
        "sbp_not_above_dbp": ~(labels[:, 0] > labels[:, 1]),
        "float32_label_order_invalid": ~((y32[:, 0] > y32[:, 1]) & (y32[:, 1] > 0)),
    }
    rejected = np.logical_or.reduce(list(reasons.values()))
    return ~rejected, {name: int(mask.sum()) for name, mask in reasons.items()}


def prepare_dataset(dataset_root, output_dir, *, synthetic=False):
    root = Path(dataset_root).resolve()
    out = Path(output_dir).absolute()
    require(root.is_dir(), "Dataset root is missing.")
    require(not out.exists(), "Output directory already exists; supply a NEW directory.")
    resolved_out = out.resolve()
    require(root != resolved_out and root not in resolved_out.parents,
            "Write experiment outputs outside the source dataset directory.")
    names, list_hashes = {}, {}
    for split in SPLITS:
        names[split], list_hashes[split] = read_subjects(root / f"{split}_subjects.txt", split)
    require(not set(names["train"]) & set(names["val"]), "Named train/validation patients overlap.")
    global_ids = {name: index for index, name in enumerate(sorted(names["train"] + names["val"]))}
    private = {"schema_version": 1, "sensitive": True, "dataset_root": str(root),
               "subject_list_sha256": list_hashes, "patients": []}
    counts, records = {}, {}
    for split in SPLITS:
        records[split] = []
        counts[split] = {"listed_patients": len(names[split]), "source_recordings": 30 * len(names[split]),
                         "accepted_recordings": 0, "rejected_recordings": 0, "reasons_may_overlap": {}}
        for name in names[split]:
            paths = source_paths(root, name)
            ppg, labels, hashes = read_pair(paths)
            accepted, reasons = accepted_rows(ppg, labels)
            count = int(accepted.sum())
            counts[split]["accepted_recordings"] += count
            counts[split]["rejected_recordings"] += 30 - count
            for reason, number in reasons.items():
                previous = counts[split]["reasons_may_overlap"].get(reason, 0)
                counts[split]["reasons_may_overlap"][reason] = previous + number
            record = {"name": name, "patient_id": global_ids[name], "paths": paths,
                      "hashes": hashes, "accepted": accepted}
            records[split].append(record)
            private["patients"].append({"subject_name": name, "patient_id": global_ids[name], "split": split,
                "files": {role: {"path": str(path), "sha256": hashes[role]} for role, path in paths.items()},
                "accepted_segment_indices": np.flatnonzero(accepted).tolist()})
        require(counts[split]["accepted_recordings"] >= 2, f"Fewer than two accepted {split} recordings.")
    out.mkdir(parents=True, exist_ok=False, mode=0o700)
    manifest = {
        "schema_version": 1, "complete": False, "synthetic": bool(synthetic),
        "label_contract": LABEL_CONTRACT, "identity_contract": IDENTITY_CONTRACT,
        "sampling_rate_hz": SAMPLE_RATE, "samples_per_recording": RECORD_SAMPLES,
        "input_channels": 1, "output_order": ["SBP", "DBP"], "output_units": "mmHg",
        "arms": list(ARMS), "feature_names": list(FEATURE_NAMES), "feature_contract": feature_contract(),
        "split_counts": {split: counts[split]["accepted_recordings"] for split in SPLITS},
        "cohort_accounting": counts, "arrays": {}, "diagnostics": {},
        "filter_contract": {"bandpass_hz": [0.5, 8.0], "butterworth_prototype_order": 2,
            "causal_transfer_function_order": 4, "causal_initial_state": "sosfilt_zi scaled by first sample",
            "offline_method": "sosfiltfilt; forward/reverse response differs from single causal pass",
            "reset": "Every 30-second recording", "legacy_kalman": "Original recurrence from zero state"},
        "versions": {"python": sys.version.split()[0], "numpy": np.__version__, "scipy": scipy.__version__},
        "source_code_sha256": {p.name: sha256(p) for p in (Path(__file__), Path(__file__).with_name("features.py"))},
        "scope": "Train/validation only. No test list or files read. Supplied recording-label semantics uncertified; "
                 "not corrected beat labels, not comparable directly with legacy beat MAE. No quality-validation claim.",
    }
    atomic_json(out / "preparation_status.json", {"complete": False, "state": "writing"})
    atomic_json(out / "private_source_manifest.json", private)
    os.chmod(out / "private_source_manifest.json", 0o600)
    for split in SPLITS:
        n = manifest["split_counts"][split]
        shapes = {f"y_{split}.npy": ((n, 2), np.float32),
                  f"patient_{split}.npy": ((n,), np.int64), f"row_{split}.npy": ((n,), np.int64)}
        for arm in ARMS:
            shapes[f"X_{arm}_{split}.npy"] = ((n, 1, RECORD_SAMPLES), np.float32)
            shapes[f"feature_{arm}_{split}.npy"] = ((n, len(FEATURE_NAMES)), np.float32)
        maps = {name: np.lib.format.open_memmap(out / name, mode="w+", dtype=dtype, shape=shape)
                for name, (shape, dtype) in shapes.items()}
        diagnostics = {arm: {"recordings": 0, "flat_recordings": 0,
                            "missing_features_by_column": np.zeros(len(FEATURE_NAMES), dtype=np.int64)} for arm in ARMS}
        cursor = 0
        for item in records[split]:
            ppg, labels, _ = read_pair(item["paths"], item["hashes"])
            accepted, _ = accepted_rows(ppg, labels)
            require(np.array_equal(accepted, item["accepted"]), "Accepted cohort changed after preflight.")
            segments = np.flatnonzero(accepted)
            if not len(segments):
                continue
            end = cursor + len(segments)
            maps[f"y_{split}.npy"][cursor:end] = labels[accepted].astype(np.float32)
            maps[f"patient_{split}.npy"][cursor:end] = item["patient_id"]
            maps[f"row_{split}.npy"][cursor:end] = item["patient_id"] * 30 + segments
            filtered = filter_records(ppg[accepted])
            for arm in ARMS:
                waves = filtered[arm]
                maps[f"X_{arm}_{split}.npy"][cursor:end, 0] = waves
                feature_rows = np.stack([extract_features(wave) for wave in waves])
                maps[f"feature_{arm}_{split}.npy"][cursor:end] = feature_rows
                diagnostics[arm]["recordings"] += len(waves)
                diagnostics[arm]["flat_recordings"] += int(np.sum(np.ptp(waves, axis=1) == 0))
                diagnostics[arm]["missing_features_by_column"] += np.isnan(feature_rows).sum(axis=0)
            cursor = end
        require(cursor == n, "Written row count does not match preflight.")
        for name, array in maps.items():
            array.flush()
            manifest["arrays"][name] = {"sha256": sha256(out / name),
                                        "shape": list(array.shape), "dtype": str(array.dtype)}
        del maps
        for values in diagnostics.values():
            values["missing_features_by_column"] = values["missing_features_by_column"].tolist()
        manifest["diagnostics"][split] = diagnostics
    # Re-check source bytes after all work; a changed source invalidates the run.
    for split in SPLITS:
        require(sha256(root / f"{split}_subjects.txt") == list_hashes[split],
                f"{split} subject list changed during preparation.")
        for item in records[split]:
            for role, path in item["paths"].items():
                require(sha256(path) == item["hashes"][role], f"Source {role} changed during preparation.")
    for filename, digest in manifest["source_code_sha256"].items():
        require(sha256(Path(__file__).with_name(filename)) == digest, "Preparation source code changed during run.")
    manifest["complete"] = True
    atomic_json(out / "manifest.json", manifest)
    atomic_json(out / "preparation_status.json", {"complete": True, "state": "completed"})
    return manifest


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset-root", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--synthetic", action="store_true", help="Mark generated synthetic fixtures only; never use for patient data.")
    args = parser.parse_args(argv)
    report = prepare_dataset(args.dataset_root, args.output_dir, synthetic=args.synthetic)
    print("RECORDING PREPARATION COMPLETE; train/validation only.")
    print(json.dumps({"split_counts": report["split_counts"], "feature_count": len(report["feature_names"]),
                      "arms": report["arms"], "synthetic": report["synthetic"]}, indent=2))
    print("Private source manifest contains patient identities; keep it on the research system.")


if __name__ == "__main__":
    main()

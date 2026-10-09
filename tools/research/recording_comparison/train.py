#!/usr/bin/env python3
"""Train/validation-only 30-second recording comparison; never a phone update.

Inputs are freshly prepared recording arrays, not the historical beat cache.
The provided recording labels have not been independently physiologically
certified. This experiment must not be compared numerically with beat-level MAE
as if architecture were the only difference.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import random
import sys
import time
import traceback

import numpy as np

ARMS = ("raw", "legacy_kalman", "bandpass_causal", "bandpass_offline")
LABEL_CONTRACT = "provided_recording_labels_sbp_dbp_semantics_uncertified_v1"
IDENTITY_CONTRACT = "named_train_val_lists_disjoint_global_numeric_ids_v1"
SCOPE = ("Research: provided recording-level labels on 30-second PPG; train/validation "
         "only. Label semantics remain uncertified. No test split, personal calibration, "
         "model export or phone update. Not directly comparable to legacy beat MAE.")
POOLING_IMPLEMENTATION = "adaptive_bins_slice_mean_stack_v1"


class BudgetExceeded(RuntimeError):
    pass


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha256(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def atomic_json(path, value):
    path = Path(path)
    tmp = path.with_name(path.name + ".partial")
    with tmp.open("w", encoding="utf8") as f:
        json.dump(value, f, indent=2, allow_nan=False)
        f.write("\n")
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def check_budget(deadline):
    if time.monotonic() >= deadline:
        raise BudgetExceeded("Declared worker wall-time budget reached.")


def load_data(data_dir, arm, model):
    """Verify manifest and every array this worker consumes before training."""
    data_dir = Path(data_dir).resolve()
    manifest_path = data_dir / "manifest.json"
    manifest_digest = sha256(manifest_path)
    manifest = json.loads(manifest_path.read_text())
    require(sha256(manifest_path) == manifest_digest, "Preparation manifest changed while being read.")
    require(manifest.get("schema_version") == 1 and manifest.get("complete") is True,
            "Preparation manifest must be schema 1 and complete=true.")
    require(manifest.get("label_contract") == LABEL_CONTRACT, "Wrong recording-label contract.")
    require(manifest.get("identity_contract") == IDENTITY_CONTRACT, "Wrong subject identity contract.")
    require(manifest.get("sampling_rate_hz") == 125 and
            manifest.get("samples_per_recording") == 3750 and
            manifest.get("input_channels") == 1, "Expected one-channel, 125 Hz, 30-second recordings.")
    require(manifest.get("output_order") == ["SBP", "DBP"], "Output order must be SBP, DBP.")
    require(arm in ARMS and arm in manifest.get("arms", []), "Unknown or unavailable filter arm.")
    require(model in ("cnn", "lightgbm"), "Unknown model.")
    data, hashes = {}, {}
    prefix = "X" if model == "cnn" else "feature"
    for split in ("train", "val"):
        names = {"input": f"{prefix}_{arm}_{split}.npy", "y": f"y_{split}.npy",
                 "patient": f"patient_{split}.npy", "row": f"row_{split}.npy"}
        current = {}
        for key, filename in names.items():
            description = manifest["arrays"].get(filename)
            require(isinstance(description, dict), f"Array not declared: {filename}")
            path = data_dir / filename
            require(path.is_file() and path.resolve().parent == data_dir,
                    f"Missing array or symlink outside data directory: {filename}")
            digest = sha256(path)
            require(digest == description.get("sha256"), f"Array hash mismatch: {filename}")
            a = np.load(path, mmap_mode="r", allow_pickle=False)
            require(sha256(path) == digest, f"Array changed while being loaded: {filename}")
            require(list(a.shape) == description.get("shape"), f"Manifest shape mismatch: {filename}")
            require(str(a.dtype) == description.get("dtype"), f"Manifest dtype mismatch: {filename}")
            hashes[filename] = digest
            current[key] = a
        n = len(current["y"])
        require(n >= 2 and n == manifest["split_counts"][split], f"Invalid {split} row count.")
        require(current["y"].shape == (n, 2) and current["y"].dtype == np.float32,
                f"Bad {split} output array.")
        y = current["y"]
        require(np.isfinite(y).all() and np.all(y[:, 0] > y[:, 1]) and np.all(y[:, 1] > 0),
                f"Invalid finite/order constraints for {split} labels.")
        for key in ("patient", "row"):
            require(current[key].shape == (n,) and current[key].dtype == np.int64 and
                    np.all(current[key] >= 0), f"Invalid {split} {key} identity array.")
        require(len(np.unique(current["row"])) == n, f"Repeated {split} recording rows.")
        require(np.array_equal(current["row"] // 30, current["patient"]),
                f"{split} row IDs do not match patient*30+segment contract.")
        x = current["input"]
        require(x.dtype == np.float32 and x.shape[0] == n, f"Invalid {split} input dtype/count.")
        if model == "cnn":
            require(x.shape == (n, 1, 3750), f"Bad {split} waveform shape.")
            for start in range(0, n, 512):
                require(np.isfinite(x[start:start + 512]).all(), f"Nonfinite {split} waveform.")
        else:
            require(x.ndim == 2 and x.shape[1] == len(manifest.get("feature_names", [])) and
                    x.shape[1] > 0 and not np.isinf(x).any(), f"Bad {split} feature array.")
        data[split] = current
    require(not np.intersect1d(data["train"]["patient"], data["val"]["patient"]).size,
            "Train/validation patient overlap.")
    require(not np.intersect1d(data["train"]["row"], data["val"]["row"]).size,
            "Train/validation recording overlap.")
    require(sha256(manifest_path) == manifest_digest, "Preparation manifest changed during loading.")
    return manifest, data, {"manifest_sha256": manifest_digest, "arrays": hashes}


def verify_inputs_unchanged(data_dir, fingerprints):
    """Read-only memmaps do not stop another process from altering their files."""
    root = Path(data_dir).resolve()
    require(sha256(root / "manifest.json") == fingerprints["manifest_sha256"],
            "Preparation manifest changed during the worker run.")
    for name, digest in fingerprints["arrays"].items():
        require(sha256(root / name) == digest, f"Input array changed during the worker run: {name}")


def fit_normalization(train_x, train_y):
    """Float64 train-only statistics; scalar channel scaling retains amplitude."""
    count, mean, m2 = 0, 0.0, 0.0
    for start in range(0, len(train_x), 256):
        block = np.asarray(train_x[start:start + 256], dtype=np.float64)
        bn = block.size
        bm = float(block.mean())
        bm2 = float(np.sum((block - bm) ** 2))
        delta = bm - mean
        combined = count + bn
        m2 += bm2 + delta * delta * count * bn / combined
        mean += delta * bn / combined
        count = combined
    raw_std = math.sqrt(m2 / count)
    y = np.asarray(train_y, dtype=np.float64)
    output_std = y.std(axis=0)
    return {"input_mean": mean, "input_std": max(raw_std, 1e-6),
            "input_std_before_floor": raw_std, "output_mean": y.mean(axis=0).tolist(),
            "output_std": np.maximum(output_std, 1e-6).tolist(),
            "output_std_before_floor": output_std.tolist(), "fit_split": "train",
            "per_recording_amplitude_normalization": False, "std_floor": 1e-6}


def metrics(y, prediction, patient):
    y, prediction = np.asarray(y, dtype=np.float64), np.asarray(prediction, dtype=np.float64)
    require(y.shape == prediction.shape and y.ndim == 2 and y.shape[1] == 2,
            "Metric shapes differ.")
    require(np.isfinite(y).all() and np.isfinite(prediction).all(), "Nonfinite metric values.")
    ids, inverse = np.unique(patient, return_inverse=True)
    counts = np.bincount(inverse)
    result = {}
    for j, label in enumerate(("SBP", "DBP")):
        error = prediction[:, j] - y[:, j]
        abs_error = np.abs(error)
        pred_sd, target_sd = float(prediction[:, j].std()), float(y[:, j].std())
        correlation = float(np.corrcoef(y[:, j], prediction[:, j])[0, 1]) if pred_sd > 1e-12 and target_sd > 1e-12 else None
        result[label] = {"mae": float(abs_error.mean()), "mean_error": float(error.mean()),
                         "correlation": correlation, "prediction_sd": pred_sd, "target_sd": target_sd,
                         "patient_macro_mae": float((np.bincount(inverse, weights=abs_error) / counts).mean())}
    return {"recording_count": len(y), "patient_count": len(ids), "outputs": result}


def make_adaptive_mean_pool(output_size=4):
    """Adaptive average pooling with deterministic-autograd building blocks.

    The bins match PyTorch AdaptiveAvgPool1d: start=floor(i*L/O),
    end=ceil((i+1)*L/O). Neighboring bins intentionally overlap when needed.
    Slice/mean/stack avoids CUDA's unsupported deterministic adaptive-pool
    backward kernel; it changes the implementation, not the bins or parameters.
    Floating-point reduction order can differ from the native pooling kernel.
    """
    import torch
    from torch import nn
    require(isinstance(output_size, int) and output_size > 0, "Positive pooling output size required.")

    class AdaptiveMeanPool(nn.Module):
        def __init__(self):
            super().__init__()
            self.output_size = output_size

        def forward(self, x):
            length = x.shape[-1]
            require(length > 0, "Cannot pool an empty input.")
            return torch.stack([
                x[..., i * length // self.output_size:
                  ((i + 1) * length + self.output_size - 1) // self.output_size].mean(dim=-1)
                for i in range(self.output_size)
            ], dim=-1)

    return AdaptiveMeanPool()


def make_cnn():
    import torch
    from torch import nn

    class RecordingCNN(nn.Module):
        def __init__(self):
            super().__init__()
            layers = []
            inc = 1
            for outc, kernel in ((16, 15), (32, 9), (64, 7), (128, 5)):
                layers.extend([nn.Conv1d(inc, outc, kernel, stride=2, padding=kernel // 2),
                               nn.GroupNorm(4, outc), nn.ReLU()])
                inc = outc
            self.features = nn.Sequential(*layers, make_adaptive_mean_pool(4))
            self.head = nn.Sequential(nn.Flatten(), nn.Linear(512, 64), nn.ReLU(),
                                      nn.Dropout(0.1), nn.Linear(64, 2))

        def forward(self, x):
            return self.head(self.features(x))

    return RecordingCNN()


def state_digest(model):
    digest = hashlib.sha256()
    for name, tensor in sorted(model.state_dict().items()):
        digest.update(name.encode())
        digest.update(np.asarray(tensor.detach().cpu()).tobytes())
    return digest.hexdigest()


def save_checkpoint(path, checkpoint):
    import torch
    path = Path(path)
    tmp = path.with_name(path.name + ".partial")
    torch.save(checkpoint, tmp)
    os.replace(tmp, path)


def cnn_predictions(model, x, normalization, device, batch_size=64, deadline=None):
    import torch
    model.eval()
    parts = []
    with torch.inference_mode():
        for start in range(0, len(x), batch_size):
            if deadline is not None:
                check_budget(deadline)
            values = (np.asarray(x[start:start + batch_size], dtype=np.float32) - normalization["input_mean"]) / normalization["input_std"]
            prediction = model(torch.from_numpy(np.ascontiguousarray(values)).to(device))
            parts.append(prediction.cpu().numpy())
    return (np.concatenate(parts).astype(np.float64) * np.array(normalization["output_std"]) +
            np.array(normalization["output_mean"]))


def train_cnn(data, output_dir, seed, deadline, report, allow_cpu=False,
              max_epochs=120, patience=15, batch_size=64):
    os.environ.setdefault("CUBLAS_WORKSPACE_CONFIG", ":4096:8")
    import torch
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.set_num_threads(4)
    torch.use_deterministic_algorithms(True)
    torch.backends.cudnn.benchmark = False
    torch.backends.cudnn.deterministic = True
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)
        device = torch.device("cuda")
    else:
        require(allow_cpu, "CNN training requires CUDA; --allow-cpu is for synthetic local checks only.")
        device = torch.device("cpu")
    normalization = fit_normalization(data["train"]["input"], data["train"]["y"])
    atomic_json(Path(output_dir) / "normalization.json", normalization)
    model = make_cnn()
    init_digest = state_digest(model)
    model = model.to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=3e-4, weight_decay=1e-4)
    report.update({"torch": torch.__version__, "device": str(device),
                   "gpu": torch.cuda.get_device_name(0) if device.type == "cuda" else None,
                   "initial_model_sha256": init_digest,
                   "parameters": sum(p.numel() for p in model.parameters()),
                   "normalization": normalization,
                   "recipe": {"loss": "MSE of train-standardized SBP and DBP", "learning_rate": 3e-4,
                              "optimizer": "AdamW", "weight_decay": 1e-4, "dropout": 0.1,
                              "gradient_clip_norm": 1.0, "max_epochs": max_epochs,
                              "patience": patience, "batch_size": batch_size, "threads": 4,
                              "sampling": "all training rows once per epoch; independent seed+epoch shuffle",
                              "selection": "minimum mean of validation SBP MAE and DBP MAE in mmHg",
                              "normalization": "global train-only channel and target statistics",
                              "augmentation": False, "deterministic_algorithms": True,
                              "pooling_implementation": POOLING_IMPLEMENTATION,
                              "pooling_bins": "floor(i*L/4):ceil((i+1)*L/4); overlaps preserved",
                              "architecture": "recording_cnn_v1"}})
    y = (np.asarray(data["train"]["y"], dtype=np.float32) - np.array(normalization["output_mean"], dtype=np.float32)) / np.array(normalization["output_std"], dtype=np.float32)
    best, stale, selected_epoch = math.inf, 0, None
    history = []
    report["history"] = history
    report["epoch_order_sha256"] = []
    report["epoch_sample_order_sha256"] = report["epoch_order_sha256"]
    checkpoint_path = Path(output_dir) / "best.pth"
    stop = "max_epochs"
    for epoch in range(1, max_epochs + 1):
        check_budget(deadline)
        generator = torch.Generator().manual_seed(seed * 100000 + epoch)
        order = torch.randperm(len(y), generator=generator).numpy()
        report["epoch_order_sha256"].append(hashlib.sha256(order.tobytes()).hexdigest())
        model.train()
        for start in range(0, len(order), batch_size):
            check_budget(deadline)
            indices = order[start:start + batch_size]
            x = (np.asarray(data["train"]["input"][indices], dtype=np.float32) - normalization["input_mean"]) / normalization["input_std"]
            tx = torch.from_numpy(np.ascontiguousarray(x)).to(device)
            ty = torch.from_numpy(np.ascontiguousarray(y[indices])).to(device)
            optimizer.zero_grad(set_to_none=True)
            loss = torch.nn.functional.mse_loss(model(tx), ty)
            require(bool(torch.isfinite(loss)), "Nonfinite CNN training loss.")
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0, error_if_nonfinite=True)
            optimizer.step()
        val_prediction = cnn_predictions(model, data["val"]["input"], normalization, device, batch_size, deadline)
        val_mae = np.abs(val_prediction - data["val"]["y"]).mean(axis=0)
        score = float(val_mae.mean())
        improved = score < best
        if improved:
            best, stale, selected_epoch = score, 0, epoch
            save_checkpoint(checkpoint_path, {"schema_version": 1, "architecture": "recording_cnn_v1",
                            "pooling_implementation": POOLING_IMPLEMENTATION,
                            "state_dict": model.state_dict(), "normalization": normalization,
                            "seed": seed, "epoch": epoch, "validation_mean_mae": score,
                            "initial_model_sha256": init_digest, "scope": SCOPE,
                            "input_fingerprints": report.get("input_fingerprints", {})})
        else:
            stale += 1
        history.append({"epoch": epoch, "val_sbp_mae": float(val_mae[0]),
                        "val_dbp_mae": float(val_mae[1]), "selected": improved})
        report.update({"epochs_completed": epoch, "selected_epoch": selected_epoch})
        atomic_json(Path(output_dir) / "progress.json", report)
        print(f"epoch {epoch:3d}: val SBP={val_mae[0]:.4f} DBP={val_mae[1]:.4f}; best={selected_epoch}", flush=True)
        if stale >= patience:
            stop = "early_stopping"
            break
    checkpoint = torch.load(checkpoint_path, map_location=device, weights_only=True)
    model.load_state_dict(checkpoint["state_dict"], strict=True)
    result = {split: cnn_predictions(model, data[split]["input"], normalization, device,
                                    batch_size, deadline) for split in ("train", "val")}
    reproduced = float(np.abs(result["val"] - data["val"]["y"]).mean())
    require(abs(reproduced - best) <= 1e-6, "Selected checkpoint did not reproduce validation score.")
    report.update({"stop_reason": stop, "selected_epoch": selected_epoch,
                   "checkpoint_sha256": sha256(checkpoint_path), "checkpoint_validation_reproduced": True})
    return result


def train_lightgbm(data, output_dir, seed, deadline, report, max_rounds=2000, patience=100):
    # Native LightGBM handles missing landmark NaNs; no validation imputation fit.
    import lightgbm as lgb
    normalization = {"output_mean": np.asarray(data["train"]["y"], dtype=np.float64).mean(axis=0).tolist(),
                     "output_std": np.maximum(np.asarray(data["train"]["y"], dtype=np.float64).std(axis=0), 1e-6).tolist(),
                     "fit_split": "train", "input_imputation": "none; LightGBM native NaN handling"}
    atomic_json(Path(output_dir) / "normalization.json", normalization)
    params = {"objective": "regression", "metric": "l1", "learning_rate": 0.03,
              "num_leaves": 31, "min_data_in_leaf": 50, "lambda_l2": 1.0,
              "feature_fraction": 0.9, "bagging_fraction": 0.9, "bagging_freq": 1,
              "num_threads": 4, "deterministic": True, "force_col_wise": True,
              "seed": seed, "feature_fraction_seed": seed, "bagging_seed": seed,
              "data_random_seed": seed, "verbosity": -1}
    report.update({"lightgbm": lgb.__version__, "device": "cpu", "normalization": normalization,
                   "recipe": {"parameters": params, "max_rounds": max_rounds, "patience": patience,
                              "selection": "two independent regressors, each selected by its own validation MAE",
                              "seed_interpretation": "Fixed 90% row/feature subsampling; repeatable within each declared seed",
                              "input_imputation": "native NaN; no imputation statistics",
                              "missing_train_fraction": float(np.isnan(data["train"]["input"]).mean()),
                              "all_missing_train_columns": int(np.isnan(data["train"]["input"]).all(axis=0).sum())}})
    predictions = {split: np.zeros((len(data[split]["y"]), 2)) for split in ("train", "val")}
    report["selected_iterations"] = {}
    report["checkpoint_sha256"] = {}

    def budget_callback(env):
        check_budget(deadline)

    budget_callback.order = 0
    for j, output in enumerate(("SBP", "DBP")):
        check_budget(deadline)
        mean, std = normalization["output_mean"][j], normalization["output_std"][j]
        train = lgb.Dataset(np.asarray(data["train"]["input"]),
                            label=(data["train"]["y"][:, j] - mean) / std)
        val = lgb.Dataset(np.asarray(data["val"]["input"]),
                          label=(data["val"]["y"][:, j] - mean) / std, reference=train)
        model = lgb.train(params, train, num_boost_round=max_rounds, valid_sets=[val], valid_names=["val"],
                          callbacks=[budget_callback, lgb.early_stopping(patience, verbose=False),
                                     lgb.log_evaluation(period=100)])
        chosen = model.best_iteration or model.current_iteration()
        path = Path(output_dir) / f"best_{output.lower()}.txt"
        temporary = path.with_name(path.name + ".partial")
        model.save_model(str(temporary), num_iteration=chosen)
        os.replace(temporary, path)
        # Reopen the exact saved checkpoint, not the last in-memory iteration.
        selected = lgb.Booster(model_file=str(path))
        for split in ("train", "val"):
            check_budget(deadline)
            predictions[split][:, j] = selected.predict(np.asarray(data[split]["input"]),
                                                        num_threads=4) * std + mean
        report["selected_iterations"][output] = chosen
        report["checkpoint_sha256"][output] = sha256(path)
        report["outputs_completed"] = j + 1
        atomic_json(Path(output_dir) / "progress.json", report)
    report["stop_reason"] = "independent_validation_early_stopping_or_round_limit"
    return predictions


def run(args):
    output_dir = Path(args.output_dir).resolve()
    require(math.isfinite(args.minutes) and 0 < args.minutes <= 45,
            "Worker budget must be positive, finite, and at most 45 minutes.")
    require(1 <= args.max_epochs <= 120 and 1 <= args.patience <= 15 and args.batch_size >= 1,
            "Invalid training limits (max_epochs <=120, patience <=15).")
    require(not output_dir.exists(), "Output directory already exists; use a new experiment directory.")
    output_dir.mkdir(parents=True, mode=0o700)
    started = time.monotonic()
    report = {"schema_version": 1, "complete": False, "status": "running", "synthetic": False,
              "arm": args.arm, "model": args.model, "seed": args.seed, "scope": SCOPE,
              "minutes_budget": args.minutes, "time_limit_reached": False, "failure": None,
              "python": platform.python_version(), "numpy": np.__version__,
              "source_sha256": sha256(__file__), "started_at_unix": time.time()}
    try:
        manifest, data, fingerprints = load_data(args.data_dir, args.arm, args.model)
        report["synthetic"] = manifest.get("synthetic") is True
        require(not args.allow_cpu or report["synthetic"], "--allow-cpu is restricted to a synthetic preparation manifest.")
        report["input_fingerprints"] = fingerprints
        report["preparation_manifest_sha256"] = fingerprints["manifest_sha256"]
        report["feature_names"] = manifest.get("feature_names", []) if args.model == "lightgbm" else None
        report["label_contract"] = LABEL_CONTRACT
        report["identity_contract"] = IDENTITY_CONTRACT
        report["cohort"] = {split: {"recordings": len(data[split]["y"]),
                                    "patients": len(np.unique(data[split]["patient"]))} for split in ("train", "val")}
        report["baselines"] = {}
        for name, constant in (("train_mean", np.mean(data["train"]["y"], axis=0, dtype=np.float64)),
                               ("train_median", np.median(np.asarray(data["train"]["y"], dtype=np.float64), axis=0))):
            report["baselines"][name] = {split: metrics(data[split]["y"],
                np.broadcast_to(constant, data[split]["y"].shape), data[split]["patient"])
                for split in ("train", "val")}
        deadline = started + args.minutes * 60
        check_budget(deadline)
        if args.model == "cnn":
            prediction = train_cnn(data, output_dir, args.seed, deadline, report, args.allow_cpu,
                                   args.max_epochs, args.patience, args.batch_size)
        else:
            prediction = train_lightgbm(data, output_dir, args.seed, deadline, report)
        report["metrics"] = {split: metrics(data[split]["y"], prediction[split], data[split]["patient"])
                             for split in ("train", "val")}
        private_path = output_dir / "private_predictions.npz"
        with private_path.open("xb") as f:
            np.savez_compressed(f, **{f"{split}_{key}": value
                for split in ("train", "val")
                for key, value in {"y": data[split]["y"], "prediction": prediction[split],
                                   "patient": data[split]["patient"], "row": data[split]["row"]}.items()})
        private_path.chmod(0o600)
        check_budget(deadline)
        report["private_predictions_sha256"] = sha256(private_path)
        verify_inputs_unchanged(args.data_dir, fingerprints)
        require(sha256(__file__) == report["source_sha256"], "Worker source code changed during run.")
        check_budget(deadline)
        report["input_hashes_unchanged"] = True
        report.update({"complete": True, "status": "complete"})
    except Exception as exc:
        timed_out = isinstance(exc, BudgetExceeded)
        report.update({"complete": False, "status": "time_limit" if timed_out else "failed",
                       "time_limit_reached": timed_out, "failure": f"{type(exc).__name__}: {exc}"})
        traceback.print_exc()
    finally:
        report["elapsed_seconds"] = time.monotonic() - started
        atomic_json(output_dir / "report.json", report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--arm", choices=ARMS, required=True)
    parser.add_argument("--model", choices=("cnn", "lightgbm"), required=True)
    parser.add_argument("--seed", type=int, choices=(125, 126, 127), required=True)
    parser.add_argument("--minutes", type=float, default=45)
    parser.add_argument("--allow-cpu", action="store_true", help="Only permitted for synthetic local smoke tests.")
    parser.add_argument("--max-epochs", type=int, default=120)
    parser.add_argument("--patience", type=int, default=15)
    parser.add_argument("--batch-size", type=int, default=64)
    args = parser.parse_args()
    report = run(args)
    print(json.dumps({k: report[k] for k in ("arm", "model", "seed", "status", "complete", "failure")}, indent=2))
    if not report["complete"]:
        sys.exit(2)


if __name__ == "__main__":
    main()

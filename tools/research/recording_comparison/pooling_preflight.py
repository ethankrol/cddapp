#!/usr/bin/env python3
"""Exercise the complete corrected CNN on synthetic inputs before GPU retries.

CPU success is a software check only. CUDA success must come from this script
running inside the actual Slurm GPU allocation. No patient data are opened.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import time
import traceback

os.environ.setdefault("CUBLAS_WORKSPACE_CONFIG", ":4096:8")

import train


def tensor_digest(items):
    digest = hashlib.sha256()
    for name, tensor in sorted(items):
        digest.update(name.encode())
        digest.update(tensor.detach().cpu().contiguous().numpy().tobytes())
    return digest.hexdigest()


def run_preflight(device="cuda", batch_size=64):
    import torch

    started = time.monotonic()
    report = {"schema_version": 1, "test": "recording_cnn_deterministic_pooling_preflight",
              "synthetic": True, "passed": False, "failure": None,
              "python": platform.python_version(), "torch": str(torch.__version__),
              "device": device, "batch_size": batch_size, "input_shape": [batch_size, 1, 3750],
              "deterministic_algorithms": True, "training_steps_per_repeat": 2,
              "repeat_count": 2, "pooling_implementation": train.POOLING_IMPLEMENTATION,
              "source_sha256": train.sha256(__file__), "train_sha256": train.sha256(train.__file__),
              "patient_data_used": False, "bp_accuracy_evaluated": False}
    try:
        train.require(device in ("cpu", "cuda"), "Device must be cpu or cuda.")
        train.require(batch_size >= 1, "Batch size must be positive.")
        train.require(device != "cuda" or torch.cuda.is_available(), "CUDA required for GPU preflight; no CPU fallback.")
        torch.set_num_threads(4)
        torch.use_deterministic_algorithms(True)
        torch.backends.cudnn.benchmark = False
        torch.backends.cudnn.deterministic = True
        target_device = torch.device(device)
        report["gpu"] = torch.cuda.get_device_name(0) if device == "cuda" else None
        report["cuda_version"] = torch.version.cuda
        # Generate the input on CPU so each repeat consumes exactly the same bytes.
        x = torch.sin(torch.arange(batch_size * 3750, dtype=torch.float32) / 37).reshape(batch_size, 1, 3750)
        y = torch.linspace(-0.5, 0.5, batch_size * 2).reshape(batch_size, 2)
        x, y = x.to(target_device), y.to(target_device)
        repeats = []
        for _ in range(2):
            torch.manual_seed(125)
            if device == "cuda":
                torch.cuda.manual_seed_all(125)
            model = train.make_cnn()
            initial = train.state_digest(model)
            model = model.to(target_device)
            optimizer = torch.optim.AdamW(model.parameters(), lr=3e-4, weight_decay=1e-4)
            model.train()
            steps = []
            for step in range(2):
                optimizer.zero_grad(set_to_none=True)
                predicted = model(x)
                loss = torch.nn.functional.mse_loss(predicted, y)
                train.require(bool(torch.isfinite(loss)), "Nonfinite preflight loss.")
                loss.backward()
                for name, parameter in model.named_parameters():
                    train.require(parameter.grad is not None and bool(torch.isfinite(parameter.grad).all()),
                                  f"Missing or nonfinite gradient: {name}")
                grad_digest = tensor_digest((name, p.grad) for name, p in model.named_parameters())
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0, error_if_nonfinite=True)
                optimizer.step()
                steps.append({"step": step + 1, "loss": float(loss.detach().cpu()),
                              "prediction_sha256": tensor_digest([("prediction", predicted)]),
                              "gradient_sha256": grad_digest,
                              "state_sha256": train.state_digest(model)})
            train.require(initial != train.state_digest(model), "Optimizer did not change model weights.")
            model.eval()
            with torch.inference_mode():
                expected = model(x)
            buffer = io.BytesIO()
            torch.save(model.state_dict(), buffer)
            buffer.seek(0)
            restored = train.make_cnn().to(target_device)
            restored.load_state_dict(torch.load(buffer, map_location=target_device, weights_only=True), strict=True)
            restored.eval()
            with torch.inference_mode():
                actual = restored(x)
            train.require(torch.equal(expected, actual), "Saved weights did not reproduce inference exactly.")
            repeats.append({"initial_state_sha256": initial, "steps": steps,
                            "reloaded_output_sha256": tensor_digest([("output", actual)]),
                            "checkpoint_reload_exact": True})
        train.require(repeats[0] == repeats[1], "Fresh repeated training did not match exactly on this device.")
        report.update({"passed": True, "repeats": repeats, "repeated_training_exact": True,
                       "all_gradients_finite": True, "checkpoint_reload_exact": True})
    except Exception as exc:
        report["failure"] = f"{type(exc).__name__}: {exc}"
        traceback.print_exc()
    report["elapsed_seconds"] = time.monotonic() - started
    report["scope"] = ("Two synthetic training steps, repeated with identical seeds on the reported device. "
                       "Not BP accuracy, GPU throughput, or a cross-hardware reproducibility guarantee.")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", choices=("cpu", "cuda"), default="cuda")
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    train.require(not args.report.exists(), "Preflight report already exists; use a new path.")
    args.report.parent.mkdir(parents=True, exist_ok=True)
    report = run_preflight(args.device, args.batch_size)
    with args.report.open("x", encoding="utf8") as stream:
        json.dump(report, stream, indent=2, allow_nan=False)
        stream.write("\n")
    print(json.dumps(report, indent=2))
    raise SystemExit(0 if report["passed"] else 2)


if __name__ == "__main__":
    main()

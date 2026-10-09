#!/usr/bin/env python3
"""Export cBP-Tnet's prepared-beat network and check numerical parity.

This does not implement raw-PPG filtering, heartbeat detection, or calibration.
Normalization stays outside the ONNX graph. Input shapes are fixed to one beat.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import tempfile

import numpy as np
import onnx
import onnxruntime as ort
import torch
from torch import nn

class ConvBlock(nn.Module):
    def __init__(self, in_ch, out_ch, kernel_size=7, stride=1, padding=3):
        super().__init__()
        self.conv = nn.Conv1d(in_ch, out_ch, kernel_size, stride=stride,
                              padding=padding, bias=False)
        self.bn   = nn.BatchNorm1d(out_ch)
        self.act  = nn.GELU()
        self.res  = nn.Conv1d(in_ch, out_ch, 1, stride=stride, bias=False) \
                    if (in_ch != out_ch or stride != 1) else nn.Identity()

    def forward(self, x):
        return self.act(self.bn(self.conv(x)) + self.res(x))


class CNNTransformerBP(nn.Module):
    """
    cBP-Tnet: single-beat PPG → SBP + DBP.

    Input : (B, 3, 250)  [PPG, dPPG, d²PPG]  +  (B, 2)  PTT scalars
    CNN   : 4 ConvBlocks, 2× MaxPool → (B, 256, 62)
    Transformer (pre-norm, 6 layers, 8 heads) → global avg pool → (B, 256)
    PTT embed → concat → (B, 288)
    SBP/DBP heads → scalar each
    """
    def __init__(self, in_channels=3, window_size=250, model_dim=256,
                 num_heads=8, num_layers=6, dropout=0.35, ptt_dim=32):
        super().__init__()
        self.cnn = nn.Sequential(
            ConvBlock(in_channels, 64,        kernel_size=7, padding=3),
            ConvBlock(64,          128,       kernel_size=5, padding=2),
            nn.MaxPool1d(2),
            nn.Dropout(dropout * 0.25),
            ConvBlock(128,         model_dim, kernel_size=3, padding=1),
            ConvBlock(model_dim,   model_dim, kernel_size=3, padding=1),
            nn.MaxPool1d(2),
            nn.Dropout(dropout * 0.25),
        )
        seq_len = window_size // 4
        self.pos_enc = nn.Parameter(torch.randn(1, seq_len, model_dim) * 0.02)
        enc_layer = nn.TransformerEncoderLayer(
            d_model=model_dim, nhead=num_heads,
            dim_feedforward=model_dim * 4,
            dropout=dropout, activation='gelu',
            batch_first=True, norm_first=True)
        self.transformer = nn.TransformerEncoder(enc_layer, num_layers=num_layers)
        self.norm = nn.LayerNorm(model_dim)
        self.ptt_embed = nn.Sequential(
            nn.Linear(2, ptt_dim), nn.GELU(), nn.Linear(ptt_dim, ptt_dim))
        fused_dim = model_dim + ptt_dim
        head_dim  = fused_dim // 2
        self.sbp_head = nn.Sequential(
            nn.Linear(fused_dim, head_dim), nn.GELU(),
            nn.Dropout(dropout), nn.Linear(head_dim, 1))
        self.dbp_head = nn.Sequential(
            nn.Linear(fused_dim, head_dim), nn.GELU(),
            nn.Dropout(dropout), nn.Linear(head_dim, 1))

    def forward(self, x, ptt):
        x = self.cnn(x)
        x = x.permute(0, 2, 1)
        x = x + self.pos_enc[:, :x.size(1), :]
        x = self.transformer(x)
        x = self.norm(x).mean(dim=1)
        p = self.ptt_embed(ptt)
        x = torch.cat([x, p], dim=-1)
        sbp = self.sbp_head(x).squeeze(-1)
        dbp = self.dbp_head(x).squeeze(-1)
        return torch.stack([sbp, dbp], dim=-1)



def sha256(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def settings_vectors(settings):
    require(settings.get("schema_version") == 1, "Expected normalization schema 1.")
    require(settings.get("sampling_rate_hz") == 125, "Expected 125 Hz.")
    require(settings.get("samples_per_beat") == 250, "Expected 250 samples per beat.")
    require(settings.get("channel_order") == ["PPG", "dPPG", "d2PPG"], "Channel order mismatch.")
    require(settings.get("timing_feature_order") ==
            ["scaled_upstroke_time", "scaled_beat_interval"], "Timing feature order mismatch.")
    require(settings.get("output_order") == ["SBP", "DBP"], "Output order mismatch.")
    require(settings.get("output_units") == "mmHg", "Expected output units mmHg.")
    vectors = []
    for name, size in (("channel_mean", 3), ("channel_std", 3),
                       ("timing_mean", 2), ("timing_std", 2)):
        value = np.asarray(settings[name], dtype=np.float32)
        require(value.shape == (size,) and np.isfinite(value).all(),
                "Invalid " + name)
        if name.endswith("_std"):
            require((value > 0).all(), "Standard deviations must be positive.")
        vectors.append(value)
    return vectors


def load_fixture(path, settings):
    means, stds, p_mean, p_std = settings_vectors(settings)
    with np.load(path, allow_pickle=False) as data:
        beats = np.asarray(data["beats"], dtype=np.float32)
        timing = np.asarray(data["PTT"], dtype=np.float32)
        require(beats.ndim == 3 and beats.shape[1:] == (3, 250) and len(beats) >= 2,
                "Expected at least two test beats with shape (N, 3, 250).")
        require(timing.shape == (len(beats), 2), "Expected timing shape (N, 2).")
        require(np.isfinite(beats).all() and np.isfinite(timing).all(),
                "Test inputs contain NaN or infinity.")
        x = np.ascontiguousarray((beats - means[None, :, None]) / stds[None, :, None])
        p = np.ascontiguousarray((timing - p_mean) / p_std)
        require(np.isfinite(x).all() and np.isfinite(p).all(), "Normalized inputs are not finite.")
        for key, computed in (("beats_normalized", x), ("PTT_normalized", p)):
            if key in data:
                np.testing.assert_allclose(computed, data[key], rtol=1e-6, atol=1e-6,
                                           err_msg="Fixture and normalization settings disagree.")
    return x, p


def torch_predictions(model, x, p):
    with torch.no_grad():
        return np.concatenate([
            model(torch.from_numpy(x[i:i+1]), torch.from_numpy(p[i:i+1])).cpu().numpy()
            for i in range(len(x))
        ])


def check_predictions(reference, actual, tolerance, label):
    require(reference.shape == actual.shape and actual.shape[1:] == (2,),
            label + ": output shape mismatch.")
    require(np.isfinite(reference).all() and np.isfinite(actual).all(),
            label + ": nonfinite prediction.")
    max_error = np.max(np.abs(reference - actual), axis=0)
    require(bool((max_error <= tolerance).all()),
            f"{label}: conversion check failed; max errors SBP/DBP = {max_error.tolist()} mmHg.")
    return [float(v) for v in max_error]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", type=Path,
                        default=Path(__file__).with_name("cBP-Tnet_Model.pth"))
    parser.add_argument("--normalization", type=Path, required=True)
    parser.add_argument("--fixtures", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()

    torch.set_num_threads(1)
    torch.set_num_interop_threads(1)
    settings = json.loads(args.normalization.read_text())
    checkpoint_hash = sha256(args.checkpoint)
    require(checkpoint_hash == settings.get("model_sha256"),
            "Checkpoint SHA-256 does not match normalization.json.")
    x, p = load_fixture(args.fixtures, settings)

    print("Loading trained checkpoint on CPU...", flush=True)
    model = CNNTransformerBP().cpu().eval()
    state = torch.load(args.checkpoint, map_location="cpu", weights_only=True)
    model.load_state_dict(state, strict=True)
    reference = torch_predictions(model, x, p)

    # Random normalized tensors exercise serialization and model execution only.
    # They are not raw PPG, patient data, or a waveform with known blood pressure.
    rng = np.random.default_rng(125)
    mock_x = rng.normal(size=(1, 3, 250)).astype(np.float32)
    mock_p = rng.normal(size=(1, 2)).astype(np.float32)
    mock_reference = torch_predictions(model, mock_x, mock_p)

    args.output_dir.mkdir(parents=True, exist_ok=True)
    if not settings.get("cache_checkpoint_pairing_verified", False):
        print("NOTE: cache/checkpoint training-run pairing remains unverified.", flush=True)

    # Temporary outputs never replace a previously checked package on failure.
    with tempfile.TemporaryDirectory(prefix=".export-", dir=args.output_dir) as tmp:
        stage = Path(tmp)
        candidate = stage / "cbp_tnet.onnx"
        # Fused Transformer operators are avoided for the opset-17 exporter.
        torch.backends.mha.set_fastpath_enabled(False)
        print("Exporting a fixed, single-beat ONNX graph...", flush=True)
        with torch.no_grad():
            torch.onnx.export(
                model,
                (torch.from_numpy(x[:1]), torch.from_numpy(p[:1])),
                str(candidate),
                input_names=["beat", "timing"],
                output_names=["bp"],
                opset_version=17,
                dynamo=False,
                external_data=False,
                export_params=True,
                do_constant_folding=True,
                training=torch.onnx.TrainingMode.EVAL,
            )
        onnx.checker.check_model(onnx.load(str(candidate)))

        options = ort.SessionOptions()
        options.intra_op_num_threads = 1
        options.inter_op_num_threads = 1
        options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        session = ort.InferenceSession(str(candidate), sess_options=options,
                                       providers=["CPUExecutionProvider"])
        require([(a.name, a.shape, a.type) for a in session.get_inputs()] ==
                [("beat", [1, 3, 250], "tensor(float)"),
                 ("timing", [1, 2], "tensor(float)")], "Unexpected ONNX input contract.")
        require([(a.name, a.shape, a.type) for a in session.get_outputs()] ==
                [("bp", [1, 2], "tensor(float)")], "Unexpected ONNX output contract.")

        print(f"Comparing PyTorch and ONNX on {len(x)} prepared test beats...", flush=True)
        actual = np.concatenate([
            session.run(["bp"], {"beat": x[i:i+1], "timing": p[i:i+1]})[0]
            for i in range(len(x))
        ])
        tolerance = 0.01
        max_error = check_predictions(reference, actual, tolerance, "Saved test beats")
        mock_actual = session.run(["bp"], {"beat": mock_x, "timing": mock_p})[0]
        mock_error = check_predictions(mock_reference, mock_actual, tolerance, "Synthetic input")

        mock = {
            "schema_version": 1,
            "mock": True,
            "description": "Synthetic normalized tensors for software testing; not a BP measurement.",
            "input_stage": "normalized_model_inputs",
            "dtype": "float32",
            "inputs": {
                "beat": {"shape": [1, 3, 250], "data": mock_x.reshape(-1).tolist()},
                "timing": {"shape": [1, 2], "data": mock_p.reshape(-1).tolist()},
            },
            "expected_output": {
                "name": "bp", "shape": [1, 2], "order": ["SBP", "DBP"],
                "data": mock_reference.reshape(-1).tolist(),
            },
            "comparison_absolute_tolerance_mmhg": tolerance,
        }
        report = {
            "schema_version": 1,
            "conversion_parity_passed": True,
            "created_utc": datetime.now(timezone.utc).isoformat(),
            "tested_fixture_beats": len(x),
            "absolute_tolerance_mmhg": tolerance,
            "max_abs_error_mmhg": {"SBP": max_error[0], "DBP": max_error[1]},
            "synthetic_max_abs_error_mmhg": {"SBP": mock_error[0], "DBP": mock_error[1]},
            "checkpoint_sha256": checkpoint_hash,
            "normalization_sha256": sha256(args.normalization),
            "fixture_sha256": sha256(args.fixtures),
            "onnx_sha256": sha256(candidate),
            "onnx_opset": 17,
            "input_stage": "normalized_model_inputs",
            "normalization_in_graph": False,
            "calibration_in_graph": False,
            "raw_ppg_preprocessing_in_graph": False,
            "cache_checkpoint_pairing_verified":
                settings.get("cache_checkpoint_pairing_verified", False) is True,
            "iphone_runtime_tested": False,
            "clinical_accuracy_evaluated": False,
            "versions": {"torch": torch.__version__, "numpy": np.__version__,
                         "onnx": onnx.__version__, "onnxruntime": ort.__version__},
        }
        (stage / "synthetic_model_smoke_test.json").write_text(
            json.dumps(mock, indent=2, allow_nan=False) + "\n")
        (stage / "export_report.json").write_text(
            json.dumps(report, indent=2, allow_nan=False) + "\n")
        shutil.copyfile(args.normalization, stage / "normalization.json")
        del session
        for name in ("cbp_tnet.onnx", "normalization.json",
                     "synthetic_model_smoke_test.json", "export_report.json"):
            (stage / name).replace(args.output_dir / name)

    print("\nEXPORT CHECK PASSED")
    print(f"Test beats: {len(x)}")
    print(f"Maximum SBP difference: {max_error[0]:.8f} mmHg")
    print(f"Maximum DBP difference: {max_error[1]:.8f} mmHg")
    print("Package:", args.output_dir.resolve())
    print("This checks conversion fidelity, not BP accuracy or iPhone execution.")


if __name__ == "__main__":
    main()

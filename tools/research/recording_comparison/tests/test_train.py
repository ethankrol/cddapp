"""Synthetic checks only: no patient dataset, GPU performance, or BP accuracy claims."""
from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch
import sys

import numpy as np

SOURCE = Path(__file__).resolve().parents[1] / "train.py"
SPEC = importlib.util.spec_from_file_location("recording_train_under_test", SOURCE)
training = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(training)
sys.path.insert(0, str(SOURCE.parent))
import prepare


def fixture(root, n_train=8, n_val=4, synthetic=True):
    """Every row belongs to one globally numbered synthetic recording."""
    root.mkdir()
    rng = np.random.default_rng(514)
    arrays = {}
    next_patient = 0
    for split, n in (("train", n_train), ("val", n_val)):
        f = rng.normal(size=(n, 6)).astype(np.float32)
        y = np.column_stack((120 + 12 * f[:, 0], 70 + 5 * f[:, 1])).astype(np.float32)
        f[::7, 2] = np.nan
        f[:, 5] = np.nan  # Entirely missing landmark is supported by native LightGBM.
        x = rng.normal(size=(n, 1, 3750)).astype(np.float32)
        patient = np.arange(next_patient, next_patient + n, dtype=np.int64)
        next_patient += n
        content = {f"y_{split}.npy": y, f"patient_{split}.npy": patient,
                   f"row_{split}.npy": patient * 30}
        for arm in training.ARMS:
            content[f"X_{arm}_{split}.npy"] = x
            content[f"feature_{arm}_{split}.npy"] = f
        for name, value in content.items():
            np.save(root / name, value, allow_pickle=False)
            arrays[name] = {"sha256": training.sha256(root / name),
                            "shape": list(value.shape), "dtype": str(value.dtype)}
    manifest = {"schema_version": 1, "complete": True, "synthetic": synthetic,
                "label_contract": training.LABEL_CONTRACT,
                "identity_contract": training.IDENTITY_CONTRACT,
                "sampling_rate_hz": 125, "samples_per_recording": 3750,
                "input_channels": 1, "output_order": ["SBP", "DBP"],
                "split_counts": {"train": n_train, "val": n_val},
                "arms": list(training.ARMS), "feature_names": [f"f{i}" for i in range(6)],
                "arrays": arrays}
    training.atomic_json(root / "manifest.json", manifest)
    return manifest


def args(data, out, **kw):
    result = dict(data_dir=data, output_dir=out, arm="raw", model="cnn", seed=125,
                  minutes=2, max_epochs=2, patience=1, batch_size=4, allow_cpu=True)
    result.update(kw)
    return argparse.Namespace(**result)


def prepared_fixture(root, data):
    """Exercise the real four-filter preparation path before CNN training."""
    (root / "ppg").mkdir(parents=True)
    (root / "labels").mkdir()
    times = np.arange(3750) / 125
    for split, name, shift in (("train", "p002", 0), ("val", "p001", 0.02)):
        (root / f"{split}_subjects.txt").write_text(name + "\n")
        waves = np.stack([0.5 + (1 + i / 50) * np.sin(2 * np.pi * (1 + i / 100 + shift) * times)
                          for i in range(30)]).astype(np.float32)
        labels = np.array([[110 + i / 2, 65 + i / 5] for i in range(30)], dtype=np.float32)
        np.save(root / "ppg" / f"{name}_ppg.npy", waves)
        np.save(root / "labels" / f"{name}_labels.npy", labels)
    prepare.prepare_dataset(root, data, synthetic=True)


class TrainingContracts(unittest.TestCase):
    def test_hash_tampering_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            data = Path(tmp) / "data"
            fixture(data)
            x = np.load(data / "X_raw_val.npy")
            x[0, 0, 0] += 1
            np.save(data / "X_raw_val.npy", x)
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                training.load_data(data, "raw", "cnn")

    def test_real_subject_overlap_rejected_even_with_updated_hashes(self):
        with tempfile.TemporaryDirectory() as tmp:
            data = Path(tmp) / "data"
            manifest = fixture(data)
            for name in ("patient_val.npy", "row_val.npy"):
                value = np.load(data / name)
                value[0] = 0
                np.save(data / name, value)
                manifest["arrays"][name]["sha256"] = training.sha256(data / name)
            training.atomic_json(data / "manifest.json", manifest)
            with self.assertRaisesRegex(ValueError, "patient overlap"):
                training.load_data(data, "raw", "cnn")

    def test_train_only_normalization_and_patient_macro(self):
        x = np.array([[[1, 3]], [[5, 7]]], dtype=np.float32)
        y = np.array([[100, 60], [140, 80]], dtype=np.float32)
        stats = training.fit_normalization(x, y)
        self.assertEqual(stats["input_mean"], 4)
        self.assertAlmostEqual(stats["input_std"], np.sqrt(5))
        self.assertEqual(stats["output_mean"], [120, 70])
        target = np.array([[100, 60], [100, 60], [100, 60]])
        pred = target + np.array([[1, 1], [1, 1], [10, 10]])
        measured = training.metrics(target, pred, [0, 0, 1])["outputs"]["SBP"]
        self.assertEqual(measured["mae"], 4)
        self.assertEqual(measured["patient_macro_mae"], 5.5)
        self.assertIsNone(measured["correlation"])

    def test_cpu_real_data_refused_and_existing_output_preserved(self):
        with tempfile.TemporaryDirectory() as tmp:
            data, out = Path(tmp) / "data", Path(tmp) / "out"
            fixture(data, synthetic=False)
            report = training.run(args(data, out))
            self.assertFalse(report["complete"])
            self.assertEqual(report["status"], "failed")
            self.assertIn("synthetic", report["failure"])
            digest = training.sha256(out / "report.json")
            with self.assertRaisesRegex(ValueError, "already exists"):
                training.run(args(data, out))
            self.assertEqual(digest, training.sha256(out / "report.json"))

    def test_budget_exhaustion_remains_incomplete(self):
        with tempfile.TemporaryDirectory() as tmp:
            data, out = Path(tmp) / "data", Path(tmp) / "out"
            fixture(data)
            report = training.run(args(data, out, minutes=1e-12))
            self.assertFalse(report["complete"])
            self.assertEqual(report["status"], "time_limit")
            self.assertTrue(report["time_limit_reached"])
            self.assertNotIn("metrics", report)

    def test_cnn_backward_and_serialized_predictions(self):
        import torch
        with tempfile.TemporaryDirectory() as tmp:
            data, out = Path(tmp) / "data", Path(tmp) / "out"
            prepared_fixture(Path(tmp) / "source", data)
            report = training.run(args(data, out))
            self.assertTrue(report["complete"], report["failure"])
            self.assertTrue(report["checkpoint_validation_reproduced"])
            checkpoint = torch.load(out / "best.pth", weights_only=True, map_location="cpu")
            selected = training.make_cnn()
            selected.load_state_dict(checkpoint["state_dict"])
            self.assertNotEqual(report["initial_model_sha256"], training.state_digest(selected))
            _, arrays, _ = training.load_data(data, "raw", "cnn")
            restored = training.cnn_predictions(selected, arrays["val"]["input"],
                                                checkpoint["normalization"], torch.device("cpu"), 4)
            with np.load(out / "private_predictions.npz", allow_pickle=False) as saved:
                np.testing.assert_allclose(restored, saved["val_prediction"], rtol=1e-6, atol=1e-5)
            self.assertEqual((out / "private_predictions.npz").stat().st_mode & 0o777, 0o600)
            self.assertLessEqual(report["selected_epoch"], report["epochs_completed"])
            self.assertTrue(report["input_hashes_unchanged"])

    def test_input_change_after_training_prevents_complete_report(self):
        with tempfile.TemporaryDirectory() as tmp:
            data, out = Path(tmp) / "data", Path(tmp) / "out"
            fixture(data)

            def changed_input(arrays, *unused_args, **unused_kwargs):
                predictions = {split: np.array(arrays[split]["y"]) for split in ("train", "val")}
                y = np.load(data / "y_val.npy")
                y[0, 0] += 1
                np.save(data / "y_val.npy", y)
                return predictions

            with patch.object(training, "train_cnn", side_effect=changed_input):
                report = training.run(args(data, out))
            self.assertFalse(report["complete"])
            self.assertEqual(report["status"], "failed")
            self.assertIn("Input array changed", report["failure"])

    def test_lightgbm_native_nan_training_and_reopen(self):
        import lightgbm as lgb
        with tempfile.TemporaryDirectory() as tmp:
            data, out = Path(tmp) / "data", Path(tmp) / "out"
            fixture(data, n_train=256, n_val=64)
            out.mkdir()
            _, arrays, _ = training.load_data(data, "raw", "lightgbm")
            report = {}
            prediction = training.train_lightgbm(arrays, out, 125, time.monotonic() + 60,
                                                  report, max_rounds=40, patience=10)
            self.assertEqual(report["outputs_completed"], 2)
            self.assertEqual(report["recipe"]["parameters"]["feature_fraction"], 0.9)
            self.assertEqual(report["recipe"]["parameters"]["bagging_fraction"], 0.9)
            self.assertEqual(report["recipe"]["parameters"]["bagging_freq"], 1)
            self.assertEqual(report["recipe"]["all_missing_train_columns"], 1)
            self.assertGreater(report["recipe"]["missing_train_fraction"], 0)
            self.assertTrue(np.isfinite(prediction["val"]).all())
            self.assertGreater(np.std(prediction["val"][:, 0]), 0)
            self.assertGreater(np.std(prediction["val"][:, 1]), 0)
            for j, label in enumerate(("sbp", "dbp")):
                model = lgb.Booster(model_file=str(out / f"best_{label}.txt"))
                restored = model.predict(arrays["val"]["input"], num_threads=1)
                restored = restored * report["normalization"]["output_std"][j] + report["normalization"]["output_mean"][j]
                np.testing.assert_allclose(restored, prediction["val"][:, j], rtol=0, atol=1e-12)


if __name__ == "__main__":
    unittest.main()

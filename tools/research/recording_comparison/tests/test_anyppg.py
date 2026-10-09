"""Synthetic protocol tests; no recorded waveforms or test split are needed."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import time
import unittest

import numpy as np

SOURCE = Path(__file__).resolve().parents[1] / "anyppg_probe.py"
SPEC = importlib.util.spec_from_file_location("anyppg_probe", SOURCE)
a = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(a)


def prepared(folder):
    manifest = {"schema_version": 1, "complete": True, "synthetic": True,
                "label_contract": a.LABEL_CONTRACT, "identity_contract": a.IDENTITY_CONTRACT,
                "sampling_rate_hz": 125, "samples_per_recording": 3750, "input_channels": 1,
                "output_order": ["SBP", "DBP"], "arms": ["raw"], "split_counts": {}, "arrays": {}}
    clock = np.arange(3750) / 125
    for split, ids, rows in (("train", [0, 0, 1, 1], [0, 1, 30, 31]), ("val", [2, 2], [60, 61])):
        n = len(ids)
        values = {
            f"X_raw_{split}": np.array([np.sin(2 * np.pi * (1 + i / 10) * clock) for i in range(n)], dtype=np.float32)[:, None, :],
            f"y_{split}": np.array([[110 + i * 2, 60 + i] for i in range(n)], dtype=np.float32),
            f"patient_{split}": np.array(ids, dtype=np.int64),
            f"row_{split}": np.array(rows, dtype=np.int64),
        }
        manifest["split_counts"][split] = n
        for name, value in values.items():
            filename = name + ".npy"
            np.save(folder / filename, value)
            manifest["arrays"][filename] = {"sha256": a.sha256(folder / filename), "shape": list(value.shape), "dtype": str(value.dtype)}
    a.write_json(folder / "manifest.json", manifest)
    return manifest


class AnyPPGProtocolTest(unittest.TestCase):
    def test_normalization_each_chunk_not_across_recordings(self):
        chunks = np.stack([np.arange(1250) * scale + offset for scale, offset in ((1, 0), (2, 1e4), (3, -500))])
        result = a.chunk_and_standardize(chunks.reshape(1, 1, 3750))
        self.assertEqual(result.shape, (3, 1, 1250))
        np.testing.assert_allclose(result.mean(axis=-1), 0, atol=1e-7)
        np.testing.assert_allclose(result.std(axis=-1), 1, atol=1e-6)
        np.testing.assert_allclose(result[0], result[1], atol=1e-6)

    def test_bad_waveforms_not_silently_dropped(self):
        for x in (np.ones((2, 1, 3750)), np.full((1, 1, 3750), np.nan), np.ones((1, 3750))):
            with self.assertRaises(ValueError):
                a.chunk_and_standardize(x)

    def test_ridge_hand_solvable_train_only(self):
        x = np.array([[-1.], [1.]])
        y = np.array([[100., 60.], [120., 80.]])
        model = a.fit_ridge(x, y, 2.)
        np.testing.assert_allclose(model["coefficients"], [[5., 5.]])
        np.testing.assert_allclose(a.predict_ridge(model, [[2.]]), [[120., 80.]])
        np.testing.assert_array_equal(model["feature_mean"], [0.])
        with self.assertRaises(ValueError):
            a.fit_ridge(x, y, 0)

    def test_global_identity_and_fingerprints(self):
        with tempfile.TemporaryDirectory() as t:
            path = Path(t)
            m = prepared(path)
            _, data, hashes = a.load_prepared(path)
            self.assertEqual(len(hashes), 9)
            self.assertEqual(len(data["y_train"]), 4)
            # Relabel validation to a training patient; update hashes so the split guard is tested.
            for name, value in (("patient_val.npy", [0, 0]), ("row_val.npy", [2, 3])):
                np.save(path / name, np.array(value, dtype=np.int64))
                m["arrays"][name]["sha256"] = a.sha256(path / name)
            a.write_json(path / "manifest.json", m)
            with self.assertRaisesRegex(ValueError, "patient identities overlap"):
                a.load_prepared(path)

    def test_tampered_input_rejected(self):
        with tempfile.TemporaryDirectory() as t:
            path = Path(t)
            prepared(path)
            target = np.load(path / "y_train.npy")
            target[0, 0] += 1
            np.save(path / "y_train.npy", target)
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                a.load_prepared(path)

    def test_patient_macro_metric_and_budget(self):
        target = np.array([[100., 60.], [100., 60.], [100., 60.]])
        pred = target + np.array([[1., 1.], [1., 1.], [7., 7.]])
        result = a.metrics(target, pred, [0, 0, 1])["outputs"]["SBP"]
        self.assertEqual(result["mae"], 3.)
        self.assertEqual(result["patient_macro_mae"], 4.)
        with self.assertRaises(a.BudgetExceeded):
            a.check_budget(time.monotonic() - 1)

    @unittest.skipUnless(os.environ.get("CDD_ANYPPG_ENCODER"), "Set CDD_ANYPPG_ENCODER for actual author-checkpoint integration.")
    def test_actual_encoder_ridge_pipeline(self):
        with tempfile.TemporaryDirectory() as t:
            folder = Path(t)
            data = folder / "data"
            data.mkdir()
            prepared(data)
            report = a.fit(Path(os.environ["CDD_ANYPPG_ENCODER"]), data, folder / "result", threads=2, batch_size=2, minutes=2)
            self.assertTrue(report["complete"], report.get("failure"))
            self.assertTrue(report["synthetic"])
            self.assertFalse(report["bp_accuracy_evaluated"])
            self.assertEqual(len(report["alpha_trials"]), 4)
            self.assertEqual(report["metrics"]["val"]["recording_count"], 2)
            self.assertTrue(report["source_and_input_hashes_unchanged"])
            self.assertEqual(report["provenance"]["pretraining_overlap_status"], "unresolved")
            saved = json.loads((folder / "result" / "report.json").read_text())
            self.assertEqual(saved["status"], "complete")
            self.assertEqual(saved["preparation_manifest_sha256"], a.sha256(data / "manifest.json"))
            # Saved, row-aligned predictions must reproduce the reported error.
            with np.load(folder / "result" / "private_val_predictions.npz", allow_pickle=False) as prediction:
                np.testing.assert_array_equal(prediction["row"], np.load(data / "row_val.npy"))
                recomputed = a.metrics(prediction["target"], prediction["prediction"], prediction["patient"])
                self.assertEqual(recomputed, saved["metrics"]["val"])
            # A spent budget produces a retained failure report, never partial success.
            failure = a.fit(Path(os.environ["CDD_ANYPPG_ENCODER"]), data, folder / "timeout", threads=2, minutes=1e-12)
            self.assertEqual(failure["status"], "time_limit")
            self.assertFalse(failure["complete"])


if __name__ == "__main__":
    unittest.main()

"""Synthetic contract tests; no recorded patient data or heavyweight ML imports."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

MODULE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MODULE_DIR))
import prepare
from features import ARMS, FEATURE_NAMES, filter_records, legacy_kalman_records


class PreparationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.root = self.base / "dataset"
        (self.root / "ppg").mkdir(parents=True)
        (self.root / "labels").mkdir()
        (self.root / "train_subjects.txt").write_text("p002\n")
        (self.root / "val_subjects.txt").write_text("['p001']\n")
        time = np.arange(3750) / 125
        for name in ("p001", "p002"):
            waves = np.stack([0.5 + np.sin(2 * np.pi * (1 + i / 100) * time) for i in range(30)]).astype(np.float32)
            labels = np.tile([125, 80], (30, 1)).astype(np.float32)
            np.save(self.root / "ppg" / f"{name}_ppg.npy", waves)
            np.save(self.root / "labels" / f"{name}_labels.npy", labels)
        self.out = self.base / "prepared"

    def test_complete_matched_cohort_hashes_and_never_test(self):
        wave_path = self.root / "ppg" / "p002_ppg.npy"
        waves = np.load(wave_path)
        waves[0, 0] = np.nan
        waves[1] = 0  # Retained even if morphology is missing.
        np.save(wave_path, waves)
        label_path = self.root / "labels" / "p002_labels.npy"
        labels = np.load(label_path)
        labels[2] = [70, 80]
        labels[3] = [250, 170]  # No research BP range truncation.
        np.save(label_path, labels)
        original_load = np.load
        opened = []
        def guarded_load(path, *args, **kwargs):
            opened.append(Path(path))
            self.assertNotIn("test", Path(path).name)
            self.assertNotIn("abp", Path(path).parts)
            return original_load(path, *args, **kwargs)
        with patch.object(prepare.np, "load", side_effect=guarded_load):
            report = prepare.prepare_dataset(self.root, self.out, synthetic=True)
        self.assertEqual(report["split_counts"], {"train": 28, "val": 30})
        self.assertTrue(report["complete"])
        self.assertTrue(report["synthetic"])
        self.assertEqual(report["cohort_accounting"]["train"]["rejected_recordings"], 2)
        self.assertEqual(set(opened), {self.root / kind / f"{name}_{kind}.npy"
                                      for kind in ("ppg", "labels") for name in ("p001", "p002")})
        self.assertEqual(len(report["arrays"]), 22)
        for filename, metadata in report["arrays"].items():
            array = np.load(self.out / filename, allow_pickle=False)
            self.assertEqual(list(array.shape), metadata["shape"])
            self.assertEqual(str(array.dtype), metadata["dtype"])
            self.assertEqual(prepare.sha256(self.out / filename), metadata["sha256"])
        train_ids = np.load(self.out / "patient_train.npy")
        val_ids = np.load(self.out / "patient_val.npy")
        self.assertTrue(np.all(train_ids == 1))
        self.assertTrue(np.all(val_ids == 0))
        np.testing.assert_array_equal(np.load(self.out / "row_train.npy"), np.r_[31, np.arange(33, 60)])
        self.assertEqual(np.load(self.out / "y_train.npy")[1].tolist(), [250, 170])
        for arm in ARMS:
            self.assertEqual(np.load(self.out / f"X_{arm}_train.npy").shape, (28, 1, 3750))
            self.assertEqual(np.load(self.out / f"feature_{arm}_train.npy").shape, (28, len(FEATURE_NAMES)))
        features = np.load(self.out / "feature_raw_train.npy")
        self.assertTrue(np.isnan(features[0]).any())
        public_text = (self.out / "manifest.json").read_text()
        self.assertNotIn("p001", public_text)
        self.assertNotIn("p002", public_text)
        self.assertEqual((self.out / "private_source_manifest.json").stat().st_mode & 0o777, 0o600)

    def test_named_overlap_fails(self):
        (self.root / "val_subjects.txt").write_text("p002\n")
        with self.assertRaisesRegex(ValueError, "patients overlap"):
            prepare.prepare_dataset(self.root, self.out)
        self.assertFalse(self.out.exists())

    def test_duplicate_identifier_fails(self):
        (self.root / "train_subjects.txt").write_text("p002\nP002\n")
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            prepare.prepare_dataset(self.root, self.out)

    def test_malformed_or_missing_source_fails(self):
        np.save(self.root / "labels" / "p002_labels.npy", np.zeros((29, 2)))
        with self.assertRaisesRegex(ValueError, "wrong shape"):
            prepare.prepare_dataset(self.root, self.out)
        (self.root / "labels" / "p002_labels.npy").unlink()
        with self.assertRaisesRegex(ValueError, "missing"):
            prepare.prepare_dataset(self.root, self.out)

    def test_existing_output_untouched(self):
        self.out.mkdir()
        marker = self.out / "keep.txt"
        marker.write_text("keep")
        with self.assertRaisesRegex(ValueError, "already exists"):
            prepare.prepare_dataset(self.root, self.out)
        self.assertEqual(marker.read_text(), "keep")

    def test_source_mutation_detected_no_complete_manifest(self):
        original_read = prepare.read_pair
        calls = 0
        def changing_read(paths, expected_hashes=None):
            nonlocal calls
            calls += 1
            if calls == 3:
                array = np.load(paths["labels"])
                array[0, 0] += 1
                np.save(paths["labels"], array)
            return original_read(paths, expected_hashes)
        with patch.object(prepare, "read_pair", side_effect=changing_read):
            with self.assertRaisesRegex(ValueError, "changed after preflight"):
                prepare.prepare_dataset(self.root, self.out)
        self.assertFalse((self.out / "manifest.json").exists())
        self.assertFalse(json.loads((self.out / "preparation_status.json").read_text())["complete"])

    def test_import_has_no_processing_effects(self):
        with patch.object(np, "load", side_effect=AssertionError("unexpected input read")):
            spec = importlib.util.spec_from_file_location("prepare_import_only", MODULE_DIR / "prepare.py")
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)

    def test_kalman_matches_scalar_legacy(self):
        samples = np.array([[0.2, 0.7, 0.9, -0.1], [2., 1., 3., 4.]])
        expected = []
        for row in samples:
            x, p, q, r = 0., 1., 1e-5, 1e-2
            current = []
            for value in row:
                prior = x
                prior_p = p + q
                gain = prior_p / (prior_p + r)
                x = prior + gain * (value - prior)
                p = (1 - gain) * prior_p
                current.append(x)
                residual = value - prior
                q = .99 * q + .01 * residual ** 2
                r = .99 * r + .01 * residual ** 2
            expected.append(current)
        np.testing.assert_array_equal(legacy_kalman_records(samples), expected)


if __name__ == "__main__":
    unittest.main()

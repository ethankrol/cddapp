"""Pooling numerical/weight compatibility and actual CPU training checks."""
from pathlib import Path
import sys
import unittest

import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import train
import pooling_preflight


class PoolingCorrection(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        torch.set_num_threads(4)

    def test_bins_forward_and_backward_match_native_float64(self):
        # 235 is the actual post-convolution length for a 3750-sample recording.
        for length in (1, 3, 4, 8, 11, 234, 235, 236):
            with self.subTest(length=length):
                torch.manual_seed(53)
                native_x = torch.randn(2, 3, length, dtype=torch.float64, requires_grad=True)
                fixed_x = native_x.detach().clone().requires_grad_(True)
                native = torch.nn.AdaptiveAvgPool1d(4)(native_x)
                corrected = train.make_adaptive_mean_pool(4)(fixed_x)
                torch.testing.assert_close(corrected, native, rtol=1e-13, atol=1e-13)
                upstream = torch.randn_like(native)
                native.backward(upstream)
                corrected.backward(upstream)
                torch.testing.assert_close(fixed_x.grad, native_x.grad, rtol=1e-13, atol=1e-13)

    def test_overlapping_bins_are_preserved(self):
        # For L=5 and O=4 the bins are [0:2], [1:3], [2:4], [3:5].
        x = torch.arange(5, dtype=torch.float64).reshape(1, 1, 5).requires_grad_(True)
        pooled = train.make_adaptive_mean_pool(4)(x)
        torch.testing.assert_close(pooled, torch.tensor([[[0.5, 1.5, 2.5, 3.5]]], dtype=torch.float64))
        pooled.sum().backward()
        torch.testing.assert_close(x.grad, torch.tensor([[[0.5, 1., 1., 1., 0.5]]], dtype=torch.float64))

    def test_same_weight_initialization_keys_and_full_model_forward(self):
        # Build the original recipe independently; the parameterless pooling
        # replacement must not shift layer indices or consume random numbers.
        def original():
            class Original(torch.nn.Module):
                def __init__(self):
                    super().__init__()
                    layers, inc = [], 1
                    for outc, kernel in ((16, 15), (32, 9), (64, 7), (128, 5)):
                        layers.extend([torch.nn.Conv1d(inc, outc, kernel, stride=2, padding=kernel // 2),
                                       torch.nn.GroupNorm(4, outc), torch.nn.ReLU()])
                        inc = outc
                    self.features = torch.nn.Sequential(*layers, torch.nn.AdaptiveAvgPool1d(4))
                    self.head = torch.nn.Sequential(torch.nn.Flatten(), torch.nn.Linear(512, 64),
                        torch.nn.ReLU(), torch.nn.Dropout(0.1), torch.nn.Linear(64, 2))
                def forward(self, x):
                    return self.head(self.features(x))
            return Original()
        for seed in (125, 126, 127):
            torch.manual_seed(seed)
            old = original()
            torch.manual_seed(seed)
            fixed = train.make_cnn()
            self.assertEqual(list(old.state_dict()), list(fixed.state_dict()))
            self.assertEqual(train.state_digest(old), train.state_digest(fixed))
            self.assertEqual(sum(x.numel() for x in old.parameters()), sum(x.numel() for x in fixed.parameters()))
            fixed.load_state_dict(old.state_dict(), strict=True)
            old, fixed = old.double().eval(), fixed.double().eval()
            x = torch.randn(2, 1, 3750, dtype=torch.float64)
            with torch.no_grad():
                self.assertEqual(old.features[:-1](x).shape[-1], 235)
                torch.testing.assert_close(fixed(x), old(x), rtol=1e-12, atol=1e-12)

    def test_full_model_cpu_strict_backward_repeat_and_reload(self):
        report = pooling_preflight.run_preflight(device="cpu", batch_size=4)
        self.assertTrue(report["passed"], report["failure"])
        self.assertTrue(report["repeated_training_exact"])
        self.assertTrue(report["checkpoint_reload_exact"])
        self.assertTrue(torch.are_deterministic_algorithms_enabled())

    def test_gpu_preflight_never_silently_falls_back_to_cpu(self):
        from unittest.mock import patch
        with patch.object(torch.cuda, "is_available", return_value=False):
            report = pooling_preflight.run_preflight(device="cuda", batch_size=1)
        self.assertFalse(report["passed"])
        self.assertIn("no CPU fallback", report["failure"])


if __name__ == "__main__":
    unittest.main()

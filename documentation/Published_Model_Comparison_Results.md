# Four-model comparison: results and next decision

Reviewed September 27, 2026, America/New_York. Experiment folder uses UTC: `published_model_benchmark_20260928T003408542282Z`.

## What finished

Rithika supplied the HiPerGator summary for all four models and all three predeclared seeds (125, 126, 127). All 12 rows report `complete`, every model has an empty caution list, and the controller reports `Contract errors: []`. The means and sample standard deviations below were independently recalculated from the pasted per-seed values and match the supplied summary.

This is user-run training evidence. The assistant has not independently accessed the cluster, reread these checkpoint bytes or received the full per-run reports. Empty caution lists do not expose each model's selected epoch or exact stopping reason; those details remain in the full reports.

## The result in plain English

**The new architectures did not produce a large accuracy improvement under this experiment's inputs and training recipe.** All four ended around 13 mmHg average SBP error and 8.6–8.7 mmHg average DBP error. A lower MAE means a smaller average absolute error. It does not mean every prediction is wrong by exactly that amount.

| Model | SBP MAE, mean ± seed SD | DBP MAE, mean ± seed SD | Parameters in the verified implementation |
|---|---:|---:|---:|
| Small CNN | 13.0435 ± 0.0444 | **8.6337 ± 0.0226** | 464,962 |
| cBP-Tnet | **12.9911 ± 0.0997** | 8.6854 ± 0.0478 | 5,219,394 |
| XResNet1D-50 adaptation | 12.9929 ± 0.0328 | 8.7328 ± 0.0322 | 970,146 |
| Inception1D adaptation | 13.0140 ± 0.0142 | 8.7162 ± 0.0355 | 589,826 |

Units are mmHg. Bold marks only the lowest numerical mean in each column. SD measures variation across three random training seeds; it is not a confidence interval across patients and does not establish statistical superiority or equivalence. Parameter counts come from the previously exercised local architecture code, not from newly supplied runtime reports.

Compared with the small CNN:

| Model | Change in SBP MAE | Change in DBP MAE |
|---|---:|---:|
| cBP-Tnet | −0.0524 | +0.0518 |
| XResNet1D-50 | −0.0506 | +0.0992 |
| Inception1D | −0.0295 | +0.0826 |

Negative means improvement; positive means worse error. The small CNN has the lowest DBP error in every seed. The average of its SBP/DBP MAEs is 10.8386, versus 10.8382 for cBP-Tnet. That arithmetic average follows the equal-output selection criterion, but neither output should be hidden by it.

The six CNN/Tnet values also reproduce the previously supplied three-seed comparison values to their available printed precision. That supports continuity of the comparison. It does not independently prove historical cache-to-patient mapping or label quality.

## Development decision

Keep the small CNN as the practical baseline for the next research experiment. It uses about one eleventh as many parameters as cBP-Tnet (91.1% fewer) while these validation errors are very close. This is a development choice, not proof that it is more accurate. Parameter count also does not determine actual phone latency, energy or whole-app memory; a new export/device test would measure those.

The completed tests evaluated **adapted published backbones** on the existing three-channel padded-beat inputs plus the shared timing treatment. They did not reproduce the authors' complete longer-window experiments. This result does not show that XResNet or Inception is generally ineffective, or that other training/input choices cannot help.

No deployment decision follows yet. The original ONNX model remains the identified tested phone package; these research checkpoints require their own export, output-scaling contract and device tests before any replacement.

## What this does and does not diagnose

Similar aggregate errors across four architectures make data/label preparation and the shared training recipe useful next investigations. The result alone does not identify the cause of the remaining error.

Earlier source and sample audits found concrete issues to investigate: a rise-time proxy measured in peak-to-peak segments often lands at an endpoint, and ABP labels are selected from a longer window that can include later beats. Physiological alignment between PPG and ABP must be considered when designing an alternative; simply using matching array indices is not automatically a correction. The filter-only audit did not measure BP accuracy, and changing a filter alone did not fix the endpoint-based feature definition.

Recommended next steps:

1. Inspect the saved full summary/per-run diagnostics: training versus validation MAE, correlation, prediction spread, selected epochs and stopping reasons. This requires no retraining.
2. Define a small preprocessing/label experiment with stable patient/segment/beat identifiers. Preserve the old cache as the comparison. Change one declared factor at a time, calculate each arm's normalization from training only, and count rejected recordings/beats.
3. Use the small CNN to screen those alternatives under a fixed recipe; compare against population and appropriate personal-reference baselines. Keep final evaluation separate from tuning.
4. Once a candidate shows a useful, reproducible gain, freeze its processing contract, export it, and repeat device parity/performance tests.

The currently supplied table contains no patient-level predictions, confidence intervals, new final-test-set result, calibration evaluation or wearable-sensor result. Historical cache identity remains reconstructed, not certified. The test data have been examined in earlier project work; planning a final evaluation must account for that history.

## All twelve supplied validation results

| Seed | Model | SBP MAE | DBP MAE |
|---|---|---:|---:|
| 125 | Small CNN | 13.0077 | 8.6517 |
| 125 | cBP-Tnet | 13.0071 | 8.6811 |
| 125 | XResNet1D-50 | 12.9962 | 8.7225 |
| 125 | Inception1D | 13.0082 | 8.6954 |
| 126 | Small CNN | 13.0932 | 8.6408 |
| 126 | cBP-Tnet | 12.8844 | 8.7352 |
| 126 | XResNet1D-50 | 13.0239 | 8.7689 |
| 126 | Inception1D | 13.0036 | 8.7572 |
| 127 | Small CNN | 13.0297 | 8.6084 |
| 127 | cBP-Tnet | 13.0818 | 8.6399 |
| 127 | XResNet1D-50 | 12.9586 | 8.7071 |
| 127 | Inception1D | 13.0301 | 8.6961 |

## Retrieve the existing diagnostic report

Run on the Mac:

```bash
scp rmathew1@hpg.rc.ufl.edu:/orange/xiangyan/rithika/cdd/outputs/iphone_inference/published_model_benchmark_20260928T003408542282Z/benchmark_summary.json ~/Downloads/
```

Attach that JSON for the next review. It contains aggregate research results; this command does not copy cache arrays, patient-list snapshots or checkpoint weights. The per-run files remain under `seed_<seed>/<model>/validation_report.json` if further diagnosis is needed.

## Evidence files

`supplied_console_results.json` is an explicitly labeled transcription of the pasted numerical results. `recomputed_analysis.json` contains independent arithmetic calculations from that transcription. Neither is the original `benchmark_summary.json`. No GitHub push or additional training was performed during this interpretation.

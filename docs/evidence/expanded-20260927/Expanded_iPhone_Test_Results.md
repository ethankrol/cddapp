# Expanded iPhone tests: what passed and what remains

Reviewed September 27, 2026. The supplied reports record tests on September 25, 2026. These are runs performed by Rithika in the iPhone app; the assistant inspected and recalculated their reports.

## The main result

**Yes: the original “only four beats” limitation has now been addressed for the synthetic fixture.** The full test processed all 31 original candidate beats and every candidate in five shifted versions of that recording: **189 model calls**. The longer tests also ran all candidates in each scheduled window.

| Supplied test | What the app did | Windows | Successful model calls | Result |
|---|---|---:|---:|---|
| Full candidate test | Original 30-second signal plus five shifted windows | 6 | 189 / 189 | Pass |
| Five-minute fixed blocks | Process one completed 30-second block every 30 seconds | 10 | 310 / 310 | Pass |
| Five-minute rolling windows | Process the latest 30 seconds every 5 seconds | 55 | 1,732 / 1,732 | Pass |
| Twenty-minute fixed blocks | Continue the block schedule for 20 minutes | 40 | 1,240 / 1,240 | Pass |
| Five-minute idle control | Pace and buffer samples, without creating a model session | 0 | 0; intentionally no inference | Idle protocol passed |

The four inference runs total **3,471 successful model calls across 111 windows**, with zero reported Python-comparison failures, no reported run/cleanup errors, and successful session release. Calls and overlapping windows reuse the synthetic fixture; they are not 3,471 independent heartbeats from patients.

## What “blocks” and “rolling” mean

Suppose we are receiving new PPG samples continuously:

- **Blocks:** wait for seconds 0–30 and process them; next process seconds 30–60; then 60–90.
- **Rolling:** first process seconds 0–30; five seconds later process seconds 5–35; then 10–40. Each update reuses most of the previous window.

The app has now exercised both schedules using a prerecorded synthetic signal delivered in one-second chunks. The rolling run produced 55 windows in five minutes because the first result waits for the initial 30-second buffer.

This implementation reprocesses a complete window and resets the legacy Kalman filter for each window. Its peak detector also examines the complete window. It is therefore a tested window-based replay implementation. A continuous sensor connection, missing-packet handling and a filter that carries state across the entire acquisition remain separate work.

## Why the calculations are fast

Collecting 30 seconds of new data takes 30 seconds. Calculating from those stored samples takes much less time. The model weights stay fixed while the app feeds it one candidate beat at a time.

| Run | Average complete-window processing | Slowest complete window | Average model call* |
|---|---:|---:|---:|
| Full candidate test | 155.89 ms | 163.67 ms | 2.78 ms |
| Five-minute blocks | 189.68 ms | 207.25 ms | 2.99 ms |
| Five-minute rolling | 195.66 ms | 216.13 ms | 2.96 ms |
| Twenty-minute blocks | 186.29 ms | 202.00 ms | 2.92 ms |

*Recomputed from each window's reported call average, weighted by its candidate count. Individual call samples are not provided here, so this is not an independently calculated per-call p95 benchmark. Complete-window timing includes preprocessing, normalization, reference checks, model calls and cooperative scheduling; session setup occurs separately.

All replay windows finished in less than **217 ms**. The replay reports recorded zero arrivals more than one second late; their largest recorded arrival lag was about **17.2 ms**. This supports keeping up with these synthetic schedules in these runs. The code's deadline threshold is one second; “zero deadline misses” does not mean zero timing jitter.

The all-candidate test completed in about **1.075 seconds** because its data were already present. The twenty-minute replay took about **1,200.338 seconds**, because it deliberately waited for simulated arrivals.

The replay input buffer reached at most **3,750 samples**, or 30 seconds at 125 Hz. This shows the input buffer was capped. It does not measure whole-app memory: the app also holds model/runtime memory and accumulated test-report rows.

## Agreement with Python

The maximum reported phone-versus-Python differences across these runs were:

- SBP: **0.0000228882 mmHg**.
- DBP: **0.0000114441 mmHg**.
- Allowed difference: **0.01 mmHg for each output**.

Every window reports zero raw-feature, timing-feature and normalized-input differences. The full report includes 189 phone/expected output pairs; their maximum differences, means and medians were independently recalculated and agree with the report. Replay reports contain summaries rather than every output pair, so their unreported arrays cannot be independently recalculated here.

The expected outputs in the full report are the bundled Python reference values. The original full Python reference JSON has not been attached for an independent reference rerun. The six reported application-source fingerprints match the previously prepared local source files. These checks establish report consistency and source correspondence; bundled fingerprints are not runtime attestation.

## A small change when the same beat appears in another window

There are two distinct comparisons:

1. **Phone versus Python:** same input window, different runtimes. This is the pass/fail check above.
2. **Window sensitivity:** the same exact beat interval can appear inside two different windows. Its processing context changes, so its output can change slightly.

For matched intervals, the largest window-to-window changes were **0.0118027 mmHg SBP** and **0.0092430 mmHg DBP**. The SBP value is slightly larger than 0.01, but the 0.01 threshold applies to phone-versus-Python agreement, not this separate sensitivity diagnostic. The software has no acceptance threshold for window sensitivity, so its reported PASS is consistent with the implemented test.

The full run contains 130 adjacent matched-interval comparisons; the rolling run contains 1,404. Recalculated full-run comparisons match exactly. Rolling summaries match the six-window phase pattern, including repeated-fixture wraps. These overlapping comparisons are not independent observations.

Filter resets and whole-window peak detection provide plausible reasons for context sensitivity. These reports cannot isolate the contribution of each. Before real recording-level aggregation, define how to handle startup transients and repeated beats across overlapping windows. The current means and medians are per-window software diagnostics; the app does not pool all rolling predictions into a single BP reading.

## What the idle result means

Your inline report has `mode: "idle"`, `attempted: 0`, and `inferencePassed: null`. That is expected: it is a comparison workload that paces and buffers samples without running the model. `sessionReleased: false` is also expected because this mode never creates a model session.

Its successful completion could support a future paired power measurement. However, `energyMeasured: false` means it contains **no battery or energy result**. An idle timing run alone cannot measure the energy saved or used by inference.

## Updated completion status

| Work | Status after these reports |
|---|---|
| All 31 original synthetic beats through the full pipeline | Complete |
| All six synthetic reference windows | Complete: 189 calls |
| Five-minute fixed and rolling replay | Complete |
| Twenty-minute fixed-block replay | Complete |
| Twenty-minute rolling replay | No supplied result yet; optional next endurance extension |
| Physical-device inference memory observations | Earlier five-cycle measurement exists; memory was not measured during these longer runs |
| Energy and genuine cold-start measurement | Still pending |
| Real sensor/BLE collection, motion and dropped samples | Still pending |
| Calibration collection UI/storage and real measurement aggregation | Still pending; pure calibration core and documentation already prepared |
| Useful BP accuracy on new people | Not evaluated by these synthetic tests; original model accuracy limitations remain |
| External model training | Still pending integration of the requested research source ZIP |

The original on-device mock-inference assignment is supported by this evidence, including its performance observations and explicit limitations. The monthly calibration documentation is already prepared. These engineering results do not improve or remeasure the original model's clinical prediction accuracy.

## Reproducing this review

Unzip `cdd-expanded-results-20260927.zip`, then run:

```bash
cd cdd-expanded-results-20260927
python3 audit_expanded_reports.py
```

This reads the saved reports, verifies their preserved hashes, recomputes counts/schedules/statistics and checks the full output arrays and overlap summaries. It does not run ONNX, train a model or connect to the phone.

The four original attachment byte streams are preserved under `reports/` with descriptive JSON filenames. The idle report is a field-preserving transcription of the inline JSON. `evidence_manifest.json` distinguishes these origins; `analysis_summary.json` contains calculated metrics. Tests ran September 25 at 18:50–19:48 EDT, with breaks between runs; they were supplied for this review on September 27.

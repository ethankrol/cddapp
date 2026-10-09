# GitHub check and the next blood-pressure tests

Your GitHub update contains the original model that passed the iPhone software tests. We also ran that exported model again on a computer using every beat in the expanded synthetic reference. All 189 predictions passed. This confirms that the saved software package works consistently; it does not show that its blood-pressure estimates are accurate for a person.

The next research experiment asks whether giving a model a longer recording, changing the filtering, or describing the pulse shape explicitly helps it learn more useful information. It has been prepared for HiPerGator. No new patient-data training results are claimed in this document.

## What was checked on GitHub

Repository: `ethankrol/cddapp`, branch `rithika-ML`, commit `bf4ae5a12b8bcad8cc204735bfc68e9dd66e1cec` (`documentation`). The remote branch was checked again while preparing this handoff. This statement applies to that branch and commit; it does not mean the same files are merged into `main`.

| File | What it does | Finding |
|---|---|---|
| `python code/cBP-Tnet_Model.pth` | Stores the original learned model weights for Python | Matches the checkpoint used for the exported phone package |
| `assets/models/onnx_export/cbp_tnet.onnx` | Stores the converted model the phone actually runs | Matches the tested phone model |
| `assets/models/onnx_export/normalization.json` | Stores the training-data scaling numbers used before prediction | Matches the tested package |
| `assets/ppg-expanded/full_ppg_reference_v1.json` | Contains artificial input and saved expected results | All 189 candidates in six windows checked on the computer |
| `docs/evidence/expanded-20260927/` | Contains reports from the earlier iPhone runs | Saved reports are internally consistent |
| `documentation/benchmark_summary.json` | Contains the completed four-model, three-seed comparison | All 12 runs present; reported averages and sample standard deviations checked |

“Matches” means the file's SHA-256 fingerprint—an identifier calculated from all its bytes—is the expected one. It identifies the original tested package. It does **not** mean this checkpoint is the most accurate model we could build. The newer research checkpoints have not replaced the model in the app.

The exact fingerprints and computer inference results are saved in [host_onnx_verification.json](evidence/repository-check-20260928/host_onnx_verification.json).

## What was actually run here

The new computer check uses the repository's JavaScript preprocessing, its saved normalization, and the real ONNX model through ONNX Runtime on a CPU. ONNX is a portable model-file format; ONNX Runtime is the program that evaluates that file.

| Check | Result | What it establishes |
|---|---|---|
| Full synthetic input | 31 candidates in the original window, plus five shifted windows; 189 predictions total | Coverage now includes every candidate, not only the original first four |
| Preprocessing and scaling | Exact agreement with the saved synthetic reference | The computer applies the expected transformations |
| Prediction agreement | Maximum SBP difference `0.0000076294` mmHg; DBP `0.0000038147` mmHg; tolerance `0.01` | The actual exported model reproduces the saved outputs |
| Replay and failure handling | 12 software checks passed | Scheduling, all-candidate coverage, bounded buffers, cancellation, late arrivals and errors behave as expected with a test clock and test model |
| Inference adapter | 6 checks passed | Tensor cleanup, input/output validation and session cleanup work with an instrumented runtime substitute |

The replay checks deliberately use an accelerated clock and a small replacement model to test the program's behavior. Their timing is not phone performance. The separate 189-call check uses the real model. Neither is a new physical-iPhone test.

The existing iPhone reports describe 3,471 successful model calls over 111 windows across four inference runs. Those were user-run Release-app tests with synthetic data. The idle control intentionally made no inference calls. Rechecking these reports does not recreate their device measurements.

The research package also passed 34 local Python checks with no failures or skips, including actual synthetic CNN training, LightGBM fitting, the pinned AnyPPG encoder, and a separate-process preparation → worker → summary check. Scheduler submissions were mocked; no cluster jobs were launched. Versions and source fingerprints are recorded in [research_software_checks.json](evidence/repository-check-20260928/research_software_checks.json).

To rerun the existing-model software checks from the repository root:

```bash
node --test tools/tests/bp_replay_checks.cjs tools/tests/bp_adapter_checks.cjs
python3 tools/tests/verify_bp_package.py
```

The second command requires NumPy, Node and ONNX Runtime; the recorded run used `onnxruntime==1.19.2`. Research-check dependencies and commands are in the experiment README. These commands do not launch HiPerGator training or physical-iPhone tests.

## Why try something else when four models gave similar errors?

The earlier comparison changed the network while keeping the same short beat inputs and legacy labels. Its three-run average errors were:

| Model | SBP average error (mmHg) | DBP average error (mmHg) |
|---|---:|---:|
| Small CNN | 13.0435 | 8.6337 |
| cBP-Tnet | 12.9911 | 8.6854 |
| XResNet1D50 adaptation | 12.9929 | 8.7328 |
| Inception1D adaptation | 13.0140 | 8.7162 |

These close results do not prove that better methods do not exist. They suggest that another larger network alone may not address the main problem. Input construction, reference labels, sensor differences and the information actually present in PPG may matter more. These were adaptations of model families, not exact reproductions of their published studies.

The original beat code also had a questionable “upstroke” feature: its beat began at a peak, so asking where the maximum occurred usually pointed to a boundary. Filtering alone cannot fix that definition. The new feature experiment uses interior pulse-shape measurements and labels them as exploratory measurements, not validated physiological landmarks.

## What the new HiPerGator comparison does

PPG is the light-sensor waveform that changes with the pulse. At 125 samples per second, 30 seconds contains 3,750 numbers. The new comparison predicts one SBP/DBP pair for each such recording, using its provided recording-level label.

| Method | Plain-English description | Runs |
|---|---|---:|
| Recording CNN | Learns from the entire 30-second waveform | Four filters × three starting seeds = 12 GPU runs |
| Pulse features + LightGBM | Measures pulse shape, variation and frequency, then combines many small decision trees | Four filters × three seeds = 12 CPU runs |
| Frozen AnyPPG + ridge regression | Reuses a published pretrained waveform encoder, then fits a small prediction layer | One exploratory GPU run |

The four filter options are the unchanged waveform, the legacy Kalman filter, a causal bandpass filter and an offline bandpass filter. A bandpass filter keeps a chosen frequency range. “Causal” means a filtered value does not need future samples. The offline version can look both forward and backward within a completed recording. All filters in this experiment restart at each recording; it is not a test of continuous live filtering across recording boundaries.

Each run gets the same accepted training and validation recordings. Training patients and validation patients must be different. The preparation code assigns stable patient and recording identifiers and checks the source-file fingerprints. It does not use the old beat cache or the test split. Learned scaling comes only from training data.

The feature-based method uses 45 explicitly defined measurements, including pulse rise/fall time proxies, widths, frequency content and variation. Missing pulse landmarks remain missing values handled by LightGBM; they do not secretly remove difficult rows from just one method. These are our exploratory features, not a certified signal-quality screen or a reproduction of a published feature-extraction package.

AnyPPG is kept separate in the interpretation because its pretraining data may overlap this dataset's patient population. A good score there would be a reason to investigate further, not proof of performance on previously unseen patients. Its frozen encoder sees three 10-second pieces; their embeddings are averaged before fitting the prediction layer. This is an adaptation, not the author's full paper protocol.

**The new errors must first be compared against each other and their own constant baselines.** A “baseline” here predicts the training mean or median for everyone. The new recording task uses different inputs and reference labels from the old beat task. A lower number than 13/8.6 by itself would not prove that a particular model or filter caused an improvement.

The provided recording labels' exact physiological meaning has not been independently certified. The named train/validation split is checked afresh, but that cannot prove the original source dataset has no duplicate people under different identifiers. Both limitations remain explicit in the reports.

## How to run and read it

The runnable commands and resource limits are in [the recording-comparison README](../tools/research/recording_comparison/README.md). Submit from a HiPerGator login terminal. Slurm, the cluster's job scheduler, runs the actual work on allocated compute nodes; the terminal may be closed after submission succeeds.

The experiment creates a new timestamped directory under `/orange/xiangyan/rithika/cdd/outputs/iphone_inference/`. It snapshots its source code and writes its own prepared arrays, checkpoints and reports there. The app's existing model, historical caches and old experiments are not modified. Patient-level files and predictions stay on the cluster; share the aggregate `summary.md`, `summary.json` or `summary.csv`.

There are at most two GPU tasks at once and two CPU model tasks at once. Each model worker has a 45-minute software budget inside a one-hour allocation. Preparation has a two-hour limit. The complete default plan requests up to 13 GPU-hours and 12 CPU-worker-hours, plus preparation and summary; queue delays are additional. Early stopping may make it shorter. This is not a promise that all jobs finish in a few minutes.

The summary keeps failed, missing and timed-out runs visible. A filter/model group gets a three-seed average only if all three runs complete. A timeout is an incomplete experiment, not a successful score. Do not rerun only unfavorable seeds or choose a winner from a partially completed comparison.

## What still requires work

| Item | Current status | Next step |
|---|---|---|
| Correct original model in GitHub | Verified at the commit above | Keep these fingerprints with the device evidence |
| Synthetic on-device execution | Existing iPhone evidence plus fresh computer verification | Rerun device checks after a future model or app change |
| New filter/model BP accuracy | Experiment prepared; no new patient results yet | Submit the HiPerGator job and inspect every declared run |
| Actual wearable data | Not covered by artificial-signal replay | Integrate acquisition, timestamps, lost samples, motion and signal-quality handling |
| Battery use and true cold app startup | Still unmeasured | Measure on the physical iPhone with a controlled protocol |
| Memory | Earlier whole-app sampled memory test exists | It does not establish zero leaks or long-duration energy cost |
| Monthly calibration | Design documented; core code previously added | Finish collection UI/storage and evaluate paired cuff/PPG measurements over time |
| Clinical BP accuracy | Not established | Requires suitable independent reference measurements and a separate validation study |

Calibration means correcting a person's estimates using reference measurements from a cuff. For example, if paired calibration measurements average 120 mmHg SBP while the model averages 112, a simple offset is +8 mmHg. Later, a raw estimate of 115 becomes 123. The DBP correction is calculated separately. Weighting can give more influence to suitable, recent reference pairs. Neither an offset nor a monthly reminder proves the model can track changes between cuff readings; that needs evaluation against a reference-only baseline. The full existing [plain-English project guide](../documentation/BP_Project_Explained_Simply2.md) explains the proposed monthly workflow, stale/missing calibration, storage and open questions.

The phone's fast test is expected: it evaluates fixed learned weights on a small buffered input. Training those weights happens on HiPerGator. The phone does not retrain the model or hold an unlimited recording in memory. Receiving 30 seconds of live samples still takes 30 seconds; processing that already collected window can take much less time.

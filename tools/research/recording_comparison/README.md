# Whole-recording blood-pressure research comparison

This experiment asks whether giving the model a complete **30-second PPG recording**, or changing how that recording is cleaned and described, improves prediction. PPG is the pulse-shaped signal measured by a light sensor. This is a new research comparison; it does not replace the model already tested on the iPhone.

## What runs

Every matched comparison uses the same newly prepared training and validation recordings and their provided SBP/DBP labels. SBP is the upper blood-pressure number; DBP is the lower number. One prediction is made per 30-second recording.

| Method | Inputs | Runs |
|---|---|---:|
| Recording CNN | Complete waveforms; a small neural network learns patterns | 4 filters × 3 seeds = 12 GPU runs |
| LightGBM | Measurements of waveform shape, timing and frequency; boosted decision trees | 4 filters × 3 seeds = 12 CPU runs |
| AnyPPG frozen encoder + ridge | A published pretrained encoder describes three 10-second chunks; a small fitted predictor uses their average description | 1 optional GPU run |

The four filter arms are `raw` (no additional filter), `legacy_kalman` (the earlier project's smoother), `bandpass_causal` (a 0.5–8 Hz filter using only present/past samples), and `bandpass_offline` (forward/backward filtering, which also uses future samples). Filters reset at each recording. This is not a streaming sensor implementation. The two bandpass methods also have different effective responses; this comparison does not isolate phase alone.

A **seed** is the number controlling repeatable random choices. Seeds 125, 126 and 127 are all retained. LightGBM samples 90% of rows and 90% of features with explicit seeds; each seed is repeatable. These repetitions describe training variability, not three independent patient samples.

The hand-built feature measurements are an interpretable baseline. They are not validated physiological landmarks or a reproduction of the pyPPG toolkit. Missing feature values remain missing and LightGBM handles them without fitting an imputation rule on validation data.

AnyPPG is exploratory: its pretraining includes MIMIC-related data, so overlap with these patients is unresolved. Its result cannot establish accuracy on patients the encoder has never seen. See [ANYPPG.md](ANYPPG.md).

## Run on HiPerGator

From a checkout containing this folder:

```bash
python3 tools/research/recording_comparison/experiment.py \
  --submit --base-dir /orange/xiangyan/rithika/cdd
```

The controller creates a new timestamped experiment folder, copies and fingerprints the code, submits Slurm jobs, and prints their IDs and the exact summary command. Once submission finishes, you can close the terminal. No USB connection or Mac is needed.

To inspect the planned jobs without writing files or submitting:

```bash
python3 tools/research/recording_comparison/experiment.py \
  --preview --base-dir /orange/xiangyan/rithika/cdd
```

Add `--skip-anyppg` to either command to run only the 24 matched CNN/LightGBM jobs.

The input folder must contain:

- `mimic_bp/train_subjects.txt` and `mimic_bp/val_subjects.txt` with disjoint named patients.
- `mimic_bp/ppg/<patient>_ppg.npy`, shaped `(30, 3750)` at 125 Hz.
- `mimic_bp/labels/<patient>_labels.npy`, shaped `(30, 2)`, ordered SBP then DBP.

File naming and shapes are checked before preparation. The test list, test files, old beat caches, phone package and existing models are not used or modified. The private source manifest records actual patient names and source-file fingerprints on HiPerGator. Do not commit prepared data or private prediction files to GitHub.

## Scheduling and dependencies

1. One CPU job prepares a common cohort and all four filter representations. It has 4 CPUs, 64 GB memory and a two-hour limit.
2. After successful preparation, two arrays start independently: 12 CNN jobs plus optional AnyPPG on B200 GPUs, and 12 LightGBM jobs on CPUs. Each array runs at most two tasks at once.
3. A small CPU summary job runs after the arrays end, including when individual model jobs fail. Missing, timed-out and failed runs remain visible in the summary.

Each model task has a 45-minute software budget inside a one-hour Slurm allocation. Default allocation ceilings are 13 GPU-hours, 12 CPU worker-hours and two CPU preparation-hours; these are resource-hour limits, not a promise that the experiment will finish in that many wall-clock hours. Queue time is additional. There are at most two simultaneous GPU tasks, not 13.

Jobs load `pytorch/2.8.0`; reports record the actual installed versions because a module name alone does not identify them. CPU jobs use `hpg-default` with `el9`; GPU jobs use `hpg-b200`. No account/QoS is forced. Site/account availability may require editing a new controller copy before submission.

Preparation checks LightGBM 4.6.0 and, if needed, installs it only into the new experiment's dependency folder. It also downloads two pinned public AnyPPG files with checksum verification. If either optional dependency cannot be obtained, the related workers fail explicitly while CNN jobs remain eligible to run. Successful download is not guaranteed on restricted compute-node networks.

If `sbatch` fails partway through submission, the controller records which jobs were already submitted and stops. **Do not blindly run the submission command again.** Inspect `submitted_jobs.json`, `submission_*.json` and `squeue`; already submitted jobs may still be running.

## Find results

The submission prints an experiment directory such as:

```text
/orange/xiangyan/rithika/cdd/outputs/iphone_inference/recording_comparison_<timestamp>
```

Use the exact directory from that submission:

```bash
experiment_dir='/orange/xiangyan/rithika/cdd/outputs/iphone_inference/recording_comparison_<timestamp>'
python3 "$experiment_dir/runtime/experiment.py" --summary --experiment-dir "$experiment_dir"
```

The results are `summary.json`, `summary.csv` and `summary.md`. Logs are under `logs/`. Each completed worker writes `report.json`; its checkpoint, normalization parameters and private predictions stay in its own new run folder.

A **lower MAE** means the average absolute error is smaller. Compare each method with the training-mean and training-median baselines: these predict the same number for every validation recording. A useful model should improve on those simple guesses. The report also records correlation, prediction variation and patient-average error.

All three declared seeds must finish before a group receives an average. Failed runs are never silently dropped. The summary verifies source, preparation, row, patient and label fingerprints. For CNN filter comparisons it also checks matched initial weights and overlapping epoch sample orders. A failed comparison contract prevents the summary from declaring the experiment complete. Descriptive numbers must not be promoted as a valid comparison if contract errors are listed.

## Training and evaluation rules

- Train and validation patients receive globally unique numeric IDs in the fresh preparation. This avoids the historical problem of comparing split-local integer IDs as if they were global patient identities.
- The preparation retains one common recording cohort across all filters. Nonfinite signals/labels or nonpositive/reversed pressure labels are accounted for; missing files and shape errors stop preparation. Flat waveforms are retained in matched arms and diagnosed, rather than silently removed. AnyPPG rejects a constant chunk explicitly if it cannot standardize it.
- CNN input and target scaling are fitted using training data only. Validation determines early stopping and checkpoint selection, not normalization statistics.
- CNN checkpoints use the lowest equal-weight mean of SBP and DBP validation MAE. LightGBM fits two regressors and selects each output's own validation stopping iteration. These are different declared training recipes, not a claim to isolate architecture alone.
- AnyPPG weights stay frozen. Ridge strength is selected from a declared four-value grid using validation data. Its chunk-wise standardization follows a separate encoder input contract.
- The supplied recording labels are accepted as SBP/DBP, but their exact physiological definition and relation to the raw waveform have not been independently certified. This experiment does not repair or validate the legacy per-beat ABP alignment.
- Results are development validation results. Repeated choices based on this validation set require a later independent evaluation. Seed-to-seed standard deviation is not a patient confidence interval.

**Do not directly subtract this experiment's MAE from the older ~13/8.6 mmHg beat-model MAE.** The prediction unit and labels changed from individual beats to whole recordings. Within this new experiment, compare methods on the identical recording cohort and baselines.

## Reproduce software checks locally

The scheduler checks need Python and NumPy for the real AnyPPG command parser; they use mocked Slurm submission and never submit jobs:

```bash
python3 -m unittest discover -s tools/research/recording_comparison/tests -p 'test_scheduler.py' -v
```

Preparation/training/encoder checks have separate tests in the same folder. They require their respective NumPy/SciPy, PyTorch and LightGBM dependencies. Synthetic test results establish that the software path runs and rejects broken inputs; they do not measure blood-pressure accuracy.

To include the actual pinned AnyPPG checkpoint in all local checks, set `CDD_ANYPPG_ENCODER` to the folder containing the verified `resnet1d.py` and `anyppg_ckpt.pth`, then run:

```bash
CDD_ANYPPG_ENCODER=/path/to/encoder \
  python3 -m unittest discover -s tools/research/recording_comparison/tests -v
```

Without this variable the real-encoder integration checks are explicitly skipped. The CLI integration test prepares a small synthetic dataset, invokes each worker as a separate process, then checks that the summary accepts their actual reports and keeps all unrun tasks visible. No Slurm jobs are submitted by the local tests.

## What this does not finish

This package does not provide new patient MAE until it runs on HiPerGator. It does not export a winning model, update the app, collect live PPG/BLE data, apply personal calibration, measure phone battery use, or measure genuine cold app startup. Those require later evaluation and, for phone measurements, access to the physical device.

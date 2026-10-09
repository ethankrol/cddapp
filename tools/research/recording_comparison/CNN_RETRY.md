# CNN retry: what failed and how to finish the comparison

Prepared October 7, 2026. This package addresses the 12 CNN failures in
`recording_comparison_20260929T151510000082Z`.

## In plain English

The CNN has a step that averages short sections of its internal signal. During training, PyTorch also needs to calculate how that averaging step affects learning. The GPU implementation of that calculation conflicts with the strict repeatability setting used by this experiment. That is why all 12 CNN jobs stopped before finishing their first training pass.

This is a software failure; these failed runs tell us nothing about the CNN's BP accuracy. The earlier CPU checks did not exercise this GPU-only failure. The retry now starts with a small test on an actual allocated GPU before allowing the 12 training jobs to start.

The fix calculates the same four averages using slices and means. It preserves the boundaries, including overlapping boundaries, the number of model weights, the starting weights, the seeds, and the training settings. The arithmetic can round slightly differently from the original pooling kernel. Strict repeatability remains enabled.

PyTorch documents the unsupported deterministic CUDA backward operation here:
https://docs.pytorch.org/docs/2.10/generated/torch.use_deterministic_algorithms.html

## What this retry does

1. Checks that the original experiment has exactly the known 12 CNN failures and 13 completed LightGBM/AnyPPG reports.
2. Creates a new results folder next to the original experiment. Copies the 25 original report files byte-for-byte into it for reference.
3. Submits a GPU check: verifies the prepared data hashes, trains the corrected CNN for two synthetic steps twice with the same seed, checks finite gradients and identical repeated results, and verifies save/reload behavior.
4. Starts the 12 CNN jobs only if that check succeeds. Runs at most two GPU jobs at once.
5. Combines the new CNN results with the 13 original completed results. Keeps the old CNN failures in the record and labels carried results clearly.

The original prepared train/validation data are reused. Nothing is written to the original experiment, the phone package, the model used by the phone, or the test split. No LightGBM or AnyPPG training is repeated.

Each CNN job has a 45-minute software budget within a one-hour GPU allocation. The initial GPU check has a ten-minute allocation. Queue time is additional. A timed-out or failed job remains incomplete and is not silently included in an average.

## Checks completed here

- Five pooling checks: output and gradient agreement with native pooling across multiple lengths, overlapping bins, unchanged initial weights for seeds 125/126/127, actual CPU training/reload, and refusal to fall back to CPU when CUDA is requested.
- Eleven retry checks: preserved original reports, correct job dependencies, failed-GPU-check blocking, partial submission receipts, input tampering detection, and complete/incomplete combined summaries.
- Eight existing training checks: actual synthetic CNN training and checkpoint reload, LightGBM training, train-only normalization, patient separation, changed-data detection, and incomplete-run handling.

All 24 checks passed locally. CPU PyTorch: 2.8.0+cpu. Slurm and GPU results in controller tests are mocked; they are not evidence of a B200 pass. The real B200 check and the 12 reruns must run on HiPerGator using the commands below.

## Run it

Download `cdd-cnn-retry.zip` to your Mac's Downloads folder.

In the Mac terminal:

```bash
scp ~/Downloads/cdd-cnn-retry.zip \
  rmathew1@hpg.rc.ufl.edu:/orange/xiangyan/rithika/cdd/
```

Complete Duo, then paste this in the HiPerGator terminal:

```bash
(
set -e
cd /orange/xiangyan/rithika/cdd
retry_runner=$(mktemp -d /orange/xiangyan/rithika/cdd/cnn-retry-runner.XXXXXX)
unzip -q cdd-cnn-retry.zip -d "$retry_runner"
python3 "$retry_runner/cdd-cnn-retry/verify_package.py"
python3 "$retry_runner/cdd-cnn-retry/retry_cnn.py" \
  --submit \
  --parent-experiment /orange/xiangyan/rithika/cdd/outputs/iphone_inference/recording_comparison_20260929T151510000082Z
)
```

This submits Slurm jobs, so it is safe to close the terminal after job IDs appear. An iPhone or USB cable is not needed.

The script prints the new results folder, job IDs, `squeue` command, and the exact summary command. Save that output. The new folder name starts with `recording_cnn_retry_`.

To inspect results later, run the printed summary command. It has this form (replace the example path with the path printed during submission):

```bash
python3 /path/printed/recording_cnn_retry_TIMESTAMP/runtime/retry_cnn.py \
  --summary --experiment-dir /path/printed/recording_cnn_retry_TIMESTAMP
```

Files in that new folder:

| File | Meaning |
|---|---|
| `preflight.json` | Actual GPU check, software versions, repeated-training and input-hash results |
| `logs/preflight_*.log` / `.err` | Initial GPU-check output and errors |
| `logs/cnn_*.log` / `.err` | CNN training output and errors |
| `summary.json`, `summary.csv`, `summary.md` | Combined results for all 25 planned runs |
| `parent_reports/` | Exact copies of the original 25 reports, including the failed CNN attempts |
| `runs/cnn/` | New CNN reports and research checkpoints |
| `submitted_jobs.json` | Submitted Slurm job IDs |

If the GPU check fails, the CNN array will not start. Share `preflight.json` and its error log. If submission stops partway through, inspect `submitted_jobs.json`, `submission_failure.json`, and `squeue` before submitting again; some jobs may already exist.

## What the completed results currently say

These numbers come from the summaries you supplied; they are not new local training results.

| Method | SBP average error | DBP average error | Scope |
|---|---:|---:|---|
| LightGBM + raw signal | 13.2394 | 8.5688 | Mean across three seeds |
| LightGBM + legacy Kalman filter | 13.1932 | 8.5222 | Mean across three seeds |
| LightGBM + causal bandpass | 13.2480 | 8.7217 | Mean across three seeds |
| LightGBM + offline bandpass | 13.2692 | 8.5969 | Mean across three seeds |
| AnyPPG + fitted regression head | 12.9665 | 8.4890 | One exploratory frozen-encoder run |
| Training-mean constant baseline | 13.9523 | 9.6022 | Always predicts the training average |
| Training-median constant baseline | 13.8809 | 9.5498 | Always predicts the training median |
| CNN, all filters | Pending | Pending | Original 12 jobs failed before epoch 1 |

Errors are MAE in mmHg: the average size of the difference from the reference BP, ignoring whether the prediction was too high or too low. Smaller is better.

AnyPPG's earlier training data may overlap with these patients, so its result remains exploratory. These are development-validation results using recording-level labels whose exact clinical interpretation remains uncertified. They do not establish a clinical winner, and they should not be compared directly with the earlier beat-level MAEs.

The next useful result is the completed CNN/filter comparison on this same cohort. This retry does not replace the model currently in the app. A replacement would require a separate selection, export, and phone verification step.

## Implementation details for reviewers

Original worker SHA-256:
`cfacec2dbef239336dbf5744f77304a6eaa96e02a940e0e31d0d12cd970a516f`.

The corrected pooling identifier is `adaptive_bins_slice_mean_stack_v1`. For input length `L` and four outputs, bin `i` is `floor(i*L/4):ceil((i+1)*L/4)`. At the actual post-convolution length of 235, adjacent bins overlap as in native adaptive average pooling. Replacing it with a simple reshape into four groups would change the calculation.

The retry checks each report against the worker version that produced it: the corrected source for new CNN jobs, and the original source for carried LightGBM and AnyPPG reports. Combined summaries also check shared labels, recording identities, patient identities, constant baselines, initial CNN weights, and overlapping training sample orders. No partial-seed means are produced.

The new runner is a standalone handoff. These changes have not been pushed to GitHub; the connected integration previously rejected writes. Repository cleanup or publishing is separate from executing this retry.

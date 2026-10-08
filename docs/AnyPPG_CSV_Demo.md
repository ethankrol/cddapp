# AnyPPG CSV demo and session handoff

Updated October 8, 2026. Research software demonstration; not a validated wearable BP measurement.

## What changed

Blood Pressure now has a CSV import card. It runs the frozen AnyPPG encoder plus the **already-fitted recording-level ridge predictor** from HiPerGator. The encoder summarizes a signal; the ridge predictor is a saved set of weights that turns the summary into two BP estimates. This update did not train, calibrate or tune the model toward a desired BP.

The old test screens retain their old model and evidence. The new model is an exploratory candidate, not an established accuracy winner. User-operated physical iPhone tests previously validated the original package. The assistant's new export and CSV checks ran on a host CPU, not an iPhone.

## What to show your boss

Rebuild/install the Release app, open Blood Pressure, choose the sensor site or Not sure, then **Import CSV & calculate**. Select the original three-column CSV in Files. Every window and both channels appear on the BP page, labelled experimental. No Normal/Low/High classification or health-journal entry is created.

The supplied recording has 1,322 logged pairs over 48.723 seconds. Approximate expected outputs:

| Channel | Window from first print | AnyPPG SBP / DBP, mmHg |
|---|---|---:|
| Red | 0–29.992 seconds | 99.5865 / 72.4538 |
| Red | 18.728–48.720 seconds | 103.6619 / 70.8066 |
| Infrared | 0–29.992 seconds | 101.5599 / 69.9864 |
| Infrared | 18.728–48.720 seconds | 104.5136 / 71.4146 |

These are predictions, not errors against a reference and not four independent patients. Older results near 98/48 came from cBP-Tnet. An MAE of 12.97/8.49 means average historical errors of those many mmHg; it is not a BP reading of 12.97/8.49. Without a matching cuff reading, this person's true BP and prediction error remain unknown. We must not force a rested person's output to 120/80.

## Exact input and model contract

- CSV header: `time_stamp_millis,RawRed,RawIR`. Maximum 4 MiB and 30,000 rows; duration 30 seconds to 10 minutes. The separate inspection screen understands newer raw-count captures, but this demo rejects them pending a separate acquisition review.
- Reject non-finite/oversized numbers, non-increasing timestamps, incorrect window size and constant chunks. Gaps over 1 second are rejected as a conservative demo interpolation limit, **not a validated physiological quality rule**. Smaller gaps still do not prove usable pulse morphology.
- Subtract the first timestamp. Linearly interpolate to `0, 8, 16, ...` milliseconds through the last grid point. Never extrapolate. Print times remain an unverified substitute for sample acquisition times.
- Process every non-overlapping full 3,750-sample window plus, if needed, one overlapping final window ending at the final grid point. No pooled recording BP.
- Process red and infrared separately. Split each window into three 1,250-sample chunks. Compute population mean/std in double precision; normalize `(value - chunk_mean) / (chunk_std + 1e-8)`; then cast to float32. Reject std at or below `1e-12`. No extra filtering, polarity flip or guessed gain conversion.
- Encoder ONNX input `chunks`: float32 `[3,1,1250]`; output `features`: float32 `[3,512]`. Average the three vectors in float32. Apply the saved BP head in JavaScript Number/double precision: `((features - feature_mean) / feature_std) @ coefficients + target_mean`. Output order: SBP, DBP in mmHg.
- The head's means/stds/coefficients come from training. Never refit them on the imported file or reuse cBP-Tnet's `normalization.json` for this model.
- App runtime: ONNX Runtime React Native 1.24.3, CPU, one intra/inter-op thread, **graph optimization disabled**. Manifest hashes identify intended assets; bundled hash strings are not runtime cryptographic attestation.

## Conversion findings and completed checks

Default ONNX Runtime optimization initially failed: maximum BP differences across 24 synthetic windows were about 3.93/11.68 mmHg. Disabling optimization restored agreement. The exact optimizer transformation was not independently localized. We did not change the trained weights or relax the 0.01 mmHg tolerance.

With optimization disabled, all 24 synthetic windows passed: maximum differences approximately **0.0000501/0.0000365 mmHg**. On all four actual-CSV windows, JavaScript interpolation and standardization matched the independent Python normalized inputs exactly. The complete JS preparation → host ONNX → JS BP-head calculation differed from Python by at most **0.0000221/0.0000397 mmHg**.

These verify software conversion, not BP accuracy or the physical device. TypeScript, focused lint, automated lifecycle/invalid-input tests and iOS JavaScript bundling are separate checks. A successful JavaScript export is not an Xcode native build or iPhone execution. The new model's physical memory, energy and cold startup remain unmeasured; old-model measurements do not transfer automatically.

## Reproduce the tests

1. Follow the root README to rebuild the existing iOS workspace in Release.
2. Tap **Check model with a synthetic signal**. Four generated channel windows must match Python within 0.01 mmHg. Share the report.
3. Import the actual CSV. Confirm four results and compare with the table. If different, preserve the report and investigate; do not change scales until values look familiar.
4. Repeat import; try Cancel during inference and a malformed/short CSV. Verify stale results clear on a new run, failures do not appear as success, and the journal is unchanged.
5. Retain the shared report with the app build, phone model and iOS version. It records model/head hashes, assumptions, per-window outputs/timing and runtime settings; no raw waveforms.

Host checks, after installing Python dependencies:

```bash
python tools/anyppg/export.py
npm run test:anyppg
python tools/anyppg/verify_csv.py \
  --csv /path/to/private-recording.csv \
  --out /path/to/new-private-verification.json
```

The verifier requires a new output path. Versions used: Python 3.12.14, PyTorch 2.8.0+cpu, NumPy 2.3.5, ONNX 1.17.0 and ONNX Runtime 1.19.2. The phone runtime differs (1.24.3), so the phone fixture remains necessary. Exact `.pth` encoder, architecture, `.npz` BP head and training report live in `tools/anyppg/source/`. No GPU is needed for these small inference/export checks; training comparisons used HiPerGator GPUs.

## Red, infrared, finger and wrist

Our code uses **one optical channel at a time**. Red and infrared are separate optical views, not the derivative channels in the old model. Neither is established as better on this sensor. Keep both and compare to paired cuff truth; never choose whichever output looks normal.

Some papers use a single channel; others train a model to combine wavelengths. A 2025 study found gains from learned multi-channel fusion on its own subject-split dataset [1]. That does not establish that averaging our two BP outputs will help. A future comparison should predeclare red-only, infrared-only and fusion methods, and evaluate them against paired BP on held-out people.

A 22-participant finger-versus-wrist study found different processing was needed and cautioned against transferring finger models directly to wrist PPG [2]. Its sensors also differed in wavelength/acquisition mode, so location alone cannot explain the difference. Record body site, optical sensor, geometry, LED settings, contact pressure and motion. ESP32-C3 identifies the controller, not the optical sensor or sample clock.

## Normalization versus personal calibration

**Normalization** changes the signal's scale before prediction. It is part of the model's recipe. **Calibration** compares estimates to reliable cuff readings for that person and corrects a consistent bias after prediction.

Illustrative example only: model 110/70 and matched cuff 120/80 imply offsets +10 SBP and +10 DBP. Future raw output 114/73 becomes 124/83. Estimate separate offsets from several valid paired measurements. This example is not a correction to apply to the uploaded file; we do not know this person's cuff BP.

The proposed weighted approach averages the differences `cuff - model`, separately for SBP and DBP, giving more influence to accepted high-quality matched sessions. Use equal weights until a quality-weighting rule is validated. In symbols, offset = sum(weight × difference) / sum(weight), then corrected prediction = raw prediction + offset. Do not assign confidence from how normal an output looks.

Store each reference reading, paired model output, timestamp, participant/device/site, model/preprocessing version, acceptance reason and weight. Store the derived offsets, creation/expiry dates and profile version separately. Keep original and corrected outputs distinguishable.

A monthly reminder is a proposed schedule, not a proven correction lifetime. Collect references with a validated upper-arm cuff following its instructions and a consistent measurement protocol, paired closely with stable PPG. Cuff inflation can disturb the optical signal on the same limb; define and test the paired protocol. Exclude calibration observations from the later evaluation data.

Missing, expired, unmatched or incompatible calibration must not silently activate an offset. The current CSV demo explicitly remains uncalibrated. Cuff draft storage and the calibration calculation library are separate. A model, preprocessing or sensor/site change requires checking profile compatibility and usually new calibration. Set expiry/drift rules using longitudinal evidence; month-long stability has not been shown.

Evaluate raw versus corrected error on later held-out references, with simple reference-only baselines and subject-level uncertainty. The older K=5 calibration result almost tied its reference-mean baseline, so the improvement alone did not establish useful waveform learning. Open questions include number/timing of paired sessions, quality weights, agreement limits, expiry and whether personalization transfers between finger and wrist.

## Firmware and next session

The original `.ino` and logger were received in `CDD_DataCollection.zip`. The sketch uses `SparkFun_Bio_Sensor_Hub_Library`, discards a sensor read before another read, subtracts a moving baseline and logs readout/print timing. `RawRed` and `RawIR` are therefore processed AC values despite their names.

The diagnostic replacement is `tools/recordings/firmware/CDD_RawCapture/CDD_RawCapture.ino`. It records raw counts/readout metadata but has not been compiled or flashed on the team's ESP32-C3. Confirm board variant, wiring/I²C pins and optical hub/sensor before use. Sensor model and finger/wrist location remain unknown; do not fill them from earlier component shopping links.

Next: verify the current branch/build, run the new phone check, fix acquisition and collect matched cuff references. Do not launch more training automatically or overwrite the original model. AnyPPG pretraining overlap with the MIMIC-derived cohort remains unresolved.

## Sources

1. Liang et al., *Generalizable Blood Pressure Estimation from Multi-Wavelength PPG Using Curriculum-Adversarial Learning*: https://arxiv.org/abs/2509.12518 . Trained fusion on that dataset, not this sensor recording.
2. Paliakaitė et al., *Blood Pressure Estimation Based on Photoplethysmography: Finger Versus Wrist* (2021): https://www.cinc.org/archives/2021/pdf/CinC2021-020.pdf .
3. AnyPPG author repository, input requirements and attribution: https://github.com/Ngk03/AnyPPG . This package uses the pinned revision recorded in its manifest, originally fetched from https://github.com/PKUDigitalHealth/AnyPPG . No new ownership or license claim is made for the authors' architecture/checkpoint.
4. American Heart Association, low blood pressure and symptoms: https://www.heart.org/en/health-topics/high-blood-pressure/the-facts-about-high-blood-pressure/low-blood-pressure-when-blood-pressure-is-too-low . Software estimates cannot diagnose hypotension. Unexpectedly low actual cuff readings, particularly with dizziness or fainting, need medical advice.

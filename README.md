# CDD blood-pressure research app

Updated October 8, 2026. **Start here when picking up this project in a new session.**

The new Blood Pressure page accepts the team's CSV and displays **experimental AnyPPG estimates**, separately for red and infrared light. These numbers have not been validated against matching cuff readings. They are not entered into the health journal.

## Try the CSV demo

1. Install this update into `/Users/rithika/Desktop/cddapp`, then run `npm ci`.
2. Build the existing iOS workspace in Release and install it on the iPhone. Keep the customized native project; do not use a clean prebuild.
3. Open **Blood Pressure → Check model with a synthetic signal**. It should match Python within 0.01 mmHg. Share that report to record the new model's actual iPhone test.
4. Put the original CSV in the iPhone's Files app. Choose **Import CSV & calculate**. Select Finger, Wrist or Not sure based on what the collection team confirms.
5. The supplied 48.723-second recording produces four results: two windows for each optical channel. The final window overlaps the first to cover the recording's end.

```bash
cd /Users/rithika/Desktop/cddapp
npm ci
npm run test:recordings
npm run test:anyppg
npx tsc --noEmit
open ios/cddapp.xcworkspace
```

In Xcode choose the `cddapp` scheme and your physical iPhone. Under **Product → Scheme → Edit Scheme → Run → Info**, select Release, then Run. The known Expo CLI simulator-detection error can be avoided by building this existing workspace. USB is the simplest way to install; an already paired wireless device may work. Once the Release app and its assets are installed, inference does not need a connected Mac or a server.

## Which model is used?

| Flow | Saved model and scaling | Status |
|---|---|---|
| New CSV card on Blood Pressure page | `assets/models/anyppg/anyppg_encoder.onnx` + `ridge_head.json`; input scaling in `services/anyppg/core.js` | Host checks passed; new physical iPhone result still needed |
| Existing Test ML model screens | `assets/models/onnx_export/cbp_tnet.onnx` + its `normalization.json` | Original model previously tested by Rithika on the iPhone with synthetic inputs |
| Reproduce the new export | `tools/anyppg/source/anyppg_ckpt.pth`, `resnet1d.py`, `ridge_probe.npz`, `training_report.json`; `tools/anyppg/export.py` | Exact uploaded candidate; no retraining in this update |

**ONNX** is the portable file format used to run a trained model in the app. A `.pth` stores the training framework's weights. The phone uses the `.onnx`, not the `.pth`. AnyPPG's encoder alone does not predict BP: the saved `ridge_head.json` is also required.

Old results around **98/48** and new AnyPPG results around **100–105 / 70–72** came from different model pipelines. More familiar-looking numbers do not prove better accuracy. There is no simultaneous cuff measurement for this CSV. The model comparisons remain development experiments, not certification for this sensor.

## What happens when you import a CSV?

1. Read `time_stamp_millis,RawRed,RawIR`. Its print timestamps are an approximate clock; actual sensor timing is still unknown.
2. Fill evenly spaced positions at 125 samples per second by drawing straight lines between recorded points. This does not recover lost pulses or prove the sensor recorded at 125 Hz.
3. Take full 30-second windows, each split into three 10-second pieces.
4. Subtract each piece's average and divide by its spread. This gives AnyPPG the expected input scale; it does not force BP toward 120/80.
5. The encoder summarizes each piece into 512 numbers. Average the three summaries, apply the saved training statistics and BP predictor, and display systolic/diastolic output.
6. Repeat independently for red and infrared. Channels are not combined, and overlapping windows are not pooled into one reading.

**Required runtime setting:** `graphOptimizationLevel: 'disabled'`. Default ONNX Runtime optimization failed conversion parity for this graph. The exporter, host verification and app all disable it. Do not change this without rerunning the checks.

## Completed and pending

Completed: original-model physical-iPhone synthetic execution/performance/memory tests reported by Rithika; several HiPerGator model/filter comparisons; actual CSV inspection; original and saved AnyPPG host inference; new AnyPPG export with matching JavaScript preprocessing and saved BP head; CSV result UI, cancellation/error handling, provenance and reproducible checks. No fitting to this unlabelled recording was performed.

Still pending:

- Install this update, run the **new** model's synthetic check and actual CSV import on the physical phone, and share reports. Earlier phone tests used the old model.
- Confirm optical sensor/board variant, I²C pins, acquisition rate, sample loss and finger versus wrist placement. **Controller confirmed: ESP32-C3.** The original `.ino` was received and reviewed. A diagnostic replacement exists in `tools/recordings/firmware/CDD_RawCapture/` but has not been compiled/flashed/tested here.
- Collect stable recordings paired with reference cuff readings. Compare red and infrared before choosing a channel or trained fusion method.
- Integrate and validate personal calibration; test drift over days/weeks. A monthly reminder is a proposed policy, not a proven correction lifetime.
- Validate live BLE acquisition, signal quality, accuracy, energy and cold startup for the new model. AnyPPG's possible pretraining overlap with the MIMIC cohort remains unresolved.

## GitHub status at preparation

On October 8, the remote `rithika-ML` branch still pointed to `bf4ae5a12b8bcad8cc204735bfc68e9dd66e1cec`. The attempted GitHub write returned **403: Resource not accessible by integration**. This code was prepared and checked locally; installing it does not by itself publish it. Use the delivery installer to apply/commit the update, then push from your authenticated Mac and verify the remote commit.

## Documentation

- [CSV demo, exact processing, results, calibration explanation and research](docs/AnyPPG_CSV_Demo.md)
- [Plain-language calibration and earlier phone tests](docs/BP_Project_Explained_Simply.md)
- [Engineering/calibration design](docs/CDD_Blood_Pressure_Engineering_Status_and_Calibration.md)
- [Actual sensor review and collection instructions](docs/Actual_Sensor_Data_Review_and_Next_Steps.md)
- [Repository organization](docs/Repository_Organization.md)
- New export provenance/synthetic fixture: `assets/models/anyppg/`.
- New verification evidence: `docs/evidence/anyppg-20261008/`.

Keep private CSVs outside Git, for example in `private-recordings/`. Import stays local and deletes only the picker's temporary copy. Displayed results remain in memory until cleared/replaced or the screen is destroyed. Sharing a report is a user action; reports contain predictions/timing metadata, not raw waveform arrays. This update adds no npm dependencies.

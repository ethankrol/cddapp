# Your first sensor recording: what we found and what to do next

**October 8 update:** Controller confirmed as ESP32-C3. Optical hub/sensor, board variant, I²C pins, acquisition clock and finger/wrist placement are still unconfirmed. A separate [AnyPPG CSV demo](AnyPPG_CSV_Demo.md) now supports explicitly experimental inference with print-time interpolation; the inspection-only checks below do not constitute a BP accuracy test.

Reviewed October 7, 2026. This review uses the CSV, Arduino sketch and Python logger in the uploaded `CDD_DataCollection.zip`. The separate SerialPlot Windows installer was not run.

## What this file lets us do

We can check that numbers reached the computer, inspect both light channels and diagnose the collection software. We cannot yet measure the model's blood-pressure error from this file: it contains no reference cuff readings, and its sampling does not match the phone model's input requirements.

This does **not** erase the successful iPhone tests. Those tests showed that the phone could execute the model correctly on prepared artificial examples. This recording introduces a different question: are the real sensor numbers collected and prepared in a compatible way?

## What is in the recording?

| Check | Result | Meaning |
|---|---:|---|
| Logged rows | 1,322 | Each row contains a time, red value and infrared value. |
| First-to-last time | 48.723 seconds | The file spans almost 49 seconds. |
| Overall logging rate | 27.11 pairs/second | Calculated as 1,321 gaps divided by 48.723 seconds; this is not a verified sensor sampling rate. |
| Smallest / median / largest gap | 9 / 21 / 345 ms | Rows are not evenly spaced. |
| Repeated or reversed timestamps | 0 | The saved timestamps increase. This does not prove that all sensor samples were saved. |
| Numeric validity | All values finite | There are no NaN/infinite values or malformed rows in this CSV. |
| Original unprocessed light readings | Not preserved by the supplied sketch | A moving baseline is subtracted before saving. |
| Paired cuff readings | None | We cannot calculate BP accuracy or a personal correction. |

The phone's current preparation code expects **125 samples per second**, evenly spaced 8 ms apart. It expects **3,750 samples for a 30-second window**. Calling this file “125 Hz” or stretching its 1,322 values to 3,750 would invent timing. Proper resampling may eventually be appropriate, but first we need the real acquisition clock and a way to detect lost samples. Resampling cannot recover information that was never recorded.

The file has large changes around 5 and 41 seconds, followed by gradual decay. Those changes could reflect contact changes, movement or changes in acquisition; the file does not tell us which. The supplied baseline-removal calculation can turn a sudden level change into a long decaying transient. We must not treat those large changes as blood-pressure changes.

## The concrete firmware issue

In the supplied `loop()`, the code reads the sensor once at the top, checks the number of queued readings, then reads again inside the `if` block. Only the second result is printed.

The manufacturer's library implementation reads from the sensor hub's output queue when `readSensor()` is called. Therefore the first result is discarded, and it is also read before checking availability. This is a collection defect. The exact number of readings lost cannot be recovered from this CSV because it lacks acquisition sequence numbers. It is not established that this defect explains every timing gap.

The code then updates a moving average and subtracts it. Consequently, `RawRed` and `RawIR` contain baseline-subtracted values. The `normalizeWindow()` function and 250-value arrays are defined but never used in this sketch, so the file is **not** being normalized in five-second windows by that function.

The `millis()` value is obtained when printing the processed result. It is not a timestamp generated when the light sensor originally acquired that value. Queued readings can be printed at different times from their acquisition.

The code uses `SparkFun_Bio_Sensor_Hub_Library`, which targets the MAX32664/MAX30101 sensor-hub setup. That is different from the earlier proposed SFH-7050A and ADXL366 components. Confirm the board actually used; this code is not a driver for those earlier parts.

## What this update adds

1. **An app screen: “Inspect a sensor recording.”** It reads the existing three-column CSV and the new diagnostic six-column CSV, checks row timing and values, and explains missing information. It also accepts a fully described JSON format. It does not turn an incompatible file into a BP reading.
2. **A diagnostic firmware sketch.** `tools/recordings/firmware/CDD_RawCapture/CDD_RawCapture.ino` removes the discarded read, checks availability first, preserves original red/IR counts, and logs an emitted-row sequence, read start/end times and queue occupancy. It stops on setup errors.
3. **A configurable computer logger.** `tools/recordings/capture_serial.py` accepts a serial port and output path, refuses overwrites, counts malformed lines, and creates a companion JSON with firmware fingerprint, library version and collection metadata. It never sets a guessed sensor sampling rate.
4. **Local cuff draft storage.** The cuff log stores the reference, time, device and matching recording ID on the phone. A saved draft is labelled unmatched and does not activate calibration. The storage adapter also validates saved calibration profiles, checks identity/expiry, and refuses fallback to an older profile after revocation.

The new firmware has not been compiled for your board or tested on hardware. It is a diagnostic starting point. The public library does not expose the underlying read status through `readSensor()`. Growing queue occupancy, read errors and true sample timing still require board-specific verification. Emitted-row sequence numbers detect gaps after the firmware assigns the number; they cannot prove there were no earlier sensor/FIFO losses.

## Next: collect a diagnostic recording on the sensor computer

1. Confirm the actual board, controller, reset/MFIO pins, installed SparkFun library version and sampling settings with the person who built the sensor. Keep the original sketch as a backup.
2. In Arduino IDE, open the new `CDD_RawCapture.ino`, select the correct board and port, compile it, and upload only after those settings are confirmed. This does not set the sensor to 125 Hz.
3. Close SerialPlot and the Arduino Serial Monitor before starting the logger; only one program should own the serial port.
4. Install the logger dependency and list ports:

```bash
python3 -m pip install pyserial
python3 -m serial.tools.list_ports
```

On Windows, use `py` instead of `python3` if that is your Python launcher. The example below assumes you are at the repository root. Replace the port and the descriptive values with the actual setup:

```bash
python3 tools/recordings/capture_serial.py \
  --port COM4 \
  --format raw \
  --seconds 90 \
  --participant-code P001 \
  --recording-id R001 \
  --sensor-description "ACTUAL BOARD AND MEASUREMENT SITE" \
  --library-version "ACTUAL INSTALLED VERSION" \
  --firmware-file tools/recordings/firmware/CDD_RawCapture/CDD_RawCapture.ino \
  --out private-recordings/P001_R001.csv
```

On macOS the port is usually a `/dev/cu...` path: copy the exact one from the port listing. For Windows PowerShell, enter the command on one line instead of using Bash's `\` line continuations. Do not use the name of a participant in the filename.

The files `P001_R001.csv` and `P001_R001.csv.json` are a pair. Keep them together. Use the study's collection procedure, record when contact changes/movement occur, and keep placement and acquisition settings consistent. A 90-second diagnostic capture is an engineering test duration, not a medical measurement protocol.

Inspect either old or new CSV with:

```bash
node tools/recordings/inspect_recording.cjs private-recordings/P001_R001.csv
```

An exit code of **2** means the file was readable but beat preview is blocked by compatibility checks. Code **1** means parsing/inspection failed; code **0** means the JSON input met engineering preview checks. CSV remains blocked until its missing acquisition metadata and compatibility have been resolved. A zero exit code is never a BP-accuracy result.

## Install and test the phone screen

After applying this update in the Mac repository:

```bash
cd /Users/rithika/Desktop/cddapp
npm install
npx pod-install ios
open ios/cddapp.xcworkspace
```

Use the existing Xcode workspace and signing setup, select the physical iPhone, and build the updated app. Keep your customized native project; a clean prebuild is unnecessary. The document picker is a new native dependency, so JavaScript reload alone is insufficient.

Open **Test ML model → Inspect a sensor recording → Choose CSV or JSON**. Choose a file from Files. For the supplied old CSV, expect 1,322 samples, 48.723 seconds and a “Recording needs review” result. No BP number should appear. “Load synthetic example” lets you test the JSON/beat-preview path without using a person's data.

The feature reads the selected file into screen memory and deletes only its temporary app-cache copy. It does not save the waveform or upload it. The original document remains with its provider. “Share diagnostics only” shares aggregate checks, not waveform samples or participant identifiers. Provider/OS cloud handling is separate from this code.

The new screens and native file selection still need a physical-iPhone check. I ran the code-level checks here; I did not operate your phone or sensor remotely.

## How this relates to calibration

Calibration means comparing a model estimate with a cuff reading from a matched measurement session and saving a correction. It needs a usable sensor recording **and** the reference cuff value. This CSV contains neither validated model inputs nor cuff references, so it cannot create calibration.

The initial design uses separate SBP and DBP offsets. Illustrative example: model 118/76, cuff 126/80 gives +8/+4. Several accepted matched pairs are combined; equal weights are the starting research proposal. The correction is then added once to a later recording's model estimate. Monthly/30-day refresh is a proposed reminder/expiry rule, not a demonstrated period of accuracy.

The cuff log added here saves drafts locally; it does not accept pairs automatically, activate correction, send reminders or update the health journal. Identity filtering is not authentication. This research database has no added encryption or account-access protection; OS backup behavior is not controlled by this feature. Before wider use, choose an access/backup/deletion policy and validate the actual pairing procedure.

## What remains before actual BP evaluation

- Establish the hardware, actual acquisition rate, sample order, overflow detection and units. Preserve original counts and metadata.
- Choose red or infrared using a documented train/validation procedure; the model's three channels are one selected PPG signal and two calculated derivatives, not three light colors.
- Validate signal-quality rejection, any required resampling, and signal scaling against the training pipeline. Avoid adopting a new filter only because a trace looks smoother.
- Collect appropriately matched cuff references under the team's approved protocol and evaluate on recordings/people not used to fit personal corrections. Compare with cuff-only and constant baselines.
- Evaluate the original and candidate research models with their exact preprocessing contracts. A new `.pth` does not replace the ONNX file in the phone automatically.
- Complete live sensor/Bluetooth integration and measure real acquisition reliability and energy use. Those cannot be established by this CSV or a desktop build.

The known original `.pth`, ONNX model and normalization files remain unchanged. This update fixes data handling around them; it does not claim that the original model is the best or that it predicts accurate BP on this sensor.

## Reproduce the software checks

Use a Node version with `node:sqlite` available (these checks ran on Node 24.19.0):

```bash
npm run test:recordings
python3 -m unittest discover -s tools/recordings/tests -p 'test_*.py'
npx tsc --noEmit
```

Checks cover malformed/missing data, wrong or unknown timing, all complete JSON preview windows, serial headers and range validation, persisted cuff drafts after reopening SQLite, participant separation, duplicate IDs, expiry, incompatible contexts, revoked profiles and tampered stored identities. They do not substitute for physical-device tests.

## Source notes

Source-file fingerprints and aggregate inspection are in `docs/evidence/recording-import-20261007/`. The original waveform and identifying filename are not included in the repository.

- SparkFun's [sensor-hub implementation](https://github.com/sparkfun/SparkFun_Bio_Sensor_Hub_Library/blob/master/src/SparkFun_Bio_Sensor_Hub_Library.cpp): `configSensor`, `readSensor`, `numSamplesOutFifo`. Reviewed October 7, 2026; the team's installed version remains unknown.
- Expo SDK54 [document picker](https://docs.expo.dev/versions/v54.0.0/sdk/document-picker/), [file system](https://docs.expo.dev/versions/v54.0.0/sdk/filesystem/), and [SQLite](https://docs.expo.dev/versions/v54.0.0/sdk/sqlite/) documentation informed the new app adapters.

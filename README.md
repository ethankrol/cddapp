# CDD blood-pressure research app

Updated October 8, 2026. **Start here when picking up this project in a new session.**

The new Blood Pressure page accepts the team's CSV and displays **experimental AnyPPG estimates**, separately for red and infrared light. These numbers have not been validated against matching cuff readings. They are not entered into the health journal.

## How teammates run the app

**Use the `rithika-ML` branch. The CSV prediction feature needs a native iOS app build; Expo Go cannot run its ONNX engine or custom native modules.** Xcode builds and installs that app. For a standalone demonstration, choose a Release build: the model and app code are packaged on the phone.

| What you want to do | How to run it |
|---|---|
| Install and demonstrate CSV predictions on an iPhone | Build the existing iOS workspace in Xcode using Release; follow the steps below |
| Edit app code and see changes while developing | Install a Debug development build, then run `npx expo start --dev-client` |
| Let a teammate test without a Mac or Xcode | Distribute a signed iOS build, for example through TestFlight; this distribution setup is still pending |
| Open the project in Expo Go | Unsupported for BP inference because the required native engine is not included in Expo Go |
| Run the CSV model in a web browser | Not implemented by the current native inference adapter |

### First-time setup on a Mac

You need Git, Node.js and npm (Expo SDK 54 requires Node 20.19.4 or newer compatible versions), the full Xcode application, and an iPhone. Open Xcode once to finish its component installation. Xcode must support the iOS version installed on the phone. Python, HiPerGator and a GPU are not needed to run this app.

For a **new clone**, run these commands in a folder where you want the project. If you already have a `cddapp` checkout, use the update instructions below instead.

```bash
git clone --branch rithika-ML https://github.com/ethankrol/cddapp.git
cd cddapp
npm ci
npx pod-install
npm run test:recordings
npm run test:anyppg
npx tsc --noEmit
open ios/cddapp.xcworkspace
```

`npm ci` installs the JavaScript dependencies from the saved lock file. `npx pod-install` installs the iOS native dependencies using CocoaPods; complete any installation prerequisite it reports before opening the workspace. The test commands check the code and bundled reference data on the Mac. They do not replace the iPhone check below.

Keep the customized `ios/` project. **Do not run a clean Expo prebuild or reset the project**: that can replace its manual native changes. Open `cddapp.xcworkspace`, rather than the repository folder or `cddapp.xcodeproj`.

### Install on an iPhone with Xcode

1. Connect the unlocked iPhone by USB and accept **Trust This Computer** if prompted. Enable **Settings → Privacy & Security → Developer Mode** when requested and complete the restart/confirmation.
2. In Xcode, select the **cddapp** project and the **cddapp** app target. Open **Signing & Capabilities**, enable automatic signing, and choose an Apple development team you are authorized to use. The repository currently contains Rithika's signing team; another developer may need their own team.
3. If Xcode reports that the bundle identifier is unavailable to your team, use an identifier you own for your local build. Keep the app target's bundle identifier and `expo.ios.bundleIdentifier` in `app.json` consistent. Do not commit another developer's personal signing changes unintentionally.
4. Select the **cddapp** scheme and your physical iPhone as the run destination.
5. Open **Product → Scheme → Edit Scheme → Run → Info**, select **Release**, then click the Run triangle. Let Xcode finish compiling and installing.
6. If iOS asks you to trust the developer, follow its prompt under **Settings → General → VPN & Device Management**, then reopen the app.

The first native build can take several minutes. Once installed, a Release build runs from the phone's app icon without Metro (the development server), a connected Mac or a GPU. You can disconnect USB. Signing/provisioning still governs how long the installed app remains usable.

### Try the CSV demo

1. Open **Blood Pressure → Check model with a synthetic signal**. This runs a made-up signal with a saved Python answer. The phone should agree within **0.01 mmHg**. Use **Share test report** to record the new model's iPhone result.
2. Save the team's original CSV to the iPhone's **Files** app. Expected columns are `time_stamp_millis,RawRed,RawIR`.
3. On **Blood Pressure**, choose **Finger**, **Wrist** or **Not sure**, then tap **Import CSV & calculate** and select the file. The placement selection records metadata; it does not change the model.
4. Read the separate **Red light** and **Infrared light** cards. Each shows its recording interval and a large **SBP / DBP mmHg** estimate. SBP is the top/systolic number; DBP is the bottom/diastolic number.
5. The supplied 48.723-second recording produces four cards: two windows for each optical channel. The final window overlaps the first to cover the recording's end. Use **Share test report** to save the result or **Clear results** to remove it from the screen.

These are experimental estimates, not validated cuff-equivalent readings. The demo does not automatically apply personal calibration or save predictions to the health journal.

### Update an existing checkout

First run `git status`. Commit or back up your own edits before switching branches or pulling. Then, from the repository folder:

```bash
git switch rithika-ML
git pull --ff-only origin rithika-ML
npm ci
npx pod-install
npm run test:recordings
npm run test:anyppg
npx tsc --noEmit
open ios/cddapp.xcworkspace
```

Rebuild and install the Release app using the Xcode steps above. **Updating GitHub or pulling files does not update an already installed Release app.** If `--ff-only` reports divergent history, resolve that Git situation before continuing; do not use a force reset to discard local work.

### Optional: develop with live code updates

After first-time setup and signing, select **Debug** under the Xcode scheme's Run settings. In a terminal in the repository, start:

```bash
npx expo start --dev-client
```

Run the Debug app from Xcode and connect it to that server. Keep the Mac and iPhone on a network that allows them to communicate and allow local-network access when iOS asks. A development build is this project's own app with its native dependencies; it is different from Expo Go. Native dependency changes need a rebuild. Use Release again for standalone demos and performance measurements.

### Common setup problems

- **“Can't determine id of Simulator app” from the Expo command:** use the existing Xcode workspace and select the physical iPhone. If command-line tools point to the wrong installation, first inspect `xcode-select -p`. For the usual Xcode install, select it with `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`.
- **Workspace opens but native dependencies are missing:** run `npm ci` and `npx pod-install` from the project root, then reopen the workspace.
- **Old screen still appears:** confirm the `rithika-ML` branch, rebuild Release and reinstall; restarting the old binary cannot add the new CSV feature.
- **QR code opens Expo Go:** launch the installed CDD development app instead. A Release build does not need a development-server QR code.
- **A tester has no Mac:** a developer must prepare a signed distribution build. There is no configured TestFlight invitation or EAS distribution profile in this checkout yet.

References: [Expo native-code support](https://docs.expo.dev/workflow/customizing/), [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/), [SDK 54 requirements](https://expo.dev/changelog/sdk-54), [Apple Developer Mode](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device/), and [TestFlight](https://developer.apple.com/testflight/).

## Which model is used?

| Flow | Saved model and scaling | Status |
|---|---|---|
| New CSV card on Blood Pressure page | `assets/models/anyppg/anyppg_encoder.onnx` + `ridge_head.json`; input scaling in `services/anyppg/core.js` | Host checks passed; new physical iPhone result still needed |
| Existing Test ML model screens | `assets/models/onnx_export/cbp_tnet.onnx` + its `normalization.json` | Original model previously tested by Rithika on the iPhone with synthetic inputs |
| Reproduce the new export | `tools/anyppg/source/anyppg_ckpt.pth`, `resnet1d.py`, `ridge_probe.npz`, `training_report.json`; `tools/anyppg/export.py` | Exact uploaded candidate; no retraining in this update |

**ONNX** is the portable file format used to run a trained model in the app. A `.pth` stores the training framework's weights. The phone uses the `.onnx`, not the `.pth`. AnyPPG's encoder alone does not predict BP: the saved `ridge_head.json` is also required.

The new AnyPPG encoder has **4,044,272 learned parameters**, compared with **5,219,394** in the original cBP-Tnet: about **22.5% fewer**. A parameter is one learned numerical setting. AnyPPG also uses a small separate saved BP predictor. Its ONNX encoder file is **16,436,446 bytes (16.44 MB)**; that is not the whole app's installed size or runtime memory use. The older model is still bundled for its existing test screens.

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

## Verified GitHub state

The `rithika-ML` branch was checked at commit [`a02faf0`](https://github.com/ethankrol/cddapp/commit/a02faf0e003abd564db7c92cf3bb3fd1abc37301) (`tested with sample data`). That commit contains the AnyPPG encoder, its matching saved BP predictor, preprocessing/normalization code and the Blood Pressure CSV screen. The downloaded model/fixture hashes matched the package manifest, and all six AnyPPG host checks passed. This confirms the published source package; it does not establish that every teammate's installed phone app is current.

The latest CSV path is AnyPPG. The original cBP-Tnet remains on the older diagnostic screens. A physical-iPhone report for the new AnyPPG flow should be saved separately from the earlier cBP-Tnet device results.

## Documentation

- [CSV demo, exact processing, results, calibration explanation and research](docs/AnyPPG_CSV_Demo.md)
- [Plain-language calibration and earlier phone tests](docs/BP_Project_Explained_Simply.md)
- [Engineering/calibration design](docs/CDD_Blood_Pressure_Engineering_Status_and_Calibration.md)
- [Actual sensor review and collection instructions](docs/Actual_Sensor_Data_Review_and_Next_Steps.md)
- [Repository organization](docs/Repository_Organization.md)
- New export provenance/synthetic fixture: `assets/models/anyppg/`.
- New verification evidence: `docs/evidence/anyppg-20261008/`.

Keep private CSVs outside Git, for example in `private-recordings/`. Import stays local and deletes only the picker's temporary copy. Displayed results remain in memory until cleared/replaced or the screen is destroyed. Sharing a report is a user action; reports contain predictions/timing metadata, not raw waveform arrays. This update adds no npm dependencies.

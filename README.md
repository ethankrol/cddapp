# CDD blood-pressure research app

Updated October 9, 2026. **Team setup instructions use `main`. Start here when picking up this project in a new session.**

The new Blood Pressure page accepts the team's CSV and displays **experimental AnyPPG estimates**, separately for red and infrared light. These numbers have not been validated against matching cuff readings. They are not entered into the health journal.

## Does importing a CSV calculate new predictions?

**Yes. Tapping “Import CSV & calculate” uses the signal values in the selected file to calculate SBP and DBP on the phone.** The reviewed code does not look up a saved answer for that filename or read a blood-pressure answer from the CSV.

The saved model is like a learned calculation recipe. Your CSV supplies its input. The recipe is already trained, but the output is calculated when you import the recording. Importing does not train or fit the model again.

There are two different buttons:

| Button | What actually happens | Are expected answers saved? |
|---|---|---|
| **Import CSV & calculate** | Reads your selected file, prepares its signals, runs the trained model and calculates the displayed estimates | No expected BP answers are needed for your recording |
| **Check model with a synthetic signal** | Runs a bundled, made-up recording through the same inference path, then checks its newly calculated output | Yes: saved Python outputs are used only to check agreement; they do not replace the model calculation |

“Calculated now” means **on-demand processing of an already recorded file**. It does not mean the app is currently collecting a continuous live signal from the wearable. A 49-second recording can be processed much faster than 49 seconds because all its samples are already available. Reimporting an unchanged file should produce the same or nearly identical numbers with the same model and settings.

### What runs the model?

The CSV feature uses **AnyPPG**, a convolutional neural network (CNN) that recognizes patterns in PPG, followed by a small saved BP predictor. This path does not use the older transformer model.

| Term | Plain-English meaning |
|---|---|
| **PPG** | The optical pulse signal recorded by the sensor |
| **AnyPPG encoder** | The trained pattern-finder that turns a signal into a list of useful numbers |
| **Ridge head** | The final saved calculation that turns those numbers into SBP and DBP estimates |
| **ONNX (`.onnx`)** | The model's portable file format; it contains the learned network, not a list of answers to every possible CSV |
| **ONNX Runtime** | Software inside the CDD app that executes that model on the phone |
| **Expo / React Native** | Tools used to build the app's screens and connect its components |
| **Xcode / Android build tools / EAS Build** | Tools that package the app and its native engine into something you can install |

There is no separate “ONNX app” to install. CDD contains the engine and model. This prediction path runs locally; Expo and Xcode do not host a prediction server.

## How teammates run the app

**Use `main` for team setup. BP inference needs an installed CDD native app containing ONNX Runtime; Expo Go does not include it.** For an iPhone, Xcode can build and install that app. Choose Release for a standalone demonstration: its model and app code are packaged on the phone. Android setup is described below but still needs a recorded build and device verification for this project.

| What you want to do | How to run it |
|---|---|
| Install and demonstrate CSV predictions on an iPhone | Build the existing iOS workspace in Xcode using Release; follow the steps below |
| Edit app code and see changes while developing | Install a Debug development build, then run `npx expo start --dev-client` |
| Windows + iPhone | First install a signed CDD iOS build made with EAS cloud builds or by a Mac teammate; see the Windows + iPhone section |
| Mac + Android | Install Android Studio and build a CDD development app with `npx expo run:android --device`; see the Mac + Android section |
| Open the project in Expo Go | Unsupported for BP inference because the required native engine is not included in Expo Go |
| Run the CSV model in a web browser | Not implemented by the current native inference adapter |

### First-time setup: Mac + iPhone

This project uses Expo SDK 57. Local iOS builds require Node.js 22.13 or newer and Xcode 26.4 or newer. You also need Git, npm, and an iPhone. Open Xcode once to finish its component installation. Xcode must support the iOS version installed on the phone. Python, HiPerGator and a GPU are not needed to run this app.

For a **new clone**, run these commands in a folder where you want the project. If you already have a `cddapp` checkout, use the update instructions below instead.

```bash
git clone --branch main https://github.com/ethankrol/cddapp.git
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

1. Open **Blood Pressure → Check model with a synthetic signal**. This calculates predictions for a made-up signal and compares them with saved Python reference outputs. The phone should agree within **0.01 mmHg**. Use **Share test report** to record the new model's iPhone result.
2. Save the team's original CSV to the iPhone's **Files** app. Expected columns are `time_stamp_millis,RawRed,RawIR`.
3. On **Blood Pressure**, choose **Finger**, **Wrist** or **Not sure**, then tap **Import CSV & calculate** and select the file. The placement selection records metadata; it does not change the model.
4. Read the separate **Red light** and **Infrared light** cards. Each shows its recording interval and a large **SBP / DBP mmHg** estimate. SBP is the top/systolic number; DBP is the bottom/diastolic number.
5. The supplied 48.723-second recording produces four cards: two windows for each optical channel. The final window overlaps the first to cover the recording's end. Use **Share test report** to save the result or **Clear results** to remove it from the screen.

These are experimental estimates, not validated cuff-equivalent readings. The demo does not automatically apply personal calibration or save predictions to the health journal.

### Update an existing Mac + iPhone checkout

First run `git status`. Commit or back up your own edits before switching branches or pulling. Then, from the repository folder:

```bash
git switch main
git pull --ff-only origin main
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

Run the Debug app from Xcode and connect it to that server. Keep the Mac and iPhone on a network that allows them to communicate and allow local-network access when iOS asks. A development build is this project's own app with its native dependencies; it is different from Expo Go. **`npx expo start` alone starts a development server. It cannot install the native engine onto a phone that does not yet have the CDD development app.** Native dependency changes need a rebuild. Use Release again for standalone demos and performance measurements.

### Windows + iPhone: use a signed cloud build

You **cannot build an iOS app locally on Windows**. For the native ONNX feature, use **EAS Build** (Expo cloud) or ask a Mac teammate to provide a correctly signed app. For standard iOS device distribution with EAS, the team needs suitable Apple Developer Program signing access (normally a paid membership). A project administrator should own the Expo project and Apple credentials.

First install Git and Node.js 22.13 or newer. For a new checkout, run in PowerShell:

```powershell
git clone --branch main https://github.com/ethankrol/cddapp.git
cd cddapp
npm ci
npm run test:recordings
npm run test:anyppg
npx tsc --noEmit
```

If the team has already supplied an appropriate signed app and configured EAS, use their installation instructions. Otherwise a maintainer starts the cloud configuration from PowerShell inside `cddapp`:

```powershell
npx eas-cli@latest login
npx eas-cli@latest build:configure --platform ios
```

**One-time team configuration:** A maintainer must review the generated `eas.json`, confirm that the existing customized iOS native project and ONNX dependency are included, and set up suitable profiles. An example profile configuration is below; **merge it with existing settings instead of replacing them**, and have the maintainer confirm it fits this repository:

```json
{
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "ios": { "simulator": false }
    },
    "preview": {
      "distribution": "internal",
      "developmentClient": false,
      "ios": { "simulator": false, "buildConfiguration": "Release" }
    }
  }
}
```

The team must register the testing iPhone for internal/ad hoc distribution and ensure the build's provisioning profile includes it:

```powershell
npx eas-cli@latest device:create
```

Open the registration link **on the iPhone** and follow the instructions. Then choose **one** of these build paths:

```powershell
# For coding with Metro / live JavaScript updates:
npx eas-cli@latest build --platform ios --profile development

# OR for a standalone demo without Metro:
npx eas-cli@latest build --platform ios --profile preview
```

When the signed build succeeds, open the provided installation link **on the registered iPhone** to install CDD. Enable **Settings → Privacy & Security → Developer Mode** if requested and complete the restart/confirmation. A **development** build then works with the Windows terminal command:

```powershell
npx expo start --dev-client
```

A **preview** build launches directly from the CDD icon—**no Expo server, USB cable, or Windows computer is needed after installation**. If the team's Expo/EAS project, native iOS build, Apple credentials, or device registration is not yet configured, the first build will require maintainer setup. Do not assume the example profiles are already in the repository or that a cloud build has been verified.

### Mac + Android: build and install CDD

This is the proposed Android setup path, **not a claim that this checkout has passed Android testing**. The iPhone reports do not establish Android compatibility.

1. Install Git, Node.js 22.13 or newer, and **Android Studio**. Follow [Expo's Android Studio setup guide](https://docs.expo.dev/workflow/android-studio-emulator/) for the SDK, platform tools and compatible Java/JDK setup. Xcode and CocoaPods are not needed for Android.
2. On the Android phone, enable **Developer options → USB debugging**. Connect it with a data-capable USB cable and authorize the Mac when prompted.
3. For a new checkout, run these commands in Mac Terminal. If you already have the project, update that checkout instead of cloning inside it.

```bash
git clone --branch main https://github.com/ethankrol/cddapp.git
cd cddapp
npm ci
npm run test:recordings
npm run test:anyppg
npx tsc --noEmit
adb devices
npx expo run:android --device
```

If `adb` is not found, finish the SDK/platform-tools setup and add its directory to your terminal's PATH. `adb devices` should list the phone as authorized before you build.

The build command compiles and installs the native app and starts Metro. If `android/` does not exist, Expo generates it. Review any generated project/configuration changes; preserve the customized `ios/` project. Confirm the ONNX dependency builds, then run **Blood Pressure → Check model with a synthetic signal** and import a CSV. Save an Android report before calling this platform verified. The older iOS memory-profiling screens are not evidence of Android support.

After the first successful installation, daily JavaScript/UI development uses:

```bash
npx expo start --dev-client
```

Open the installed **CDD** development app and connect it to Metro over a reachable network. Native dependency changes require another build. For a standalone demonstration, the team must prepare and install an Android Release/preview build; that setup has not been verified here.

### Common setup problems

- **“Can't determine id of Simulator app” from the Expo command:** use the existing Xcode workspace and select the physical iPhone. If command-line tools point to the wrong installation, first inspect `xcode-select -p`. For the usual Xcode install, select it with `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`.
- **Workspace opens but native dependencies are missing:** run `npm ci` and `npx pod-install` from the project root, then reopen the workspace.
- **Old screen still appears:** confirm you have the updated `main` checkout, rebuild Release and reinstall; restarting the old binary cannot add the new CSV feature.
- **QR code opens Expo Go:** launch the installed CDD development app instead. A Release build does not need a development-server QR code.
- **A tester has no Mac:** a developer must prepare a signed distribution build. There is no configured TestFlight invitation or EAS distribution profile in this checkout yet.

References: [Expo local Android/iOS builds](https://docs.expo.dev/guides/local-app-development/), [EAS internal distribution](https://docs.expo.dev/build/internal-distribution/), [Expo native-code support](https://docs.expo.dev/workflow/customizing/), [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/), [Apple Developer Mode](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device/), and [TestFlight](https://developer.apple.com/testflight/).

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

- Capture and save a report for the **new** model's synthetic check and actual CSV import on the physical phone. Earlier detailed phone reports used the old model; an app opening successfully is not a replacement for the new test report.
- Build and verify the Android CSV path. Android instructions describe how to attempt that verification, not a completed test.
- Confirm optical sensor/board variant, I²C pins, acquisition rate, sample loss and finger versus wrist placement. **Controller confirmed: ESP32-C3.** The original `.ino` was received and reviewed. A diagnostic replacement exists in `tools/recordings/firmware/CDD_RawCapture/` but has not been compiled/flashed/tested here.
- Collect stable recordings paired with reference cuff readings. Compare red and infrared before choosing a channel or trained fusion method.
- Integrate and validate personal calibration; test drift over days/weeks. A monthly reminder is a proposed policy, not a proven correction lifetime.
- Validate live BLE acquisition, signal quality, accuracy, energy and cold startup for the new model. AnyPPG's possible pretraining overlap with the MIMIC cohort remains unresolved.

## Source review and validation status

Team installation commands target **`main`**. They require the CSV feature and dependency fixes to be present there; publishing this README does not merge code or update an installed app.

The October 9 source review traced the CSV path at [commit `4a99738`](https://github.com/ethankrol/cddapp/commit/4a99738ce85d21565f385d2f120ebadb8b660444):

- `components/BpCsvCard.tsx` takes the selected recording and calls `inferCsv`.
- `services/anyppg/inference.native.ts` loads the bundled model and native ONNX Runtime.
- `services/anyppg/core.js` prepares the actual recording's windows, scales them and applies the saved BP predictor.
- `services/anyppg/ort.js` calls `session.run(...)` on the model for each channel window.
- `services/anyppg/synthetic.ts` calls that same inference path before comparing against saved expected values.

This confirms how the reviewed code computes predictions. It is a source review, not a fresh physical-device test or confirmation of the installed app's commit. The GitHub view available during this review still reported PR #4 as open and did not expose the AnyPPG core on `main`; confirm the merge is present before teammates follow the `main` setup commands.

The earlier project record documents matching model/fixture hashes and six passing AnyPPG host checks at [commit `a02faf0`](https://github.com/ethankrol/cddapp/commit/a02faf0e003abd564db7c92cf3bb3fd1abc37301). Those checks were not rerun during this documentation edit. The CSV path uses AnyPPG; the older Test ML screens use cBP-Tnet. Save physical-device reports for the new path separately for iOS and Android.

## Documentation

- [CSV demo, exact processing, results, calibration explanation and research](docs/AnyPPG_CSV_Demo.md)
- [Plain-language calibration and earlier phone tests](docs/BP_Project_Explained_Simply.md)
- [Engineering/calibration design](docs/CDD_Blood_Pressure_Engineering_Status_and_Calibration.md)
- [Actual sensor review and collection instructions](docs/Actual_Sensor_Data_Review_and_Next_Steps.md)
- [Repository organization](docs/Repository_Organization.md)
- New export provenance/synthetic fixture: `assets/models/anyppg/`.
- New verification evidence: `docs/evidence/anyppg-20261008/`.

Keep private CSVs outside Git, for example in `private-recordings/`. Import stays local and deletes only the picker's temporary copy. Displayed results remain in memory until cleared/replaced or the screen is destroyed. Sharing a report is a user action; reports contain predictions/timing metadata, not raw waveform arrays. This README edit adds no npm dependencies and changes no model or app code.

# CDD blood-pressure research app

Updated October 9, 2026. **Team setup instructions use the `main` branch.**

The new Blood Pressure page accepts the team's CSV and displays **experimental AnyPPG estimates**, separately for red and infrared light. These numbers have not been validated against matching cuff readings. They are not entered into the health journal.

## Start here: how the app and AI model work

**Everyone uses `main`.** The Blood Pressure page imports a CSV and displays *experimental* estimates for red and infrared PPG signals. These are **research outputs, not medically validated blood-pressure readings**; they are not saved to the health journal.

### The model is not hosted on a server

The current CSV feature uses **AnyPPG**, with a **ResNet1D-style convolutional neural network (CNN) encoder**, followed by a small saved **ridge-regression blood-pressure prediction head**. It is **not a transformer model**. The model runs **locally on the phone** for this feature; neither Expo nor Xcode hosts the predictions.

| Piece | Plain-English meaning | Role in this project |
|---|---|---|
| **AnyPPG CNN encoder** (`assets/models/anyppg/anyppg_encoder.onnx`) | The trained pattern-finder | Converts processed PPG into numerical features |
| **Ridge head** (`ridge_head.json`) | The final predictor | Converts the features into systolic (SBP) and diastolic (DBP) estimates |
| **ONNX** (`.onnx`) | A portable *file format* | Stores the trained CNN for running outside the training environment |
| **ONNX Runtime** (`onnxruntime-react-native`) | The *engine* that opens and executes the ONNX model | Runs the CNN on the phone; it is native software bundled into CDD |
| **Expo / React Native** | The app framework and development tools | Displays screens, imports CSVs, prepares data, and shows predictions |
| **Xcode / Android build tools / EAS Build** | Tools for creating installable apps | Package native code, including ONNX Runtime, into an iOS or Android app |

**Data flow:** CSV (red/infrared PPG) → preprocessing → AnyPPG CNN via ONNX Runtime → ridge prediction head → SBP/DBP cards in CDD.

**Why `npx expo start` alone is not enough:** that command starts the JavaScript development server, but **does not install native modules** onto a phone. Stock **Expo Go does not contain this app's ONNX Runtime module**. The first step is to build and install a **custom CDD app** with ONNX Runtime included. Afterward a **development build** can connect to `npx expo start --dev-client` for normal JavaScript/UI changes. A **Release or standalone preview build** works by opening its icon and does *not* use that command.

## Run CDD on your device

| Teammate | First install (includes native ONNX Runtime) | Afterward |
|---|---|---|
| **Mac + iPhone** | Use Xcode to install a Debug development build or Release build | Debug: `npx expo start --dev-client`; Release: open CDD directly |
| **Windows + iPhone** | Use an **EAS cloud iOS build** signed for their device, or have a Mac teammate install a signed build | Development build: `npx expo start --dev-client`; standalone build: open CDD |
| **Windows + Android** | Use Android Studio + `npx expo run:android --device`, **after verifying Android native configuration**; alternatively use EAS cloud Android build | Development build: `npx expo start --dev-client`; standalone build: open CDD |

**Do not scan the code in Expo Go to test BP inference.** Scan/connect with the *installed CDD development app*. If your phone only has Expo Go, the first-time native installation is still required. An iPhone cannot be compiled locally by Xcode on Windows. Python, HiPerGator, and a GPU are not needed for phone inference.

### A. Everyone: get the code (main branch)

Install Git and a compatible Node.js/npm version first. This checkout has been documented with Expo SDK 57 and Node.js **22.13+**. From Terminal (Mac) or PowerShell (Windows):

```bash
git clone --branch main https://github.com/ethankrol/cddapp.git
cd cddapp
npm ci
npm run test:recordings
npm run test:anyppg
npx tsc --noEmit
```

If already cloned, save your own work before pulling:

```bash
git status
git switch main
git pull --ff-only origin main
npm ci
```

If Git refuses to switch/pull due to local changes or divergent history, **do not discard teammates' changes**. Commit/stash your work and resolve the conflict deliberately. `npm ci` installs the pinned JavaScript dependencies, but it **does not install a phone app**.

### B. Mac + iPhone: install using Xcode

Requires Xcode (the supplied setup notes specify Xcode **26.4+**), CocoaPods, and an iPhone supported by the installed Xcode. Finish Xcode's initial setup. From the `cddapp` folder:

```bash
npx pod-install
open ios/cddapp.xcworkspace
```

1. Connect and unlock the iPhone; approve **Trust This Computer**, and enable **Developer Mode** if prompted.
2. In Xcode open the **cddapp** target → **Signing & Capabilities**. Select an authorized Apple development team. If necessary, use a bundle identifier your team controls and keep the project and `app.json` identifiers consistent. Avoid committing personal signing changes.
3. Select the **cddapp** scheme and the physical iPhone.
4. For **daily coding**, set **Product → Scheme → Edit Scheme → Run → Info → Build Configuration = Debug**, then press **Run**. This installs the CDD **development app**, with ONNX Runtime.
5. In a second Terminal at the project root run:

   ```bash
   npx expo start --dev-client
   ```

   Open the installed development app and connect to Metro. Phone and computer must be able to reach one another (usually the same Wi-Fi).
6. For an **offline, self-contained demonstration**, change that scheme's Run configuration to **Release**, rebuild/install through Xcode, and launch CDD from the app icon. You do **not** run `expo start` for Release.

**Preserve the customized `ios/` project.** Do not casually delete it, run `expo prebuild --clean`, or reset native changes. Open `.xcworkspace`, not `.xcodeproj`.

### C. Windows + iPhone: use an Expo cloud build

You **cannot build an iOS app locally on Windows**. For the native ONNX feature, use **EAS Build** (Expo cloud) or ask a Mac teammate to provide a correctly signed app. For standard iOS device distribution with EAS, the team needs suitable Apple Developer Program signing access (normally a paid membership). A project administrator should own the Expo project and Apple credentials.

From PowerShell inside `cddapp`:

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

When the signed build succeeds, open the provided installation link **on the registered iPhone** to install CDD. A **development** build then works with the Windows terminal command:

```powershell
npx expo start --dev-client
```

A **preview** build launches directly from the CDD icon—**no Expo server, USB cable, or Windows computer is needed after installation**. If the team's Expo/EAS project, native iOS build, Apple credentials, or device registration is not yet configured, the first build will require maintainer setup. Do not assume the example profiles are already in the repository or that a cloud build has been verified.

### D. Windows + Android: build and install CDD

Install **Android Studio** with the Android SDK/platform tools, set up the Android SDK environment for React Native/Expo, and enable **Developer options → USB debugging** on the Android phone. Connect via a data-capable USB cable, then authorize the computer on the phone. From PowerShell in `cddapp`:

```powershell
adb devices
npx expo run:android --device
```

`adb devices` should show the authorized device. `run:android` builds an Android **development app** with native modules, then installs it. **First verify that the merged `main` branch contains (or can safely generate) a compatible Android native project and that `onnxruntime-react-native` builds successfully for Android.** This README's recorded physical-device test was on iOS; it does **not** establish that the AnyPPG feature has passed Android testing. If the command would generate or change the `android/` project, review/commit those changes as a team instead of blindly regenerating native files.

After a successful first install, daily development is:

```powershell
npx expo start --dev-client
```

Open **CDD**, not Expo Go, on the Android phone; ensure the computer and phone can communicate over the network. For a standalone Android demo, create an appropriately signed **Release APK** or EAS preview build and install that instead; a development build depends on Metro for JavaScript.

### E. Verify the actual CSV feature on a phone

1. Open **Blood Pressure → Check model with a synthetic signal**. Compare with the saved Python reference answer; the original test expects agreement within **0.01 mmHg**. Use **Share test report** to record the *new* model's result.
2. Save the team's original CSV on the phone. The expected columns are `time_stamp_millis,RawRed,RawIR`.
3. On **Blood Pressure**, select **Finger**, **Wrist** or **Not sure**, then tap **Import CSV & calculate** and pick the file. Placement is recorded as metadata; it does not change the model.
4. Read the separate **Red light** and **Infrared light** SBP/DBP cards (mmHg), each labeled with its recording interval.
5. The supplied 48.723-second recording is expected to produce **four cards** (two windows per channel, with a final overlapping window). **Share test report** to preserve the test results.

These estimates are not calibrated or validated against paired cuff readings. They are not entered into the health journal.

### Common setup problems

- **`npx expo start` opens Expo Go:** Expo Go lacks the native ONNX engine. Install a custom **CDD development build**, then run `npx expo start --dev-client` and open CDD.
- **`expo start` runs but ONNX fails:** Check which app opened on the phone and whether it was rebuilt after native-dependency changes. Rebuild the native app and check model bundling/runtime logs.
- **Release/preview app does not connect to Metro:** This is expected. Open CDD normally; preview/Release bundles its JavaScript and model assets.
- **Windows friend has an iPhone but no CDD app:** `expo start` alone cannot install native modules. First install a signed EAS iOS build or one prepared on a Mac.
- **Android build fails:** Check Android Studio/SDK, `adb devices`, JDK setup, Android native project and ONNX dependency compatibility; successful iOS testing does not guarantee Android works.
- **iOS workspace fails to load dependencies:** Run `npm ci` and `npx pod-install` on the Mac and reopen `ios/cddapp.xcworkspace`.
- **“Can't determine id of Simulator app”:** Select a physical iPhone in Xcode. Inspect `xcode-select -p`; for a conventional Xcode installation, `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer` may correct the command-line selection.
- **Older BP screen appears:** Verify you have pulled `main`, then rebuild and reinstall if the installed app is a Release/preview binary. Git pull does not replace an installed binary.
- **Git merge conflicts:** Do not use “accept both” blindly, especially in `package.json` and `package-lock.json`. Resolve dependencies and regenerate the lockfile consistently with npm.

Official guides: [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/), [Expo running on devices](https://docs.expo.dev/get-started/start-developing/), [EAS internal distribution](https://docs.expo.dev/build/internal-distribution/), [Expo Android local development](https://docs.expo.dev/get-started/set-up-your-environment/), and [Apple Developer Mode](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device/).

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

## Repository and validation status

**Use `main` for all team work.** The previous README documented a historical AnyPPG implementation snapshot from a feature branch. That older verification should **not** be interpreted as a new verification of the merged `main` build. Check the latest `main` commit, run the repository tests, and record new physical-device results separately for iOS and Android.

The Blood Pressure CSV route uses **AnyPPG**; older diagnostic/Test ML screens may still use **cBP-Tnet**. Physical-iPhone results previously reported for cBP-Tnet do not validate the AnyPPG path, and successful iOS tests do not establish Android parity.

## Documentation

- [CSV demo, exact processing, results, calibration explanation and research](docs/AnyPPG_CSV_Demo.md)
- [Plain-language calibration and earlier phone tests](docs/BP_Project_Explained_Simply.md)
- [Engineering/calibration design](docs/CDD_Blood_Pressure_Engineering_Status_and_Calibration.md)
- [Actual sensor review and collection instructions](docs/Actual_Sensor_Data_Review_and_Next_Steps.md)
- [Repository organization](docs/Repository_Organization.md)
- New export provenance/synthetic fixture: `assets/models/anyppg/`.
- New verification evidence: `docs/evidence/anyppg-20261008/`.

Keep private CSVs outside Git, for example in `private-recordings/`. Import stays local and deletes only the picker's temporary copy. Displayed results remain in memory until cleared/replaced or the screen is destroyed. Sharing a report is a user action; reports contain predictions/timing metadata, not raw waveform arrays. This update adds no npm dependencies.

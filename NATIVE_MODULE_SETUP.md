# Blood Pressure Native Module Setup Guide

## Overview

This project now has a complete Expo managed infrastructure for integrating a native blood pressure prediction model. The setup includes:

- **JavaScript Bridge** (`app/services/bloodPressureModel.ts`) — Type-safe interface for the native module
- **Native Modules** (`modules/BloodPressureModule/`) — iOS (Swift) and Android (Kotlin) implementations
- **Expo Config Plugin** (`app.plugin.js`) — Handles bundling of native code
- **Development Build Support** — Uses `expo-dev-client` for running native code locally

## What's been set up

### ✅ Completed
1. JS type definitions and bridge interface for blood pressure predictions
2. Native module stubs for iOS (Swift) and Android (Kotlin)
3. Expo configuration for dev client support
4. Model asset storage structure (`assets/models/`)
5. Example usage component (`app/examples/bloodPressureExample.tsx`)
6. Documentation

### ⏳ Next: Add Your Model

You need to provide the actual ML models before the module will work.

## Step-by-Step Setup

### 1. Install dependencies
```bash
npm install
# or
yarn install
```

### 2. Prepare your blood pressure prediction models

#### For iOS (Core ML)
- Convert your model to Core ML format (`.mlmodel`)
- Compile it: `xcrun coremlcompiler compile YourModel.mlmodel YourModel.mlmodelc`
- Copy to `modules/BloodPressureModule/ios/YourModel.mlmodelc/`

#### For Android (TensorFlow Lite)
- Convert your model to TensorFlow Lite format (`.tflite`)
- Copy to `modules/BloodPressureModule/android/bloodpressure_model.tflite`

See `assets/models/README.md` for detailed specifications.

### 3. Implement native model loading

#### iOS (`modules/BloodPressureModule/ios/BloodPressureModule.swift`)

Replace the TODO in `loadModel()`:
```swift
import CoreML

private var model: YourModelName?

@objc
func loadModel(resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
  do {
    let modelConfig = MLModelConfiguration()
    self.model = try YourModelName(configuration: modelConfig)
    self.modelLoaded = true
    resolve(true)
  } catch {
    reject("MODEL_LOAD_ERROR", error.localizedDescription, error)
  }
}
```

Replace the TODO in `predictReading()`:
```swift
let input = YourModelNameInput(
  systolic: NSNumber(value: systolic),
  diastolic: NSNumber(value: diastolic),
  heartRate: NSNumber(value: heartRate),
  age: NSNumber(value: age),
  weight: NSNumber(value: weight),
  height: NSNumber(value: height)
)
let output = try self.model?.prediction(input: input)
```

#### Android (`modules/BloodPressureModule/android/BloodPressureModule.kt`)

Add to `build.gradle`:
```gradle
dependencies {
  implementation 'org.tensorflow:tensorflow-lite:2.13.0'
  implementation 'org.tensorflow:tensorflow-lite-support:0.4.4'
}
```

Replace the TODO in `loadModel()`:
```kotlin
import org.tensorflow.lite.Interpreter
import java.nio.MappedByteBuffer
import java.nio.channels.FileChannel
import java.io.FileInputStream

private lateinit var interpreter: Interpreter

@ReactMethod
fun loadModel(promise: Promise) {
  try {
    val modelBuffer = loadModelFile(reactApplicationContext, "bloodpressure_model.tflite")
    interpreter = Interpreter(modelBuffer)
    modelLoaded = true
    promise.resolve(true)
  } catch (e: Exception) {
    promise.reject("MODEL_LOAD_ERROR", e.message, e)
  }
}

private fun loadModelFile(context: Context, modelName: String): MappedByteBuffer {
  val assetFileDescriptor = context.assets.openFd(modelName)
  val fileInputStream = FileInputStream(assetFileDescriptor.fileDescriptor)
  val fileChannel = fileInputStream.channel
  val startOffset = assetFileDescriptor.startOffset
  val declaredLength = assetFileDescriptor.declaredLength
  return fileChannel.map(FileChannel.MapMode.READ_ONLY, startOffset, declaredLength)
}
```

Replace the TODO in `predictReading()`:
```kotlin
val input = arrayOf(
  floatArrayOf(
    systolic.toFloat(),
    diastolic.toFloat(),
    heartRate.toFloat(),
    age.toFloat(),
    weight.toFloat(),
    height.toFloat()
  )
)
val output = Array(1) { FloatArray(4) } // 4 output classes
interpreter.run(input, output)
```

### 4. Generate native projects

```bash
# This creates ios/ and android/ folders
npx expo prebuild --clean
```

**iOS only:**
```bash
cd ios
pod install
cd ..
```

### 5. Build and test the dev client

```bash
# iOS
npx expo run:ios

# Android  
npx expo run:android
```

### 6. Test with the example component

Add the example to your app routing and test:
```typescript
import BloodPressureExample from '@/app/examples/bloodPressureExample';
```

## Usage in Your App

### Basic initialization and prediction

```typescript
import { bloodPressureModel, BloodPressureReading } from '@/app/services/bloodPressureModel';

// Initialize once when app starts
useEffect(() => {
  (async () => {
    await bloodPressureModel.loadModel();
    await bloodPressureModel.warmUpModel();
  })();
}, []);

// Make predictions
const reading: BloodPressureReading = {
  systolic: ble_reading.systolic,
  diastolic: ble_reading.diastolic,
  heartRate: ble_reading.hr,
  age: 45,
  weight: 75,
  height: 180,
  timestamp: Date.now()
};

const prediction = await bloodPressureModel.predictReading(reading);
console.log(prediction.riskLevel); // "normal" | "elevated" | "hypertension_stage1" | "hypertension_stage2"
```

### Integration with BLE

Once BLE data is available:

```typescript
// Create an adapter in app/services/bleToBloodPressureAdapter.ts
import { bloodPressureModel, BloodPressureReading } from './bloodPressureModel';

export function adaptBLEDataToReading(bleData: BLEReading, userProfile: UserProfile): BloodPressureReading {
  return {
    systolic: bleData.systolic,
    diastolic: bleData.diastolic,
    heartRate: bleData.heartRate,
    age: userProfile.age,
    weight: userProfile.weight,
    height: userProfile.height,
    timestamp: Date.now()
  };
}
```

## File Structure

```
cddapp/
├── app/
│   ├── services/
│   │   └── bloodPressureModel.ts          # JS bridge (complete)
│   └── examples/
│       └── bloodPressureExample.tsx       # Example usage component
├── modules/
│   └── BloodPressureModule/
│       ├── README.md                      # Module documentation
│       ├── ios/
│       │   ├── BloodPressureModule.h      # iOS header (complete)
│       │   ├── BloodPressureModule.swift  # iOS implementation (needs model)
│       │   └── YourModel.mlmodelc/        # → Add your Core ML model here
│       └── android/
│           ├── BloodPressureModule.kt     # Android implementation (needs model)
│           ├── BloodPressurePackage.kt    # Android package (complete)
│           └── bloodpressure_model.tflite # → Add your TF Lite model here
├── assets/
│   └── models/
│       └── README.md                      # Model specifications
├── app.json                               # Updated with plugin config
├── app.plugin.js                          # Config plugin (complete)
├── package.json                           # Updated with expo-dev-client
└── tsconfig.json
```

## Troubleshooting

### "Native module not found" error
1. Run `npx expo prebuild --clean` again
2. Check that `app.plugin.js` exists
3. Ensure `expo-dev-client` is installed
4. Rebuild with `npx expo run:ios` or `npx expo run:android`

### Model fails to load
- Verify the model file exists in the correct location
- Check that your native code is correctly loading the model file
- Ensure the model format matches (`.mlmodelc` for iOS, `.tflite` for Android)

### Build failures
- **iOS**: Run `cd ios && pod install && cd ..`
- **Android**: Ensure TensorFlow Lite dependency is in `android/app/build.gradle`
- Clear caches: `npx expo prebuild --clean && npm install`

### Predictions return stub values
- The native model inference code has TODO comments
- Replace the TODOs with actual model inference logic
- See Step 3 above for implementation examples

## Next Steps

1. ✅ Architecture is set up
2. **→ Obtain or train your blood pressure prediction model**
3. **→ Implement model inference in native modules (iOS/Android)**
4. **→ Build and test with dev client**
5. Add BLE integration when sensor is ready
6. Add tests for predictions
7. Prepare for production build

## References

- [Core ML Documentation](https://developer.apple.com/machine-learning/core-ml/)
- [TensorFlow Lite Android Guide](https://www.tensorflow.org/lite/android)
- [React Native Native Module Documentation](https://reactnative.dev/docs/native-modules-intro)
- [Expo Development Client](https://docs.expo.dev/develop/development-builds/introduction/)

# Blood Pressure Prediction Module

This is the native module infrastructure for blood pressure reading prediction using an AI model.

## Architecture

### Structure
- **`app/services/bloodPressureModel.ts`** — JavaScript bridge and type definitions for accessing the native module
- **`modules/BloodPressureModule/`** — Native module implementation
  - `ios/` — Swift implementation for iOS using Core ML
  - `android/` — Kotlin implementation for Android using TensorFlow Lite
- **`assets/models/`** — Model artifact storage
- **`app.plugin.js`** — Expo config plugin for bundling native code

### Public API

```typescript
import { bloodPressureModel, BloodPressureReading, BloodPressurePrediction } from '@/app/services/bloodPressureModel';

// Initialize
await bloodPressureModel.loadModel();
await bloodPressureModel.warmUpModel();

// Make predictions
const reading: BloodPressureReading = {
  systolic: 140,
  diastolic: 90,
  heartRate: 72,
  age: 45,
  weight: 75,
  height: 180,
  timestamp: Date.now()
};

const prediction: BloodPressurePrediction = await bloodPressureModel.predictReading(reading);
console.log(prediction.riskLevel); // "hypertension_stage1"
```

## Setup Steps

### 1. Prepare the native project
```bash
# Generate native project from Expo config
npx expo prebuild --clean
```

### 2. Add your model files

**iOS:**
- Place your Core ML model (`.mlmodel` or `.mlmodelc`) in `modules/BloodPressureModule/ios/`
- Update `iOS/BloodPressureModule.swift` to load and use the model

**Android:**
- Place your TensorFlow Lite model (`.tflite`) in `modules/BloodPressureModule/android/`
- Update `BloodPressureModule.kt` to load and use the model with TensorFlow Lite Interpreter

### 3. Build the dev client
```bash
# iOS
npx expo run:ios

# Android
npx expo run:android
```

## Implementation Checklist

- [ ] Obtain or train blood pressure prediction model
- [ ] Convert model to iOS Core ML format (`.mlmodel`)
- [ ] Convert model to Android TensorFlow Lite format (`.tflite`)
- [ ] Update `BloodPressureModule.swift` with actual Core ML inference code
- [ ] Update `BloodPressureModule.kt` with actual TensorFlow Lite inference code
- [ ] Add model files to respective directories
- [ ] Test predictions with sample data on both platforms
- [ ] Document model input/output shapes and feature requirements
- [ ] Add BLE reading adapter once BLE integration is complete

## BLE Integration

Once BLE data is available, create an adapter in `app/services/`:

```typescript
// app/services/bleToBloodPressureAdapter.ts
import { BloodPressureReading } from './bloodPressureModel';

export function adaptBLEReadingToPrediction(bleData: BLEPayload): BloodPressureReading {
  return {
    systolic: bleData.systolic,
    diastolic: bleData.diastolic,
    heartRate: bleData.heartRate,
    age: userProfile.age, // from context/storage
    weight: userProfile.weight,
    height: userProfile.height,
    timestamp: Date.now()
  };
}
```

## Model Input/Output

### Input Features (BloodPressureReading)
- `systolic` (mmHg): 40-300
- `diastolic` (mmHg): 20-200
- `heartRate` (bpm): 20-250
- `age` (years): 1-150
- `weight` (kg): 2-500
- `height` (cm): 50-250
- `timestamp` (ms): Unix timestamp

### Output (BloodPressurePrediction)
- `riskLevel`: "normal" | "elevated" | "hypertension_stage1" | "hypertension_stage2"
- `systolicPrediction`: number
- `diastolicPrediction`: number
- `confidence`: 0-1
- `modelVersion`: string
- `timeMs`: number (milliseconds to run inference)

## Testing

Add tests in `__tests__/`:

```typescript
import { bloodPressureModel } from '@/app/services/bloodPressureModel';

describe('Blood Pressure Model', () => {
  beforeAll(async () => {
    await bloodPressureModel.loadModel();
  });

  test('should predict normal BP', async () => {
    const result = await bloodPressureModel.predictReading({
      systolic: 110,
      diastolic: 70,
      heartRate: 60,
      age: 30,
      weight: 70,
      height: 175,
      timestamp: Date.now()
    });
    expect(result.riskLevel).toBe('normal');
  });
});
```

## Troubleshooting

### Native Module Not Found
- Run `npx expo prebuild --clean` to regenerate native files
- Ensure the config plugin is registered in `app.json`
- Confirm `expo run:ios` or `expo run:android` succeeds

### Prediction Returns Stubs
- Model files are not yet loaded in native code
- TODO markers in `BloodPressureModule.swift` and `BloodPressureModule.kt` need implementation

### Build Errors
- iOS: Ensure Core ML model is added to Xcode build phases
- Android: Verify TensorFlow Lite dependency is in `build.gradle`

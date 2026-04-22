# Model Storage

## Directory Purpose
This directory stores the machine learning model artifacts used by the BloodPressureModule.

## Expected Structure

```
assets/models/
├── bloodpressure_model.tflite        # Android TensorFlow Lite model
├── BloodPressureModel.mlmodel/       # iOS Core ML model (compiled)
└── model_metadata.json               # Model version and schema info
```

## Model Specifications

Before adding models, ensure they have:

### Input Features (in order)
1. **systolic** (float32): Blood pressure systolic reading in mmHg
2. **diastolic** (float32): Blood pressure diastolic reading in mmHg
3. **heartRate** (float32): Heart rate in beats per minute
4. **age** (float32): Age in years
5. **weight** (float32): Weight in kilograms
6. **height** (float32): Height in centimeters

### Output
Binary classification or regression output for risk level:
- normal: systolic < 120 && diastolic < 80
- elevated: systolic 120-129 && diastolic < 80
- hypertension_stage1: systolic 130-139 || diastolic 80-89
- hypertension_stage2: systolic ≥ 140 || diastolic ≥ 90

## Adding Models

### iOS (Core ML)
1. Train or convert your model to Core ML format (.mlmodel)
2. Compile it: `xcrun coremlcompiler compile model.mlmodel model.mlmodelc`
3. Copy `model.mlmodelc` to this directory
4. Update `modules/BloodPressureModule/ios/BloodPressureModule.swift` to load it

### Android (TensorFlow Lite)
1. Convert your model to TensorFlow Lite format (.tflite)
2. Copy to `assets/models/bloodpressure_model.tflite`
3. Ensure TensorFlow Lite dependency in Android build.gradle
4. Update `modules/BloodPressureModule/android/BloodPressureModule.kt` to use it

## Model Metadata

Create `model_metadata.json`:
```json
{
  "version": "1.0.0",
  "name": "BloodPressurePredictor",
  "description": "Predicts blood pressure risk level from clinical features",
  "inputShape": [1, 6],
  "outputShape": [1, 4],
  "inputFeatures": ["systolic", "diastolic", "heartRate", "age", "weight", "height"],
  "outputClasses": ["normal", "elevated", "hypertension_stage1", "hypertension_stage2"],
  "trainedDate": "2024-01-01",
  "accuracy": 0.92,
  "notes": "Model trained on NHANES dataset"
}
```

## Integration Notes

- Models are automatically bundled into the app during `npx expo prebuild`
- iOS: Models are included in the app bundle as resources
- Android: Models should be placed in `android/app/src/main/assets/`
- At runtime, native modules load models using platform-specific APIs

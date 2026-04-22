import { NativeModules, Platform } from 'react-native';

const LINKING_ERROR =
  `The native BloodPressureModule module could not be found. Ensure that your environment is set up correctly. ` +
  `Try running \`npx expo prebuild --clean\` to regenerate native files.`;

const BloodPressureModule = NativeModules.BloodPressureModule
  ? NativeModules.BloodPressureModule
  : new Proxy(
      {},
      {
        get() {
          throw new Error(LINKING_ERROR);
        },
      }
    );

/**
 * Blood pressure sensor reading input
 */
export interface BloodPressureReading {
  systolic: number;
  diastolic: number;
  heartRate: number;
  age: number;
  weight: number; // in kg
  height: number; // in cm
  timestamp: number; // milliseconds since epoch
}

/**
 * Blood pressure prediction output
 */
export interface BloodPressurePrediction {
  riskLevel: 'normal' | 'elevated' | 'hypertension_stage1' | 'hypertension_stage2';
  systolicPrediction: number;
  diastolicPrediction: number;
  confidence: number; // 0-1
  modelVersion: string;
  timeMs: number;
}

/**
 * Blood pressure model metadata
 */
export interface ModelInfo {
  version: string;
  name: string;
  platform: string;
  inputFeatures: string[];
  supportedRiskLevels: string[];
  ready: boolean;
}

/**
 * Service to interact with the native blood pressure prediction module
 */
class BloodPressureModelService {
  private isModelLoaded = false;

  /**
   * Load the blood pressure prediction model
   * Must be called before making predictions
   */
  async loadModel(): Promise<boolean> {
    try {
      const result = await BloodPressureModule.loadModel();
      this.isModelLoaded = result;
      return result;
    } catch (error) {
      console.error('Failed to load blood pressure model:', error);
      throw error;
    }
  }

  /**
   * Check if model is ready for predictions
   */
  async isReady(): Promise<boolean> {
    try {
      return await BloodPressureModule.isModelReady();
    } catch (error) {
      console.error('Failed to check model readiness:', error);
      return false;
    }
  }

  /**
   * Get model metadata and information
   */
  async getModelInfo(): Promise<ModelInfo> {
    try {
      return await BloodPressureModule.getModelInfo();
    } catch (error) {
      console.error('Failed to get model info:', error);
      throw error;
    }
  }

  /**
   * Predict blood pressure reading from sensor data
   * @param reading - Blood pressure sensor reading with all required fields
   * @returns Prediction with risk level and confidence
   */
  async predictReading(reading: BloodPressureReading): Promise<BloodPressurePrediction> {
    if (!this.isModelLoaded) {
      throw new Error('Model not loaded. Call loadModel() first.');
    }

    try {
      // Validate input
      this.validateReading(reading);

      const result = await BloodPressureModule.predictReading({
        systolic: reading.systolic,
        diastolic: reading.diastolic,
        heartRate: reading.heartRate,
        age: reading.age,
        weight: reading.weight,
        height: reading.height,
        timestamp: reading.timestamp,
      });

      return result as BloodPressurePrediction;
    } catch (error) {
      console.error('Prediction error:', error);
      throw error;
    }
  }

  /**
   * Predict from raw feature values
   * Use this when you have preprocessed sensor data
   */
  async predictFeatures(features: Record<string, number>): Promise<BloodPressurePrediction> {
    if (!this.isModelLoaded) {
      throw new Error('Model not loaded. Call loadModel() first.');
    }

    try {
      return await BloodPressureModule.predictFeatures(features);
    } catch (error) {
      console.error('Feature prediction error:', error);
      throw error;
    }
  }

  /**
   * Warm up the model by running a dummy prediction
   * Improves latency on first real prediction
   */
  async warmUpModel(): Promise<void> {
    try {
      await BloodPressureModule.warmUpModel();
    } catch (error) {
      console.error('Failed to warm up model:', error);
      // Don't throw - warmup is optional
    }
  }

  /**
   * Validate blood pressure reading input
   */
  private validateReading(reading: BloodPressureReading): void {
    if (!reading) {
      throw new Error('Reading cannot be null or undefined');
    }

    if (reading.systolic < 40 || reading.systolic > 300) {
      throw new Error('Systolic reading out of valid range (40-300 mmHg)');
    }

    if (reading.diastolic < 20 || reading.diastolic > 200) {
      throw new Error('Diastolic reading out of valid range (20-200 mmHg)');
    }

    if (reading.heartRate < 20 || reading.heartRate > 250) {
      throw new Error('Heart rate out of valid range (20-250 bpm)');
    }

    if (reading.age < 1 || reading.age > 150) {
      throw new Error('Age out of valid range (1-150 years)');
    }

    if (reading.weight < 2 || reading.weight > 500) {
      throw new Error('Weight out of valid range (2-500 kg)');
    }

    if (reading.height < 50 || reading.height > 250) {
      throw new Error('Height out of valid range (50-250 cm)');
    }
  }
}

// Export singleton instance
export const bloodPressureModel = new BloodPressureModelService();

export default bloodPressureModel;

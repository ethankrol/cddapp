/**
 * Shared types for blood pressure and BLE integrations
 */

/**
 * User profile information (persistent)
 */
export interface UserProfile {
  id: string;
  age: number; // years
  weight: number; // kg
  height: number; // cm
  biologicalSex: 'male' | 'female' | 'other';
  dateOfBirth: string; // ISO 8601
  createdAt: number; // timestamp
  updatedAt: number; // timestamp
}

/**
 * BLE device information
 */
export interface BLEDevice {
  id: string;
  name: string;
  uuid: string;
  rssi: number;
  txPower?: number;
  manufacturerData?: ArrayBuffer;
}

/**
 * Raw BLE blood pressure reading from device
 */
export interface BLERawReading {
  systolic: number; // mmHg
  diastolic: number; // mmHg
  heartRate: number; // bpm
  measurementStatus: number; // device-specific status code
  timestamp: number; // milliseconds since epoch
  pulseRate?: number; // optional, some devices provide this
}

/**
 * Processed reading ready for prediction
 */
export interface ProcessedReading extends BLERawReading {
  userId: string;
  deviceId: string;
  source: 'ble' | 'manual' | 'external';
  qualityScore: number; // 0-1, device confidence
}

/**
 * Blood pressure session (collection of readings)
 */
export interface BloodPressureSession {
  id: string;
  userId: string;
  startTime: number; // timestamp
  endTime: number; // timestamp
  readings: ProcessedReading[];
  deviceId: string;
  notes?: string;
  syncedAt?: number; // when synced to server
}

/**
 * Historical reading with predictions
 */
export interface ReadingWithPrediction {
  reading: ProcessedReading;
  prediction: {
    riskLevel: 'normal' | 'elevated' | 'hypertension_stage1' | 'hypertension_stage2';
    confidence: number;
    timestamp: number;
  };
}

/**
 * User statistics (calculated)
 */
export interface BloodPressureStats {
  period: 'day' | 'week' | 'month';
  averageSystolic: number;
  averageDiastolic: number;
  highestSystolic: number;
  lowestSystolic: number;
  highestDiastolic: number;
  lowestDiastolic: number;
  readingCount: number;
  riskDistribution: {
    normal: number;
    elevated: number;
    stage1: number;
    stage2: number;
  };
  calculatedAt: number;
}

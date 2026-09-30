import type { BPPrediction, PredictionProfile, ValidatedSensorWindow } from '../../types/measurement.ts';
import { MeasurementServiceError } from '../measurement/errors.ts';

export interface PredictionRequest {
  readonly window: ValidatedSensorWindow;
  readonly profile: PredictionProfile;
  readonly signal?: AbortSignal;
}

export interface PredictionService {
  readonly predict: (request: PredictionRequest) => Promise<BPPrediction>;
}

/** Integration seam for a model package/artifact supplied by the ML team. */
export interface ModelArtifact {
  readonly modelVersion: string;
  readonly preprocessingVersion: string;
  readonly predict: (request: PredictionRequest) => Promise<{ readonly systolic: number; readonly diastolic: number }>;
}

export function createArtifactPredictionService(artifact: ModelArtifact): PredictionService {
  return {
    async predict(request) {
      if (request.signal?.aborted) throw new MeasurementServiceError({ stage: 'prediction', code: 'INFERENCE_FAILED', message: 'Prediction was cancelled.', retryable: true, identity: request.window.window.identity });
      if (request.window.validationMode !== 'model-input') throw new MeasurementServiceError({ stage: 'prediction', code: 'PREDICTION_UNAVAILABLE', message: 'Real model inference requires a model-input validated window.', retryable: false, identity: request.window.window.identity });
      const result = await artifact.predict(request);
      if (!Number.isFinite(result.systolic) || !Number.isFinite(result.diastolic)) throw new MeasurementServiceError({ stage: 'prediction', code: 'INFERENCE_FAILED', message: 'Model artifact returned non-finite blood-pressure values.', retryable: false, identity: request.window.window.identity });
      if (request.signal?.aborted) throw new MeasurementServiceError({ stage: 'prediction', code: 'INFERENCE_FAILED', message: 'Prediction was cancelled.', retryable: true, identity: request.window.window.identity });
      return {
        identity: request.window.window.identity,
        systolic: result.systolic,
        diastolic: result.diastolic,
        unit: 'mmHg',
        predictedAtMs: Date.now(),
        provenance: { mode: 'real', implementationVersion: 'artifact-adapter-v1', modelVersion: artifact.modelVersion, preprocessingVersion: artifact.preprocessingVersion },
      };
    },
  };
}

export function createMockPredictionService(expected = { systolic: 120, diastolic: 80 }): PredictionService {
  return {
    async predict(request) {
      if (request.signal?.aborted) throw new MeasurementServiceError({ stage: 'prediction', code: 'INFERENCE_FAILED', message: 'Prediction was cancelled.', retryable: true, identity: request.window.window.identity });
      if (!Number.isFinite(expected.systolic) || !Number.isFinite(expected.diastolic)) throw new MeasurementServiceError({ stage: 'prediction', code: 'INFERENCE_FAILED', message: 'Mock output fixture must contain finite values.', retryable: false });
      return { identity: request.window.window.identity, ...expected, unit: 'mmHg', predictedAtMs: Date.now(), provenance: { mode: 'mock', implementationVersion: 'fixed-fixture-v1', modelVersion: null, preprocessingVersion: null } };
    },
  };
}

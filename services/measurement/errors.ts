import type { SourceWindowIdentity } from '../../types/measurement.ts';

export type ServiceErrorStage = 'connection' | 'decode' | 'assembly' | 'validation' | 'profile' | 'prediction' | 'storage';
export type ServiceErrorCode = 'INVALID_PACKET' | 'INCOMPLETE_WINDOW' | 'CONFLICTING_PACKET' | 'RESOURCE_LIMIT' | 'INVALID_PROFILE' | 'PREDICTION_UNAVAILABLE' | 'INFERENCE_FAILED' | 'SYNC_FAILED' | 'DEVICE_UNAVAILABLE' | 'STORAGE_FAILED' | 'NOT_IMPLEMENTED';
export interface ServiceErrorDetails { readonly stage: ServiceErrorStage; readonly code: ServiceErrorCode; readonly message: string; readonly retryable: boolean; readonly identity?: SourceWindowIdentity; readonly cause?: unknown }

export class MeasurementServiceError extends Error {
  readonly stage: ServiceErrorStage;
  readonly code: ServiceErrorCode;
  readonly retryable: boolean;
  readonly identity?: SourceWindowIdentity;
  override readonly cause?: unknown;
  constructor(details: ServiceErrorDetails) {
    super(details.message, { cause: details.cause });
    this.name = 'MeasurementServiceError';
    this.stage = details.stage;
    this.code = details.code;
    this.retryable = details.retryable;
    this.identity = details.identity;
    this.cause = details.cause;
  }
}

export class ServiceNotImplementedError extends MeasurementServiceError {
  constructor(service: string) {
    super({ stage: 'validation', code: 'NOT_IMPLEMENTED', message: `${service} is a placeholder and has not been implemented.`, retryable: false });
    this.name = 'ServiceNotImplementedError';
  }
}
export type ServiceResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: MeasurementServiceError };

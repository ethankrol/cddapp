/** Pure research arithmetic; no clinical validity or sensor-quality assessment. */
export const SCHEMA_VERSION: 1;
export type BP = { sbp: number; dbp: number };
export type Context = {
  userId: string; modelSha256: string; normalizationSha256: string;
  preprocessingVersion: string; sensorId: string; firmwareVersion: string;
  sensorSite: string; channelConfiguration: string; samplingRateHz: number;
  resamplingVersion: string; qualityPolicyVersion: string; pairingProtocolVersion: string;
};
export type RejectionStatus = 'invalid_input' | 'invalid_profile' | 'time_error'
  | 'insufficient_signal' | 'insufficient_calibration' | 'calibration_required'
  | 'incompatible' | 'stale' | 'already_processed' | 'synthetic_excluded'
  | 'profile_conflict' | 'reference_reuse';
export type Result<T> = { ok: true; value: T } | { ok: false; status: RejectionStatus; reason: string };
export type Beat = {
  beatId: string; accepted: boolean; sbp?: number; dbp?: number;
  weight?: number; rejectionReason?: string;
};
export type Recording = {
  schemaVersion: 1; stage: 'uncalibrated_recording'; source: 'recorded' | 'synthetic';
  recordingId: string; context: Context; startedAt: string; endedAt: string;
  estimate: BP; acceptedBeatCount: number; rejectedBeatCount: number; positiveWeightBeatCount: number;
};
export type CalibrationPolicy = {
  version: string;
  /** Configurable research expiry; 30 means rolling 30 days, not a validated clinical interval. */
  intervalDays: number;
  /** Integer >=2; distinct cuff IDs and recording IDs are enforced, biological independence is not inferred. */
  minPairs: number;
  /** Explicit protocol decision, never supplied by the core. */
  maxPairGapMs: number;
  /** Explicit maximum span from earliest accepted acquisition/cuff time to latest; no clinical default. */
  maxSessionSpanMs: number;
};
export type ReferencePair = {
  referenceId: string; sessionId: string; cuffDeviceId: string; measuredAt: string; units: 'mmHg';
  cuff: BP; recording: Recording; accepted: boolean; weight?: number; rejectionReason?: string | null;
};
export type CalibrationProfile = {
  schemaVersion: 1; kind: 'research_calibration_profile'; method: 'per_output_offset_v1';
  profileId: string; sessionId: string; profileRevision: 1; status: 'accepted'; createdAt: string;
  calibratedAt: string; expiresAt: string; context: Context; policy: CalibrationPolicy;
  offsets: BP; pairs: ReferencePair[]; acceptedPairCount: number; supersedesProfileId: string | null;
};
export type CalibratedResearchResult = {
  schemaVersion: 1; stage: 'calibrated_research_result'; source: 'recorded';
  recordingId: string; startedAt: string; endedAt: string; context: Context;
  uncalibratedEstimate: BP; calibratedEstimate: BP;
  calibrationProfileId: string; calibrationProfileRevision: 1; calibrationAgeDays: number;
  calibrationStatus: 'active_under_research_policy'; appliedAt: string;
  acceptedBeatCount: number; rejectedBeatCount: number;
};
export function aggregatePrediction(input: {
  recordingId: string; context: Context; startedAt: string; endedAt: string;
  now: string; source: 'recorded' | 'synthetic'; beats: Beat[];
}): Result<Recording>;
export function createCalibration(input: {
  profileId: string; sessionId: string; context: Context; now: string; pairs: ReferencePair[];
  policy: CalibrationPolicy; supersedesProfileId?: string | null;
}): Result<CalibrationProfile>;
export function selectLatestCalibration(profiles: CalibrationProfile[], context: Context, now: string): Result<CalibrationProfile>;
export function applyCalibration(recording: Recording | CalibratedResearchResult, profile: CalibrationProfile | null,
  context: Context, now: string): Result<CalibratedResearchResult>;
export function serializeProfile(profile: CalibrationProfile): Result<string>;
export function deserializeProfile(json: string): Result<CalibrationProfile>;

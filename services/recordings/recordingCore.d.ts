export const CONTRACT: 'cdd_ppg_recording_v1';
export const MAX_FILE_BYTES: number;
export const MAX_SAMPLES: number;
export type SensorRecording = {
  schemaVersion: 1; kind: typeof CONTRACT; source: 'synthetic' | 'recorded';
  recordingId: string; participantCode: string; startedAt: string; samplingRateHz: number;
  timingSource: 'sensor' | 'sample_clock' | 'arrival';
  sensor: {id: string; model: string; firmwareVersion: string; site: string};
  channel: {name: string; wavelengthNm: number | null; units: string; adcMin: number | null; adcMax: number | null};
  acquisition: {gain: string; ledCurrentMa: number | null; preprocessing: string};
  samples: [number, number, number][];
};
export type Inspection = {
  schemaVersion: 1; contract: string; source: string; sampleCount: number; samplingRateHz: number;
  observedSequenceRateHz: number | null; elapsedSeconds: number; nominalDurationSeconds: number;
  missingSequencePositions: number; duplicateSequences: number; sequenceReversals: number;
  nonIncreasingTimestamps: number; timingMismatchIntervals: number; medianIntervalMs: number | null;
  maxIntervalMs: number; timingToleranceMs: number;
  signal: {min: number; max: number; mean: number; std: number; longestConstantRun: number; atRails: number; outsideRails: number};
  completePreviewWindows: number; remainderSamples: number; previewAllowed: boolean; blockers: string[]; warnings: string[];
  sensorCompatibilityVerified: false; qualityValidated: false; modelInferenceRun: false;
};
export type BeatPreview = {windows: {window: number; firstSequence: number; candidateCount: number; peakCount: number; shortIntervalsRejected: number; error: string | null}[];
  remainderSamples: number; modelInferenceRun: false; normalizationApplied: false; passed: boolean};
export function parseRecordingJson(json: string): SensorRecording;
export function validateRecording(value: unknown): SensorRecording;
export function inspectRecording(recording: SensorRecording): Inspection;
export function previewBeatExtraction(recording: SensorRecording): BeatPreview;
export function makeDemoRecording(): SensorRecording;

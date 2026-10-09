export type PpgFixtureResult = {
  schemaVersion: number; test: string; synthetic: boolean; contract: string;
  inputStage: string; outputStage: string; rawSampleCount: number; samplingRateHz: number;
  candidateCount: number; expectedCandidateCount: number; candidatesNumericallyChecked: number;
  channelValuesChecked: number; timingValuesChecked: number; candidateCountMatches: boolean;
  intervalsMatch: boolean; maxWaveDifference: number; maxTimingDifference: number;
  tolerances: { waveAbsolute: number; timingAbsolute: number }; exactMatch: boolean;
  passed: boolean; preprocessingMs: number; peakCount: number; selectedScaleIndex: number;
  shortIntervalsRejected: number; normalizationApplied: boolean; modelInferenceRun: boolean;
  qualityValidated: boolean; memoryMeasured: boolean; energyMeasured: boolean;
};
export const CONTRACT: string;
export const FIXTURE_TOLERANCES: { readonly waveAbsolute: number; readonly timingAbsolute: number };
export function runFixture(fixture: unknown): PpgFixtureResult;
export function extractPpg(raw: number[] | Float32Array | Float64Array, samplingRateHz?: number): {
  contract: string; stage: string; samplingRateHz: number;
  beats: Float32Array[][]; timing: Float32Array[]; intervals: number[][];
  peaks: number[]; selectedScaleIndex: number; shortIntervalsRejected: number;
};

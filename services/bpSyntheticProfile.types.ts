import type { LatencySummary } from './bpProfileStats';

export type ProfileOptions = { shouldStop: () => boolean; onProgress: (message: string) => void };
export type SyntheticProfile = {
  schemaVersion: 1; synthetic: true; startedAt: string; finishedAt: string;
  platform: string; osVersion: string; developmentBuild: boolean;
  modelSha256: string; fixtureSha256: string; onnxRuntimeVersion: string;
  inputStage: 'normalized_model_inputs'; executionProvider: 'cpu'; threads: 1;
  plannedWarmup: number; plannedMeasured: number; attempted: number; successful: number;
  parityFailures: number; runtimeFailures: number; complete: boolean; passed: boolean;
  failure: string | null; cancelled: boolean;
  importMs: number | null; assetResolveMs: number | null; sessionCreateMs: number | null;
  firstInferenceMs: number | null; firstResultWallMs: number | null; releaseMs: number | null;
  totalWallMs: number; inferenceMs: number[]; latency: LatencySummary | null;
  maxDifferenceMmhg: { SBP: number; DBP: number }; toleranceMmhg: 0.01;
  memoryMeasured: false; energyMeasured: false; freshSession: true; osCacheState: 'uncontrolled';
};

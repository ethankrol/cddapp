export type PpgChainReport = {
  schemaVersion: number; test: string; synthetic: boolean; contract: string;
  startedAt: string; finishedAt: string | null; inputStage: string; outputStage: string;
  complete: boolean; passed: boolean; cancelled: boolean;
  failure: { phase: string; message: string } | null; cleanupFailure: string | null;
  preprocessing: { passed: boolean; candidateCount: number; maxWaveDifference: number;
    maxTimingDifference: number; exactMatch: boolean; preprocessingMs: number } | null;
  normalization: { passed: boolean; maxBeatDifference: number; maxTimingDifference: number;
    exactMatch: boolean; normalizationMs: number } | null;
  attempted: number; successful: number; parityFailures: number; runtimeFailures: number;
  outputs: Array<{ candidate: number; interval: number[]; phone: number[];
    reference: number[]; differenceMmhg: number[]; passed: boolean }>;
  maxDifferenceMmhg: { SBP: number; DBP: number } | null;
  inferenceMs: number[]; totalWallMs: number; sessionReleased: boolean;
  [key: string]: unknown;
};
export type ChainAdapter = {
  timings?: { importMs: number; assetResolveMs: number; sessionCreateMs: number };
  run(beat: Float32Array, timing: Float32Array): Promise<{values: number[]; inferenceMs: number}>;
  release(): Promise<void>;
};
export function runChain(options: {
  fixture: unknown; reference: unknown; normalization: unknown;
  createAdapter(): Promise<ChainAdapter>; shouldCancel?: () => boolean; now?: () => number;
}): Promise<PpgChainReport>;

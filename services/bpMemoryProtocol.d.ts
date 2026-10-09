export type MemoryPoint = { elapsedMs: number; footprintBytes: number; residentBytes: number; phase: string };
export type MemoryRow = { cycle: number; beforeBytes: number | null; observedPeakBytes: number | null;
  afterReleaseBytes: number | null; settledMedianBytes: number | null; deltaFromBaselineBytes: number | null;
  settledWindowSampleCount: number; settledWindowCoveredMs: number; actualWaitMs: number | null; inferencePassed: boolean };
export type MemoryReport = {
  schemaVersion: number; test: string; synthetic: boolean; startedAt: string; finishedAt: string;
  complete: boolean; inferencePassed: boolean; memorySamplingComplete: boolean; cancelled: boolean;
  failure: string | null; totalWallMs: number; native: Record<string, unknown> | null;
  summary: null | { baselineMedianBytes: number; observedPeakBytes: number; cycles: MemoryRow[];
    finalSettledMinusFirstSettledBytes: number | null; leakAssessment: string; interpretation: string };
  [key: string]: unknown;
};
export type MemoryOptions = { shouldStop: () => boolean; onProgress: (text: string) => void; metadata?: Record<string, unknown> };
export function runMemoryProtocol(deps: { sampler: any; runProfile: (options: any) => Promise<any>;
  now?: () => number; sleep?: (ms: number) => Promise<void> }, options: MemoryOptions): Promise<MemoryReport>;
export function summarizeTrace(trace: any, cycles: any[]): NonNullable<MemoryReport['summary']>;
export function memorySummaryForSharing(report: MemoryReport): Record<string, unknown>;

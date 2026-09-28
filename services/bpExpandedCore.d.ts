export type ExpandedMode = 'full' | 'blocks' | 'rolling' | 'idle';
export type Progress = {seconds?: number; durationSeconds?: number; windows: number};
export type ExpandedReport = {
  passed: boolean; complete: boolean; cancelled: boolean; successful: number;
  parityFailures: number; windows: unknown[]; failure: string | null;
  cleanupFailure: string | null; totalWallMs: number; [key: string]: unknown;
};
export function runExpanded(options: {
  reference: unknown; mode: ExpandedMode; durationSeconds: number;
  createAdapter(): Promise<import('./bpPpgChainCore').ChainAdapter>;
  shouldCancel(): boolean; onProgress(value: Progress): void;
}): Promise<ExpandedReport>;

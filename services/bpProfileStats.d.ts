export type LatencySummary = {
  count: number; mean: number; p50: number; p95: number; min: number; max: number;
  percentileMethod: string;
};
export function summarizeLatency(values: number[]): LatencySummary;

/** Minimal rolling 24-hour cache contract; concrete SQLite schema belongs with app storage setup. */
export interface TimestampedPpgWindow { readonly id: string; readonly recordedAtMs: number; readonly values: readonly number[] }
export interface RollingPpgCache {
  readonly append: (window: TimestampedPpgWindow) => Promise<void>;
  readonly listSince: (sinceMs: number) => Promise<readonly TimestampedPpgWindow[]>;
  readonly pruneBefore: (cutoffMs: number) => Promise<number>;
}

export function rolling24HourCutoff(nowMs: number): number {
  if (!Number.isFinite(nowMs)) throw new RangeError('Current time must be finite.');
  return nowMs - 24 * 60 * 60 * 1000;
}

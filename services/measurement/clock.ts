export interface MeasurementClock { readonly nowMs: () => number; readonly monotonicMs: () => number }
export function createSystemMeasurementClock(): MeasurementClock {
  return { nowMs: () => Date.now(), monotonicMs: () => globalThis.performance?.now() ?? Date.now() };
}
export interface ManualMeasurementClock extends MeasurementClock { readonly advanceBy: (milliseconds: number) => void; readonly setWallTime: (timestampMs: number) => void }
export function createManualMeasurementClock(initialWallTimeMs = 0): ManualMeasurementClock {
  let wallTimeMs = initialWallTimeMs;
  let elapsedMs = 0;
  return {
    nowMs: () => wallTimeMs,
    monotonicMs: () => elapsedMs,
    advanceBy(milliseconds) {
      if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new RangeError('Clock advance must be a finite, nonnegative number.');
      wallTimeMs += milliseconds;
      elapsedMs += milliseconds;
    },
    setWallTime(timestampMs) {
      if (!Number.isFinite(timestampMs)) throw new RangeError('Wall time must be finite.');
      wallTimeMs = timestampMs;
    },
  };
}

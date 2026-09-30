import type { SavedReading } from '../../types/measurement.ts';
import { MeasurementServiceError } from '../measurement/errors.ts';

export interface CachedHealthRecord {
  readonly id: string;
  readonly recordedAtMs: number;
  readonly ppg: readonly number[];
  readonly reading?: SavedReading;
}
export interface HealthDataCache {
  readonly countPending: () => Promise<number>;
  readonly listPending: (limit: number) => Promise<readonly CachedHealthRecord[]>;
  readonly markSynced: (ids: readonly string[], syncedAtMs: number) => Promise<void>;
}
export interface HealthDataRemoteStore {
  readonly putBatch: (records: readonly CachedHealthRecord[], signal?: AbortSignal) => Promise<void>;
}
export type SyncStatus = 'idle' | 'syncing' | 'error';
export interface SyncState { readonly status: SyncStatus; readonly pendingCount: number; readonly lastSyncAtMs: number | null; readonly lastError: string | null }
export interface SyncResult { readonly syncedCount: number; readonly pendingCount: number; readonly lastSyncAtMs: number | null }
export interface AwsSyncService {
  readonly getState: () => SyncState;
  readonly subscribe: (listener: (state: SyncState) => void) => () => void;
  readonly sync: (signal?: AbortSignal) => Promise<SyncResult>;
}
export interface AwsSyncOptions { readonly batchSize: number; readonly maxAttempts: number; readonly baseRetryDelayMs: number; readonly isOnline: () => boolean; readonly nowMs?: () => number; readonly wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void> }

function abortError(): MeasurementServiceError { return new MeasurementServiceError({ stage: 'storage', code: 'SYNC_FAILED', message: 'AWS sync was cancelled.', retryable: true }); }
function defaultWait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(abortError()); }, { once: true });
  });
}

/** Coordinates a local rolling cache and injected remote store. It contains no AWS credentials or SDK setup. */
export function createAwsSyncService(cache: HealthDataCache, remote: HealthDataRemoteStore, options: AwsSyncOptions): AwsSyncService {
  if (!Number.isInteger(options.batchSize) || options.batchSize <= 0 || !Number.isInteger(options.maxAttempts) || options.maxAttempts <= 0 || options.baseRetryDelayMs < 0) throw new RangeError('Sync limits must be positive and retry delay nonnegative.');
  const now = options.nowMs ?? Date.now;
  const wait = options.wait ?? defaultWait;
  let state: SyncState = { status: 'idle', pendingCount: 0, lastSyncAtMs: null, lastError: null };
  let active: Promise<SyncResult> | null = null;
  const listeners = new Set<(value: SyncState) => void>();
  const publish = (next: SyncState) => { state = next; for (const listener of listeners) listener(state); };
  return {
    getState: () => state,
    subscribe(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener); },
    sync(signal) {
      if (active) return active;
      active = (async () => {
        let syncedCount = 0;
        try {
          publish({ ...state, status: 'syncing', pendingCount: await cache.countPending(), lastError: null });
          if (!options.isOnline()) throw new MeasurementServiceError({ stage: 'connection', code: 'SYNC_FAILED', message: 'Cannot sync while offline.', retryable: true });
          while (true) {
            if (signal?.aborted) throw abortError();
            const batch = await cache.listPending(options.batchSize);
            publish({ ...state, pendingCount: Math.max(0, state.pendingCount) });
            if (batch.length === 0) break;
            let attempt = 0;
            while (true) {
              try { await remote.putBatch(batch, signal); break; }
              catch (error) {
                attempt += 1;
                if (attempt >= options.maxAttempts || signal?.aborted) throw error;
                await wait(options.baseRetryDelayMs * 2 ** (attempt - 1), signal);
              }
            }
            const syncedAtMs = now();
            await cache.markSynced(batch.map((record) => record.id), syncedAtMs);
            syncedCount += batch.length;
            publish({ ...state, pendingCount: Math.max(0, state.pendingCount - batch.length), lastSyncAtMs: syncedAtMs });
          }
          publish({ ...state, status: 'idle', lastError: null });
          return { syncedCount, pendingCount: state.pendingCount, lastSyncAtMs: state.lastSyncAtMs };
        } catch (error) {
          publish({ ...state, status: 'error', lastError: error instanceof Error ? error.message : 'Unknown sync failure.' });
          throw error;
        } finally { active = null; }
      })();
      return active;
    },
  };
}

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createAwsSyncService, type CachedHealthRecord } from '../../services/sync/aws-sync-service.ts';

describe('AWS health sync service', () => {
  it('uploads pending local records, retries transient failure, and updates application sync state', async () => {
    const pending: CachedHealthRecord[] = [
      { id: 'w1', recordedAtMs: 10, ppg: [0.1, 0.2] },
      { id: 'w2', recordedAtMs: 20, ppg: [0.3, 0.4] },
    ];
    let calls = 0;
    const cache = {
      countPending: async () => pending.length,
      listPending: async (limit: number) => pending.slice(0, limit),
      markSynced: async (ids: readonly string[]) => { for (const id of ids) pending.splice(pending.findIndex((item) => item.id === id), 1); },
    };
    const remote = { async putBatch(records: readonly CachedHealthRecord[]) { calls += 1; if (calls === 1) throw new Error('temporary network error'); assert.equal(records.length, 2); } };
    const service = createAwsSyncService(cache, remote, { batchSize: 10, maxAttempts: 2, baseRetryDelayMs: 0, isOnline: () => true, nowMs: () => 1234, wait: async () => {} });
    const result = await service.sync();
    assert.deepEqual(result, { syncedCount: 2, pendingCount: 0, lastSyncAtMs: 1234 });
    assert.equal(calls, 2);
    assert.deepEqual(service.getState(), { status: 'idle', pendingCount: 0, lastSyncAtMs: 1234, lastError: null });
  });
  it('reports offline state as a predictable retryable error', async () => {
    const service = createAwsSyncService({ countPending: async () => 0, listPending: async () => [], markSynced: async () => {} }, { putBatch: async () => {} }, { batchSize: 1, maxAttempts: 1, baseRetryDelayMs: 0, isOnline: () => false });
    await assert.rejects(service.sync(), /offline/);
    assert.equal(service.getState().status, 'error');
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CompleteSensorWindow, PredictionProfile, ValidatedSensorWindow } from '../../types/measurement.ts';
import { createArtifactPredictionService, createMockPredictionService } from '../../services/prediction/prediction-service.ts';

const identity = { source: 'demo' as const, deviceId: 'fixture-device', acquisitionId: 'fixture-run', windowId: 'fixture-window' };
const complete: CompleteSensorWindow = {
  identity,
  manifest: { contractVersion: 'fixture', packetCount: 1, channels: [{ channelId: 'ppg', sampleCount: 2 }] },
  channels: [{ channelId: 'ppg', samples: [0.1, 0.2], unit: null, timing: { sampleRateHz: null, firstSampleOffsetMs: null } }],
  acquisitionTime: { kind: 'unavailable' },
  firstReceivedAtMs: 100,
  lastReceivedAtMs: 100,
  diagnostics: { receivedPacketCount: 1, identicalDuplicateCount: 0 },
};
const request = (validationMode: ValidatedSensorWindow['validationMode']): { window: ValidatedSensorWindow; profile: PredictionProfile } => ({
  window: { window: complete, validationMode, inputContractVersion: 'test-v1', validatorVersion: 'test-v1', validatedAtMs: 100 },
  profile: { ageYears: 35, heightCm: 170, weightKg: 70, profileContractVersion: 'test-v1', source: 'synthetic-demo', validatedAtMs: 100 },
});

describe('blood-pressure inference service', () => {
  it('returns the documented independent mock fixture output', async () => {
    const result = await createMockPredictionService({ systolic: 121, diastolic: 79 }).predict(request('demo-structural'));
    assert.deepEqual([result.systolic, result.diastolic, result.unit], [121, 79, 'mmHg']);
    assert.equal(result.provenance.mode, 'mock');
  });
  it('invokes an injected model artifact and records model/preprocessing provenance', async () => {
    let invoked = false;
    const service = createArtifactPredictionService({ modelVersion: 'test-model-1', preprocessingVersion: 'training-pipeline-4', async predict(input) { invoked = true; assert.equal(input.profile.weightKg, 70); return { systolic: 118, diastolic: 76 }; } });
    const result = await service.predict(request('model-input'));
    assert.equal(invoked, true);
    assert.deepEqual([result.systolic, result.diastolic], [118, 76]);
    assert.equal(result.provenance.preprocessingVersion, 'training-pipeline-4');
  });
  it('refuses model execution for structural demo validation', async () => {
    const service = createArtifactPredictionService({ modelVersion: 'm1', preprocessingVersion: 'p1', async predict() { throw new Error('must not run'); } });
    await assert.rejects(service.predict(request('demo-structural')), { code: 'PREDICTION_UNAVAILABLE' });
  });
});

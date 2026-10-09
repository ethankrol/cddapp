import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SensorPacket } from '../../types/measurement.ts';
import { createManualMeasurementClock } from '../../services/measurement/clock.ts';
import { createPacketValidator } from '../../services/measurement/packet-validation.ts';
import { createBleHandlerService, type BleDevice } from '../../services/device/ble-handler-service.ts';

const packets: SensorPacket[] = [0, 1].map((packetIndex) => ({
  identity: { source: 'bracelet', deviceId: 'watch-test', acquisitionId: 'boot-1', windowId: 'window-1' },
  manifest: { contractVersion: 'test-frame-v1', packetCount: 2, channels: [{ channelId: 'ppg', sampleCount: 4 }] },
  packetIndex,
  chunks: [{ channelId: 'ppg', sampleOffset: packetIndex * 2, samples: [packetIndex + 0.1, packetIndex + 0.2], unit: null, timing: { sampleRateHz: null, firstSampleOffsetMs: null } }],
  receivedAtMs: 0,
  acquisitionTime: { kind: 'unavailable' },
}));

describe('BLE handler service', () => {
  it('scans, connects, validates and reassembles notifications, and disconnects', async () => {
    let notify: ((bytes: Uint8Array) => void) | undefined;
    let scanStopped = false;
    let disconnected = false;
    const devices: BleDevice[] = [];
    const platform = {
      async scan(onDevice: (device: BleDevice) => void) { onDevice({ id: 'watch-test', name: 'Test Watch', rssi: -40 }); return async () => { scanStopped = true; }; },
      async connect(_id: string, onNotification: (bytes: Uint8Array) => void) { notify = onNotification; },
      async disconnect() { disconnected = true; },
    };
    const decoder = { decode(bytes: Uint8Array) { return [packets[bytes[0]]]; } };
    const service = createBleHandlerService(platform, decoder, createPacketValidator({ maxPacketsPerWindow: 4, maxChannelsPerWindow: 3, maxSamplesPerChannel: 8, maxSamplesPerPacket: 8, maxIdentifierLength: 64 }), createManualMeasurementClock(500));
    let completedSamples: readonly number[] | undefined;
    service.subscribe((event) => { if (event.type === 'window') completedSamples = event.window.channels[0].samples; });
    await service.scan((device) => devices.push(device));
    assert.equal(devices.length, 1);
    await service.connect('watch-test');
    assert.equal(scanStopped, true);
    assert.equal(service.getState().connectionState, 'connected');
    notify?.(new Uint8Array([1]));
    assert.equal(completedSamples, undefined);
    notify?.(new Uint8Array([0]));
    assert.deepEqual(completedSamples, [0.1, 0.2, 1.1, 1.2]);
    await service.disconnect();
    assert.equal(disconnected, true);
    assert.equal(service.getState().connectionState, 'disconnected');
  });
});

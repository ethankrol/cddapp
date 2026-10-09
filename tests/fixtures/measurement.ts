import type { SensorPacket } from '../../types/measurement.ts';

/** Synthetic structure-only fixture. Values and counts are not hardware specifications. */
export const validDemoPacket: SensorPacket = {
  identity: { source: 'demo', deviceId: 'demo-device', acquisitionId: 'demo-acquisition-1', windowId: 'window-1' },
  manifest: {
    contractVersion: 'demo-contract-v1',
    packetCount: 2,
    channels: [
      { channelId: 'ppg-demo', sampleCount: 4 },
      { channelId: 'pressure-demo', sampleCount: 2 },
      { channelId: 'temperature-demo', sampleCount: 1 },
    ],
  },
  packetIndex: 0,
  chunks: [
    { channelId: 'ppg-demo', sampleOffset: 0, samples: [0.1, 0.2], unit: null, timing: { sampleRateHz: null, firstSampleOffsetMs: null } },
    { channelId: 'pressure-demo', sampleOffset: 0, samples: [0.3], unit: null, timing: { sampleRateHz: null, firstSampleOffsetMs: null } },
    { channelId: 'temperature-demo', sampleOffset: 0, samples: [0.4], unit: null, timing: { sampleRateHz: null, firstSampleOffsetMs: null } },
  ],
  receivedAtMs: 1_000,
  acquisitionTime: { kind: 'unavailable' },
};

export function cloneAsUnknown<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value));
}

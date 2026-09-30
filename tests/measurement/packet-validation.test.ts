import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createManualMeasurementClock } from '../../services/measurement/clock.ts';
import { createPacketValidator } from '../../services/measurement/packet-validation.ts';
import { encodeSourceWindowIdentity } from '../../types/measurement.ts';
import { cloneAsUnknown, validDemoPacket } from '../fixtures/measurement.ts';

const limits = { maxPacketsPerWindow: 8, maxChannelsPerWindow: 4, maxSamplesPerChannel: 16, maxSamplesPerPacket: 12, maxIdentifierLength: 64 };
interface MutablePacket {
  packetIndex: number;
  manifest: { packetCount: number; channels: { channelId: string }[] };
  chunks: { sampleOffset: number; samples: number[] }[];
}

describe('packet validation', () => {
  const validator = createPacketValidator(limits);
  it('accepts differing channel counts and unknown units/rates', () => {
    const result = validator.validate(validDemoPacket);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.value.manifest.channels.map((channel) => channel.sampleCount), [4, 2, 1]);
      assert.equal(result.value.chunks.every((chunk) => chunk.unit === null && chunk.timing.sampleRateHz === null), true);
    }
  });

  const cases: readonly [string, (packet: MutablePacket) => void][] = [
    ['NaN sample', (p) => { p.chunks[0].samples[0] = Number.NaN; }],
    ['infinite sample', (p) => { p.chunks[0].samples[0] = Number.POSITIVE_INFINITY; }],
    ['fractional index', (p) => { p.packetIndex = 0.5; }],
    ['out-of-range index', (p) => { p.packetIndex = 2; }],
    ['negative offset', (p) => { p.chunks[0].sampleOffset = -1; }],
    ['duplicate manifest channel', (p) => { p.manifest.channels[1].channelId = 'ppg-demo'; }],
    ['chunk beyond coverage', (p) => { p.chunks[0].sampleOffset = 3; }],
  ];
  for (const [name, mutate] of cases) {
    it(`rejects ${name}`, () => {
      const packet = cloneAsUnknown(validDemoPacket) as MutablePacket;
      mutate(packet);
      assert.equal(validator.validate(packet).ok, false);
    });
  }

  it('reports resource limits distinctly', () => {
    const packet = cloneAsUnknown(validDemoPacket) as MutablePacket;
    packet.manifest.packetCount = 9;
    const result = validator.validate(packet);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'RESOURCE_LIMIT');
  });

  it('defensively copies sample arrays', () => {
    const packet = cloneAsUnknown(validDemoPacket) as MutablePacket;
    const result = validator.validate(packet);
    assert.equal(result.ok, true);
    packet.chunks[0].samples[0] = 99;
    if (result.ok) assert.equal(result.value.chunks[0].samples[0], 0.1);
  });
});

describe('shared measurement utilities', () => {
  it('encodes delimiter-containing identities without collisions', () => {
    const first = encodeSourceWindowIdentity({ source: 'demo', deviceId: 'a|b', acquisitionId: 'c', windowId: 'd' });
    const second = encodeSourceWindowIdentity({ source: 'demo', deviceId: 'a', acquisitionId: 'b|c', windowId: 'd' });
    assert.notEqual(first, second);
  });
  it('keeps wall-clock changes separate from monotonic time', () => {
    const clock = createManualMeasurementClock(100);
    clock.advanceBy(25);
    clock.setWallTime(5);
    assert.equal(clock.nowMs(), 5);
    assert.equal(clock.monotonicMs(), 25);
  });
});

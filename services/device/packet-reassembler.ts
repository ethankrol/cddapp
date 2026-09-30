import type { CompleteSensorWindow, SensorPacket, WindowChannel } from '../../types/measurement.ts';
import { encodeSourceWindowIdentity } from '../../types/measurement.ts';
import { MeasurementServiceError } from '../measurement/errors.ts';

interface AssemblyState { readonly packets: Map<number, SensorPacket>; readonly sampleSlots: Map<string, (number | undefined)[]>; firstReceivedAtMs: number; lastReceivedAtMs: number }
export type PacketReassemblyResult = { readonly status: 'pending' } | { readonly status: 'duplicate' } | { readonly status: 'complete'; readonly window: CompleteSensorWindow };

/** Reassembles normalized, already-decoded SensorPacket frames. Wire-byte decoding is injected separately. */
export class SensorPacketReassembler {
  private readonly windows = new Map<string, AssemblyState>();
  private readonly maxConcurrentWindows: number;
  constructor(maxConcurrentWindows = 4) {
    if (!Number.isInteger(maxConcurrentWindows) || maxConcurrentWindows <= 0) throw new RangeError('maxConcurrentWindows must be positive.');
    this.maxConcurrentWindows = maxConcurrentWindows;
  }
  accept(packet: SensorPacket): PacketReassemblyResult {
    const key = encodeSourceWindowIdentity(packet.identity);
    let state = this.windows.get(key);
    if (!state) {
      if (this.windows.size >= this.maxConcurrentWindows) throw new MeasurementServiceError({ stage: 'assembly', code: 'RESOURCE_LIMIT', message: 'Too many concurrent BLE windows.', retryable: true, identity: packet.identity });
      const sampleSlots = new Map(packet.manifest.channels.map((channel) => [channel.channelId, Array<number | undefined>(channel.sampleCount).fill(undefined)]));
      state = { packets: new Map(), sampleSlots, firstReceivedAtMs: packet.receivedAtMs, lastReceivedAtMs: packet.receivedAtMs };
      this.windows.set(key, state);
    }
    const prior = state.packets.get(packet.packetIndex);
    if (prior) {
      if (JSON.stringify({ ...prior, receivedAtMs: 0 }) === JSON.stringify({ ...packet, receivedAtMs: 0 })) return { status: 'duplicate' };
      this.windows.delete(key);
      throw new MeasurementServiceError({ stage: 'assembly', code: 'CONFLICTING_PACKET', message: 'Conflicting duplicate BLE packet invalidated the window.', retryable: false, identity: packet.identity });
    }
    const template = state.packets.values().next().value as SensorPacket | undefined;
    if (template && JSON.stringify(template.manifest) !== JSON.stringify(packet.manifest)) {
      this.windows.delete(key);
      throw new MeasurementServiceError({ stage: 'assembly', code: 'INVALID_PACKET', message: 'BLE packets disagree about window manifest.', retryable: false, identity: packet.identity });
    }
    for (const chunk of packet.chunks) {
      const slots = state.sampleSlots.get(chunk.channelId);
      if (!slots) { this.windows.delete(key); throw new MeasurementServiceError({ stage: 'assembly', code: 'INVALID_PACKET', message: 'BLE packet contains a channel outside its manifest.', retryable: false, identity: packet.identity }); }
      for (let offset = 0; offset < chunk.samples.length; offset += 1) {
        const index = chunk.sampleOffset + offset;
        if (slots[index] !== undefined) { this.windows.delete(key); throw new MeasurementServiceError({ stage: 'assembly', code: 'CONFLICTING_PACKET', message: 'BLE packets overlap channel sample coverage.', retryable: false, identity: packet.identity }); }
        slots[index] = chunk.samples[offset];
      }
    }
    state.packets.set(packet.packetIndex, packet);
    state.firstReceivedAtMs = Math.min(state.firstReceivedAtMs, packet.receivedAtMs);
    state.lastReceivedAtMs = Math.max(state.lastReceivedAtMs, packet.receivedAtMs);
    if (state.packets.size !== packet.manifest.packetCount || [...state.sampleSlots.values()].some((slots) => slots.some((sample) => sample === undefined))) return { status: 'pending' };
    const channels: WindowChannel[] = packet.manifest.channels.map((required) => {
      const values = state.sampleSlots.get(required.channelId) as number[];
      const chunks = [...state.packets.values()].flatMap((item) => item.chunks).filter((chunk) => chunk.channelId === required.channelId);
      const first = chunks[0];
      if (chunks.some((chunk) => chunk.unit !== first.unit || JSON.stringify(chunk.timing) !== JSON.stringify(first.timing))) throw new MeasurementServiceError({ stage: 'assembly', code: 'INVALID_PACKET', message: `BLE packets disagree about ${required.channelId} metadata.`, retryable: false, identity: packet.identity });
      return { channelId: required.channelId, samples: values, unit: first.unit, timing: first.timing };
    });
    this.windows.delete(key);
    return { status: 'complete', window: { identity: packet.identity, manifest: packet.manifest, channels, acquisitionTime: packet.acquisitionTime, firstReceivedAtMs: state.firstReceivedAtMs, lastReceivedAtMs: state.lastReceivedAtMs, diagnostics: { receivedPacketCount: state.packets.size, identicalDuplicateCount: 0 } } };
  }
  reset(identityKey?: string): void { if (identityKey) this.windows.delete(identityKey); else this.windows.clear(); }
}

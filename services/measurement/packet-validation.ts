import type { AcquisitionTime, ChannelChunk, DeviceSource, SensorPacket, SourceWindowIdentity, WindowManifest } from '../../types/measurement.ts';
import { MeasurementServiceError, type ServiceResult } from './errors.ts';

export interface PacketValidationLimits { readonly maxPacketsPerWindow: number; readonly maxChannelsPerWindow: number; readonly maxSamplesPerChannel: number; readonly maxSamplesPerPacket: number; readonly maxIdentifierLength: number }
export interface PacketValidator { readonly validate: (input: unknown) => ServiceResult<SensorPacket> }
type UnknownRecord = Record<string, unknown>;
const isRecord = (value: unknown): value is UnknownRecord => typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const nonnegativeInteger = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;

function failure(message: string, identity?: SourceWindowIdentity, code: 'INVALID_PACKET' | 'RESOURCE_LIMIT' = 'INVALID_PACKET'): ServiceResult<never> {
  return { ok: false, error: new MeasurementServiceError({ stage: 'validation', code, message, retryable: false, identity }) };
}
function parseIdentity(value: unknown, max: number): ServiceResult<SourceWindowIdentity> {
  if (!isRecord(value)) return failure('Packet identity must be an object.');
  const source = value.source;
  if (source !== 'demo' && source !== 'bracelet') return failure('Packet source must be demo or bracelet.');
  if (!text(value.deviceId, max) || !text(value.acquisitionId, max) || !text(value.windowId, max)) return failure('Packet identity fields must be nonempty bounded strings.');
  return { ok: true, value: { source: source as DeviceSource, deviceId: value.deviceId, acquisitionId: value.acquisitionId, windowId: value.windowId } };
}
function parseAcquisitionTime(value: unknown, max: number, identity: SourceWindowIdentity): ServiceResult<AcquisitionTime> {
  if (!isRecord(value)) return failure('Acquisition time must be an object.', identity);
  if (value.kind === 'unavailable') return { ok: true, value: { kind: 'unavailable' } };
  if (value.kind === 'wall-clock' && finite(value.timestampMs) && typeof value.synchronized === 'boolean') return { ok: true, value: { kind: 'wall-clock', timestampMs: value.timestampMs, synchronized: value.synchronized } };
  if (value.kind === 'device-ticks' && finite(value.ticks) && value.ticks >= 0 && finite(value.ticksPerSecond) && value.ticksPerSecond > 0 && text(value.clockId, max)) return { ok: true, value: { kind: 'device-ticks', ticks: value.ticks, ticksPerSecond: value.ticksPerSecond, clockId: value.clockId } };
  return failure('Acquisition time has invalid or incomplete metadata.', identity);
}
function validateLimits(limits: PacketValidationLimits): void {
  for (const [name, value] of Object.entries(limits)) if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive integer.`);
}

export function createPacketValidator(limits: PacketValidationLimits): PacketValidator {
  validateLimits(limits);
  return { validate(input) {
    if (!isRecord(input)) return failure('Packet must be an object.');
    const identityResult = parseIdentity(input.identity, limits.maxIdentifierLength);
    if (!identityResult.ok) return identityResult;
    const identity = identityResult.value;
    if (!isRecord(input.manifest)) return failure('Packet manifest must be an object.', identity);
    const rawManifest = input.manifest;
    if (!text(rawManifest.contractVersion, limits.maxIdentifierLength)) return failure('Manifest contract version is invalid.', identity);
    if (typeof rawManifest.packetCount !== 'number' || !Number.isInteger(rawManifest.packetCount) || rawManifest.packetCount <= 0) return failure('Manifest packet count must be a positive integer.', identity);
    if (rawManifest.packetCount > limits.maxPacketsPerWindow) return failure('Manifest packet count exceeds the configured limit.', identity, 'RESOURCE_LIMIT');
    if (!Array.isArray(rawManifest.channels) || rawManifest.channels.length === 0) return failure('Manifest must contain channels.', identity);
    if (rawManifest.channels.length > limits.maxChannelsPerWindow) return failure('Manifest channel count exceeds the configured limit.', identity, 'RESOURCE_LIMIT');
    const channelIds = new Set<string>();
    const channels: { channelId: string; sampleCount: number }[] = [];
    for (const raw of rawManifest.channels) {
      if (!isRecord(raw) || !text(raw.channelId, limits.maxIdentifierLength) || typeof raw.sampleCount !== 'number' || !Number.isInteger(raw.sampleCount) || raw.sampleCount <= 0) return failure('Manifest contains an invalid channel.', identity);
      if (raw.sampleCount > limits.maxSamplesPerChannel) return failure('Manifest sample count exceeds the configured limit.', identity, 'RESOURCE_LIMIT');
      if (channelIds.has(raw.channelId)) return failure('Manifest channel identifiers must be unique.', identity);
      channelIds.add(raw.channelId);
      channels.push({ channelId: raw.channelId, sampleCount: raw.sampleCount });
    }
    const manifest: WindowManifest = { contractVersion: rawManifest.contractVersion, packetCount: rawManifest.packetCount, channels };
    if (!nonnegativeInteger(input.packetIndex) || input.packetIndex >= manifest.packetCount) return failure('Packet index is outside its manifest.', identity);
    if (!finite(input.receivedAtMs)) return failure('Packet receive time must be finite.', identity);
    const acquisition = parseAcquisitionTime(input.acquisitionTime, limits.maxIdentifierLength, identity);
    if (!acquisition.ok) return acquisition;
    if (!Array.isArray(input.chunks) || input.chunks.length === 0) return failure('Packet must contain channel chunks.', identity);
    if (input.chunks.length > limits.maxChannelsPerWindow) return failure('Packet chunk count exceeds the configured limit.', identity, 'RESOURCE_LIMIT');
    const required = new Map(channels.map((channel) => [channel.channelId, channel.sampleCount]));
    const chunks: ChannelChunk[] = [];
    let packetSamples = 0;
    for (const raw of input.chunks) {
      if (!isRecord(raw) || !text(raw.channelId, limits.maxIdentifierLength)) return failure('Packet contains an invalid chunk.', identity);
      const requiredSamples = required.get(raw.channelId);
      if (requiredSamples === undefined) return failure('Chunk channel is absent from the manifest.', identity);
      if (!nonnegativeInteger(raw.sampleOffset) || !Array.isArray(raw.samples) || raw.samples.length === 0) return failure('Chunk offset or samples are invalid.', identity);
      packetSamples += raw.samples.length;
      if (packetSamples > limits.maxSamplesPerPacket) return failure('Packet sample count exceeds the configured limit.', identity, 'RESOURCE_LIMIT');
      if (raw.sampleOffset + raw.samples.length > requiredSamples) return failure('Chunk extends beyond manifest coverage.', identity);
      if (!raw.samples.every(finite)) return failure('Channel samples must be finite.', identity);
      if (raw.unit !== null && !text(raw.unit, limits.maxIdentifierLength)) return failure('Channel unit must be null or a bounded string.', identity);
      if (!isRecord(raw.timing)) return failure('Channel timing must be an object.', identity);
      const sampleRateHz = raw.timing.sampleRateHz;
      const firstSampleOffsetMs = raw.timing.firstSampleOffsetMs;
      if (sampleRateHz !== null && (!finite(sampleRateHz) || sampleRateHz <= 0)) return failure('Sample rate must be null or positive and finite.', identity);
      if (firstSampleOffsetMs !== null && !finite(firstSampleOffsetMs)) return failure('Sample offset time must be null or finite.', identity);
      chunks.push({ channelId: raw.channelId, sampleOffset: raw.sampleOffset, samples: [...raw.samples], unit: raw.unit, timing: { sampleRateHz, firstSampleOffsetMs } });
    }
    return { ok: true, value: { identity, manifest, packetIndex: input.packetIndex, chunks, receivedAtMs: input.receivedAtMs, acquisitionTime: acquisition.value } };
  } };
}

export type DeviceSource = 'demo' | 'bracelet';
export type PredictionMode = 'mock' | 'real';
export type BloodPressureUnit = 'mmHg';

export interface SourceWindowIdentity { readonly source: DeviceSource; readonly deviceId: string; readonly acquisitionId: string; readonly windowId: string }
export type AcquisitionTime =
  | { readonly kind: 'wall-clock'; readonly timestampMs: number; readonly synchronized: boolean }
  | { readonly kind: 'device-ticks'; readonly ticks: number; readonly ticksPerSecond: number; readonly clockId: string }
  | { readonly kind: 'unavailable' };
export interface ChannelRequirement { readonly channelId: string; readonly sampleCount: number }
export interface WindowManifest { readonly contractVersion: string; readonly packetCount: number; readonly channels: readonly ChannelRequirement[] }
export interface ChannelTiming { readonly sampleRateHz: number | null; readonly firstSampleOffsetMs: number | null }
export interface ChannelChunk { readonly channelId: string; readonly sampleOffset: number; readonly samples: readonly number[]; readonly unit: string | null; readonly timing: ChannelTiming }
export interface SensorPacket { readonly identity: SourceWindowIdentity; readonly manifest: WindowManifest; readonly packetIndex: number; readonly chunks: readonly ChannelChunk[]; readonly receivedAtMs: number; readonly acquisitionTime: AcquisitionTime }
export interface WindowChannel { readonly channelId: string; readonly samples: readonly number[]; readonly unit: string | null; readonly timing: ChannelTiming }
export interface AssemblyDiagnostics { readonly receivedPacketCount: number; readonly identicalDuplicateCount: number }
export interface CompleteSensorWindow { readonly identity: SourceWindowIdentity; readonly manifest: WindowManifest; readonly channels: readonly WindowChannel[]; readonly acquisitionTime: AcquisitionTime; readonly firstReceivedAtMs: number; readonly lastReceivedAtMs: number; readonly diagnostics: AssemblyDiagnostics }
export interface ValidatedSensorWindow { readonly window: CompleteSensorWindow; readonly validationMode: 'demo-structural' | 'model-input'; readonly inputContractVersion: string; readonly validatorVersion: string; readonly validatedAtMs: number }
export interface PredictionProfile { readonly ageYears: number; readonly heightCm: number; readonly weightKg: number; readonly profileContractVersion: string; readonly source: 'synthetic-demo' | 'verified-profile'; readonly validatedAtMs: number }
export interface PredictionProvenance { readonly mode: PredictionMode; readonly implementationVersion: string; readonly modelVersion: string | null; readonly preprocessingVersion: string | null }
export interface BPPrediction { readonly identity: SourceWindowIdentity; readonly systolic: number; readonly diastolic: number; readonly unit: BloodPressureUnit; readonly predictedAtMs: number; readonly provenance: PredictionProvenance }
export interface SavedReading { readonly id: string; readonly sourceWindowKey: string; readonly prediction: BPPrediction; readonly profile: PredictionProfile; readonly validationMode: ValidatedSensorWindow['validationMode']; readonly inputContractVersion: string; readonly validatorVersion: string; readonly acquisitionTime: AcquisitionTime; readonly firstReceivedAtMs: number; readonly lastReceivedAtMs: number; readonly savedAtMs: number }

/** JSON tuple encoding avoids collisions caused by delimiter-concatenated identifiers. */
export function encodeSourceWindowIdentity(identity: SourceWindowIdentity): string {
  return JSON.stringify([identity.source, identity.deviceId, identity.acquisitionId, identity.windowId]);
}

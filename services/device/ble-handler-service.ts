import type { CompleteSensorWindow, SensorPacket } from '../../types/measurement.ts';
import { MeasurementServiceError } from '../measurement/errors.ts';
import type { MeasurementClock } from '../measurement/clock.ts';
import type { PacketValidator } from '../measurement/packet-validation.ts';
import { SensorPacketReassembler } from './packet-reassembler.ts';

export type BleConnectionState = 'disconnected' | 'scanning' | 'connecting' | 'connected' | 'disconnecting' | 'error';
export interface BleDevice { readonly id: string; readonly name: string | null; readonly rssi: number | null }
export interface BleState { readonly connectionState: BleConnectionState; readonly device: BleDevice | null; readonly error: MeasurementServiceError | null }
export type BleEvent = { readonly type: 'state'; readonly state: BleState } | { readonly type: 'window'; readonly window: CompleteSensorWindow } | { readonly type: 'error'; readonly error: MeasurementServiceError };
export interface BlePlatformAdapter {
  readonly scan: (onDevice: (device: BleDevice) => void, signal?: AbortSignal) => Promise<() => Promise<void>>;
  readonly connect: (deviceId: string, onNotification: (bytes: Uint8Array) => void, signal?: AbortSignal) => Promise<void>;
  readonly disconnect: () => Promise<void>;
}
export interface BlePacketDecoder { readonly decode: (notification: Uint8Array) => readonly unknown[] }
export interface BleHandlerService {
  readonly getState: () => BleState;
  readonly subscribe: (listener: (event: BleEvent) => void) => () => void;
  readonly scan: (onDevice: (device: BleDevice) => void, signal?: AbortSignal) => Promise<void>;
  readonly connect: (deviceId: string, signal?: AbortSignal) => Promise<void>;
  readonly disconnect: () => Promise<void>;
}

/** BLE UUID discovery and bytes-to-packet decoding are supplied by hardware-specific adapters. */
export function createBleHandlerService(platform: BlePlatformAdapter, decoder: BlePacketDecoder, validator: PacketValidator, clock: MeasurementClock): BleHandlerService {
  let state: BleState = { connectionState: 'disconnected', device: null, error: null };
  const listeners = new Set<(event: BleEvent) => void>();
  const reassembler = new SensorPacketReassembler();
  let stopScan: (() => Promise<void>) | null = null;
  const publishState = (connectionState: BleConnectionState, device = state.device, error: MeasurementServiceError | null = null) => {
    state = { connectionState, device, error };
    emit({ type: 'state', state });
  };
  const emit = (event: BleEvent) => { for (const listener of listeners) listener(event); };
  const handleNotification = (bytes: Uint8Array) => {
    try {
      for (const decoded of decoder.decode(bytes)) {
        const result = validator.validate(decoded);
        if (!result.ok) { emit({ type: 'error', error: result.error }); continue; }
        const packet: SensorPacket = { ...result.value, receivedAtMs: clock.nowMs() };
        const assembled = reassembler.accept(packet);
        if (assembled.status === 'complete') emit({ type: 'window', window: assembled.window });
      }
    } catch (error) {
      const serviceError = error instanceof MeasurementServiceError ? error : new MeasurementServiceError({ stage: 'decode', code: 'INVALID_PACKET', message: 'Could not decode or reassemble BLE notification.', retryable: false, cause: error });
      emit({ type: 'error', error: serviceError });
    }
  };
  return {
    getState: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async scan(onDevice, signal) {
      if (stopScan) await stopScan();
      publishState('scanning');
      try { stopScan = await platform.scan(onDevice, signal); }
      catch (error) { const e = new MeasurementServiceError({ stage: 'connection', code: 'DEVICE_UNAVAILABLE', message: 'BLE scan failed.', retryable: true, cause: error }); publishState('error', null, e); emit({ type: 'error', error: e }); throw e; }
    },
    async connect(deviceId, signal) {
      if (!deviceId.trim()) throw new MeasurementServiceError({ stage: 'connection', code: 'INVALID_PACKET', message: 'Device ID is required.', retryable: false });
      if (stopScan) { await stopScan(); stopScan = null; }
      const device = { id: deviceId, name: null, rssi: null };
      publishState('connecting', device);
      try { await platform.connect(deviceId, handleNotification, signal); publishState('connected', device); }
      catch (error) { const e = new MeasurementServiceError({ stage: 'connection', code: 'DEVICE_UNAVAILABLE', message: 'BLE connection failed.', retryable: true, cause: error }); publishState('error', device, e); emit({ type: 'error', error: e }); throw e; }
    },
    async disconnect() {
      publishState('disconnecting');
      try { await platform.disconnect(); reassembler.reset(); publishState('disconnected', null); }
      catch (error) { const e = new MeasurementServiceError({ stage: 'connection', code: 'DEVICE_UNAVAILABLE', message: 'BLE disconnect failed.', retryable: true, cause: error }); publishState('error', state.device, e); emit({ type: 'error', error: e }); throw e; }
    },
  };
}

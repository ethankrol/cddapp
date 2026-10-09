import type { SensorRecording } from './recordingCore';
import type { SerialRecording } from './serialCsv';
export async function pickRecording(): Promise<SensorRecording | SerialRecording | null> {
  throw new Error('Use the installed iPhone app to choose a recording file, to inspect CSV or JSON.');
}

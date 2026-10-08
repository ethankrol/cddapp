import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import { MAX_FILE_BYTES, type SensorRecording } from './recordingCore';
import {parseRecordingFile, type SerialRecording} from './serialCsv';
export async function pickRecording(): Promise<SensorRecording | SerialRecording | null> {
  const result = await DocumentPicker.getDocumentAsync({type: '*/*', copyToCacheDirectory: true, multiple: false});
  if (result.canceled) return null;
  const asset = result.assets[0];
  const file = new File(asset.uri);
  // Delete only the temporary copy made inside this app's cache, never the user's original document.
  const cached = file.uri.startsWith(Paths.cache.uri.endsWith('/') ? Paths.cache.uri : Paths.cache.uri + '/');
  if (!cached) throw new Error('The picker did not provide an app-cache copy. Import cancelled to preserve the original file.');
  try {
    if (!file.exists || file.size > MAX_FILE_BYTES || (asset.size ?? 0) > MAX_FILE_BYTES) throw new Error('Choose a recording CSV or JSON file no larger than 4 MiB.');
    return parseRecordingFile(await file.text());
  } finally {
    if (file.exists) file.delete();
  }
}

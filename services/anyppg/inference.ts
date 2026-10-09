import type {SerialRecording} from '../recordings/serialCsv';
import type {CsvReport} from './core';
export async function inferCsv(_recording:SerialRecording,_shouldCancel:()=>boolean,_onProgress:(done:number,total:number)=>void):Promise<CsvReport> {
  throw new Error('CSV inference needs the installed native app with ONNX Runtime. Use the iPhone Release build.');
}

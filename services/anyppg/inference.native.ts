import {Asset} from 'expo-asset';
import {Platform} from 'react-native';
import {runRecording, type CsvReport} from './core';
import {createAdapter} from './ort';
import type {SerialRecording} from '../recordings/serialCsv';
const head=require('../../assets/models/anyppg/ridge_head.json');
const manifest=require('../../assets/models/anyppg/manifest.json');
export async function inferCsv(recording:SerialRecording,shouldCancel:()=>boolean,onProgress:(done:number,total:number)=>void):Promise<CsvReport> {
  const report=await runRecording({recording,head,manifest,shouldCancel,onProgress,createAdapter:async()=>{
    // Metro requires a static asset path for the native model.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const asset=Asset.fromModule(require('../../assets/models/anyppg/anyppg_encoder.onnx'));
    await asset.downloadAsync();
    if(!asset.localUri)throw new Error('Bundled AnyPPG model is unavailable. Rebuild the Release app.');
    return createAdapter({ort:await import('onnxruntime-react-native'),uri:asset.localUri});
  }});
  return {...report,platform:Platform.OS,osVersion:String(Platform.Version),developmentBuild:__DEV__,onnxRuntimeVersion:'1.24.3',executionLocation:'native_app'};
}

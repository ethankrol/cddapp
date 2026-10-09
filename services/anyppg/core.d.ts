import type {SerialRecording} from '../recordings/serialCsv';
export type Head={model:string;feature_mean:number[];feature_std:number[];coefficients:number[][];target_mean:number[]};
export type Manifest={modelId:string;modelSha256:string;headSha256:string};
export type WindowResult={channel:string;startSeconds:number;lastSampleSeconds:number;sbp:number;dbp:number;inferenceMs:number};
export type CsvReport={schemaVersion:number;modelId:string;experimental:true;complete:true;windows:WindowResult[];sourceRows:number;sourceDurationSeconds:number;maxLoggedGapMs:number;totalWallMs:number;sensorSite:string;modelSha256:string;headSha256:string;[key:string]:unknown};
export type Adapter={run:(chunks:Float32Array)=>Promise<{features:Float32Array;inferenceMs:number}>;release:()=>Promise<void>};
export function standardizeWindow(window:Float64Array|number[]):Float32Array;
export function applyHead(features:Float32Array|number[],head:Head):number[];
export function runRecording(args:{recording:SerialRecording;head:Head;manifest:Manifest;createAdapter:()=>Promise<Adapter>;shouldCancel?:()=>boolean;onProgress?:(done:number,total:number)=>void;now?:()=>number}):Promise<CsvReport>;

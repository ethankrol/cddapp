import type {Adapter} from './core';
export function createAdapter(options:{ort:typeof import('onnxruntime-react-native');uri:string;now?:()=>number}):Promise<Adapter>;

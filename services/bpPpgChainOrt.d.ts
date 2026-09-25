import type { ChainAdapter } from './bpPpgChainCore';
export function createOrtAdapter(options: {
  loadOrt(): Promise<typeof import('onnxruntime-react-native')>;
  resolveModel(): Promise<string>; now(): number;
}): Promise<ChainAdapter>;

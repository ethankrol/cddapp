import { Asset } from 'expo-asset';
import { runChain, type PpgChainReport } from './bpPpgChainCore';
import { createOrtAdapter } from './bpPpgChainOrt';

const fixture = require('../assets/ppg-reference/synthetic_ppg_reference.json');
const reference = require('../assets/ppg-chain/raw_ppg_chain_reference_v1.json');
const normalization = require('../assets/models/onnx_export/normalization.json');
const provenance = require('../assets/ppg-chain/provenance.json');

export async function runPpgChain(shouldCancel: () => boolean): Promise<PpgChainReport> {
  const result = await runChain({ fixture, reference, normalization, shouldCancel,
    createAdapter: () => createOrtAdapter({
      loadOrt: () => import('onnxruntime-react-native'),
      resolveModel: async () => {
        const asset = Asset.fromModule(require('../assets/models/onnx_export/cbp_tnet.onnx'));
        await asset.downloadAsync();
        if (!asset.localUri) throw new Error('The bundled model has no local URI.');
        return asset.localUri;
      },
      now: () => performance.now(),
    }),
  });
  return { ...result, provenance, modelSha256: reference.sourceHashes.model,
    referenceSha256: provenance.referenceSha256, onnxRuntimeVersion: '1.24.3',
    referenceOnnxRuntimeVersion: reference.runtime.onnxruntime,
    executionProvider: 'cpu', threads: 1 };
}

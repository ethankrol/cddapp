import { Asset } from 'expo-asset';
import { createOrtAdapter } from './bpPpgChainOrt';
import { runExpanded, type ExpandedMode, type ExpandedReport, type Progress } from './bpExpandedCore';
export async function runExpandedPhone(mode: ExpandedMode, durationSeconds: number,
  shouldCancel: () => boolean, onProgress: (value: Progress) => void): Promise<ExpandedReport> {
  const reference = require('../assets/ppg-expanded/full_ppg_reference_v1.json');
  const provenance = require('../assets/ppg-expanded/install-provenance.json');
  const result = await runExpanded({reference, mode, durationSeconds, shouldCancel, onProgress,
    createAdapter: () => createOrtAdapter({
      loadOrt: () => import('onnxruntime-react-native'),
      resolveModel: async () => {
        const asset = Asset.fromModule(require('../assets/models/onnx_export/cbp_tnet.onnx'));
        await asset.downloadAsync();
        if (!asset.localUri) throw new Error('The bundled ONNX file has no local URI.');
        return asset.localUri;
      }, now: () => performance.now(),
    }),
  });
  return {...result, provenance, onnxRuntimeVersion:'1.24.3', executionProvider:'cpu',threads:1,
    referenceOnnxRuntimeVersion:reference.onnxRuntimeVersion,
    sourceDigestVerification:'Installer checked hashes. Bundled identifiers are not runtime attestation.'};
}

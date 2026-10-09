import { Asset } from 'expo-asset';
import type { BpSmokeResult } from './bpSmokeTest.types';
import type { InferenceSession } from 'onnxruntime-react-native';

const fixture = require('../assets/models/onnx_export/synthetic_model_smoke_test.json');
const report = require('../assets/models/onnx_export/export_report.json');
let pendingSession: Promise<InferenceSession> | undefined;

function values(value: unknown, count: number, name: string): Float32Array {
  if (!Array.isArray(value) || value.length !== count ||
      !value.every(v => typeof v === 'number' && Number.isFinite(v))) {
    throw new Error('Invalid synthetic test input: ' + name);
  }
  return Float32Array.from(value);
}

function validateFixture() {
  if (fixture.mock !== true || fixture.input_stage !== 'normalized_model_inputs' ||
      fixture.dtype !== 'float32' || report.conversion_parity_passed !== true ||
      JSON.stringify(fixture.inputs?.beat?.shape) !== '[1,3,250]' ||
      JSON.stringify(fixture.inputs?.timing?.shape) !== '[1,2]' ||
      JSON.stringify(fixture.expected_output?.order) !== '["SBP","DBP"]' ||
      JSON.stringify(fixture.expected_output?.shape) !== '[1,2]' ||
      fixture.expected_output?.name !== 'bp' ||
      fixture.comparison_absolute_tolerance_mmhg !== 0.01) {
    throw new Error('The exported smoke-test package does not match the model interface.');
  }
  return {
    beat: values(fixture.inputs.beat.data, 750, 'beat'),
    timing: values(fixture.inputs.timing.data, 2, 'timing'),
    expected: values(fixture.expected_output.data, 2, 'expected output'),
  };
}

export async function runBpSmokeTest(): Promise<BpSmokeResult> {
  const input = validateFixture();
  let ort: typeof import('onnxruntime-react-native');
  try {
    ort = await import('onnxruntime-react-native');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error('ONNX Runtime could not load. Open the iOS development build, then try again. Expo Go cannot run this test. ' + detail);
  }
  if (!pendingSession) {
    pendingSession = (async () => {
      const asset = Asset.fromModule(require('../assets/models/onnx_export/cbp_tnet.onnx'));
      await asset.downloadAsync();
      if (!asset.localUri) throw new Error('The model could not be downloaded to the phone.');
      const session = await ort.InferenceSession.create(asset.localUri, {
        executionProviders: ['cpu'],
        intraOpNumThreads: 1,
        interOpNumThreads: 1,
      });
      if (JSON.stringify(session.inputNames) !== '["beat","timing"]' ||
          JSON.stringify(session.outputNames) !== '["bp"]') {
        await session.release();
        throw new Error('Model input/output names do not match the exported package.');
      }
      return session;
    })();
    pendingSession.catch(() => { pendingSession = undefined; });
  }
  const session = await pendingSession;
  const beat = new ort.Tensor('float32', input.beat, [1, 3, 250]);
  const timing = new ort.Tensor('float32', input.timing, [1, 2]);
  let outputs: InferenceSession.ReturnType | undefined;
  try {
    const start = performance.now();
    outputs = await session.run({ beat, timing });
    const elapsed = performance.now() - start;
    const output = outputs.bp;
    if (!output || output.type !== 'float32' || JSON.stringify(output.dims) !== '[1,2]') {
      throw new Error('Model returned an unexpected output tensor.');
    }
    const systolic = Number(output.data[0]);
    const diastolic = Number(output.data[1]);
    if (!Number.isFinite(systolic) || !Number.isFinite(diastolic)) {
      throw new Error('Model returned a nonfinite prediction.');
    }
    const systolicDifference = Math.abs(systolic - input.expected[0]);
    const diastolicDifference = Math.abs(diastolic - input.expected[1]);
    return {
      systolic, diastolic,
      expectedSystolic: input.expected[0],
      expectedDiastolic: input.expected[1],
      systolicDifference, diastolicDifference,
      tolerance: 0.01,
      passed: systolicDifference <= 0.01 && diastolicDifference <= 0.01,
      inferenceMs: elapsed,
      pairingVerified: report.cache_checkpoint_pairing_verified === true,
    };
  } finally {
    beat.dispose();
    timing.dispose();
    if (outputs) Object.values(outputs).forEach(tensor => tensor.dispose());
  }
}

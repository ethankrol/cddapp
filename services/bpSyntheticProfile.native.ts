import { Asset } from 'expo-asset';
import { Platform } from 'react-native';
import type { InferenceSession } from 'onnxruntime-react-native';
import { summarizeLatency } from './bpProfileStats';
import type { ProfileOptions, SyntheticProfile } from './bpSyntheticProfile.types';

const fixture = require('../assets/models/onnx_export/synthetic_model_smoke_test.json');
const metadata = require('./bpSyntheticProfile.install.json');
let running = false;

function finiteArray(value: unknown, length: number): Float32Array {
  if (!Array.isArray(value) || value.length !== length ||
      !value.every(v => typeof v === 'number' && Number.isFinite(v))) {
    throw new Error('Synthetic fixture contains invalid numeric data.');
  }
  return Float32Array.from(value);
}

export async function runBpSyntheticProfile(options: ProfileOptions): Promise<SyntheticProfile> {
  if (running) throw new Error('A synthetic benchmark is already running.');
  if (Platform.OS !== 'ios') throw new Error('This profiling protocol is for a physical iPhone.');
  if (fixture.mock !== true || fixture.dtype !== 'float32' ||
      fixture.input_stage !== 'normalized_model_inputs' ||
      JSON.stringify(fixture.inputs?.beat?.shape) !== '[1,3,250]' ||
      JSON.stringify(fixture.inputs?.timing?.shape) !== '[1,2]' ||
      JSON.stringify(fixture.expected_output?.shape) !== '[1,2]' ||
      JSON.stringify(fixture.expected_output?.order) !== '["SBP","DBP"]' ||
      fixture.expected_output?.name !== 'bp' || fixture.comparison_absolute_tolerance_mmhg !== 0.01) {
    throw new Error('Original synthetic fixture contract failed.');
  }
  const beatData = finiteArray(fixture.inputs.beat.data, 750);
  const timingData = finiteArray(fixture.inputs.timing.data, 2);
  const expected = finiteArray(fixture.expected_output.data, 2);
  running = true;
  const started = performance.now();
  let session: InferenceSession | undefined;
  const result: SyntheticProfile = {
    schemaVersion: 1, synthetic: true, startedAt: new Date().toISOString(), finishedAt: '',
    platform: Platform.OS, osVersion: String(Platform.Version), developmentBuild: __DEV__,
    modelSha256: metadata.onnxSha256, fixtureSha256: metadata.fixtureSha256,
    onnxRuntimeVersion: metadata.onnxRuntimeVersion,
    inputStage: 'normalized_model_inputs', executionProvider: 'cpu', threads: 1,
    plannedWarmup: 10, plannedMeasured: 100, attempted: 0, successful: 0,
    parityFailures: 0, runtimeFailures: 0, complete: false, passed: false,
    failure: null, cancelled: false, importMs: null, assetResolveMs: null,
    sessionCreateMs: null, firstInferenceMs: null, firstResultWallMs: null, releaseMs: null,
    totalWallMs: 0, inferenceMs: [], latency: null,
    maxDifferenceMmhg: { SBP: 0, DBP: 0 }, toleranceMmhg: 0.01,
    memoryMeasured: false, energyMeasured: false, freshSession: true, osCacheState: 'uncontrolled',
  };
  try {
    options.onProgress('Resolving runtime and model asset…');
    let start = performance.now();
    const ort = await import('onnxruntime-react-native');
    result.importMs = performance.now() - start;
    start = performance.now();
    const asset = Asset.fromModule(require('../assets/models/onnx_export/cbp_tnet.onnx'));
    await asset.downloadAsync();
    result.assetResolveMs = performance.now() - start;
    if (!asset.localUri) throw new Error('Model asset has no local URI.');
    if (options.shouldStop()) { result.cancelled = true; return result; }
    options.onProgress('Creating a fresh ONNX session…');
    start = performance.now();
    session = await ort.InferenceSession.create(asset.localUri, {
      executionProviders: ['cpu'], intraOpNumThreads: 1, interOpNumThreads: 1,
    });
    result.sessionCreateMs = performance.now() - start;
    if (JSON.stringify(session.inputNames) !== '["beat","timing"]' ||
        JSON.stringify(session.outputNames) !== '["bp"]') throw new Error('Model interface differs.');
    const benchmarkStart = performance.now();
    const total = 1 + result.plannedWarmup + result.plannedMeasured;
    for (let index = 0; index < total; index++) {
      if (options.shouldStop()) { result.cancelled = true; break; }
      if (performance.now() - benchmarkStart > 60000) {
        result.failure = 'Stopped at the 60-second inference-loop budget.';
        break;
      }
      const phase = index === 0 ? 'First call' : index <= 10 ? 'Warm-up' : 'Measured calls';
      if (index === 0 || index % 10 === 0) options.onProgress(`${phase}: ${index}/${total}`);
      const beat = new ort.Tensor('float32', beatData, [1, 3, 250]);
      const timing = new ort.Tensor('float32', timingData, [1, 2]);
      let outputs: InferenceSession.ReturnType | undefined;
      try {
        result.attempted++;
        start = performance.now();
        outputs = await session.run({ beat, timing });
        const elapsed = performance.now() - start;
        if (!Number.isFinite(elapsed) || elapsed < 0) throw new Error('Invalid monotonic clock result.');
        const output = outputs.bp;
        if (!output || output.type !== 'float32' || JSON.stringify(output.dims) !== '[1,2]') {
          throw new Error('Unexpected output tensor shape or type.');
        }
        const sbp = Number(output.data[0]); const dbp = Number(output.data[1]);
        if (!Number.isFinite(sbp) || !Number.isFinite(dbp)) throw new Error('Nonfinite model output.');
        const sd = Math.abs(sbp - expected[0]); const dd = Math.abs(dbp - expected[1]);
        result.maxDifferenceMmhg.SBP = Math.max(result.maxDifferenceMmhg.SBP, sd);
        result.maxDifferenceMmhg.DBP = Math.max(result.maxDifferenceMmhg.DBP, dd);
        if (sd > 0.01 || dd > 0.01) {
          result.parityFailures++;
          result.failure = `Python parity failed at call ${index + 1}: SBP difference=${sd}, DBP difference=${dd}.`;
          break;
        }
        result.successful++;
        if (index === 0) {
          result.firstInferenceMs = elapsed;
          result.firstResultWallMs = performance.now() - started;
        } else if (index > result.plannedWarmup) result.inferenceMs.push(elapsed);
      } finally {
        beat.dispose(); timing.dispose();
        if (outputs) Object.values(outputs).forEach(tensor => tensor.dispose());
      }
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    result.complete = result.successful === total;
    result.passed = result.complete && result.parityFailures === 0;
  } catch (error) {
    result.runtimeFailures++;
    result.failure = error instanceof Error ? error.message : String(error);
  } finally {
    if (session) {
      const start = performance.now();
      try { await session.release(); }
      catch (error) {
        result.runtimeFailures++;
        result.passed = false;
        result.failure = `${result.failure || ''} Session release failed: ${String(error)}`.trim();
      }
      result.releaseMs = performance.now() - start;
    }
    if (result.inferenceMs.length) result.latency = summarizeLatency(result.inferenceMs);
    result.finishedAt = new Date().toISOString();
    result.totalWallMs = performance.now() - started;
    running = false;
  }
  return result;
}

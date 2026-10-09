'use strict';
// Runtime adapter shared by the native wrapper and deterministic lifecycle tests.
const fail = message => { throw new Error(message); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function createOrtAdapter({loadOrt, resolveModel, now}) {
  const t0 = now(), ort = await loadOrt(), importMs = now() - t0;
  const t1 = now(), uri = await resolveModel(), assetResolveMs = now() - t1;
  if (typeof uri !== 'string' || !uri) fail('No local ONNX model URI.');
  const t2 = now();
  const session = await ort.InferenceSession.create(uri, {
    executionProviders: ['cpu'], intraOpNumThreads: 1, interOpNumThreads: 1,
  });
  const sessionCreateMs = now() - t2;
  if (!same(session.inputNames, ['beat', 'timing']) || !same(session.outputNames, ['bp'])) {
    try { await session.release(); }
    catch (error) { fail('Model interface mismatch; session release also failed: ' + String(error)); }
    fail('Model input/output names differ from the original export.');
  }
  let released = false;
  return {
    timings: {importMs, assetResolveMs, sessionCreateMs},
    async run(beat, timing) {
      if (released) fail('Inference session is already released.');
      if (!(beat instanceof Float32Array) || beat.length !== 750 ||
          !(timing instanceof Float32Array) || timing.length !== 2) fail('Unexpected model input buffers.');
      let x, p, outputs, result, runError;
      try {
        x = new ort.Tensor('float32', beat, [1, 3, 250]);
        p = new ort.Tensor('float32', timing, [1, 2]);
        const start = now();
        outputs = await session.run({beat: x, timing: p});
        const inferenceMs = now() - start;
        const output = outputs.bp;
        if (!output || output.type !== 'float32' || !same(output.dims, [1, 2]) ||
            output.data.length !== 2) fail('Unexpected ONNX output tensor.');
        const values = [Number(output.data[0]), Number(output.data[1])];
        if (!values.every(v => Number.isFinite(v) && Math.fround(v) === v)) fail('Nonfinite/invalid ONNX outputs.');
        result = {values, inferenceMs};
      } catch (error) { runError = error; }
      const cleanupErrors = [];
      for (const tensor of new Set([x, p, ...Object.values(outputs || {})])) {
        if (tensor) try { tensor.dispose(); } catch (error) { cleanupErrors.push(String(error)); }
      }
      if (runError || cleanupErrors.length) fail([
        runError ? String(runError) : '',
        cleanupErrors.length ? 'Tensor cleanup failed: ' + cleanupErrors.join('; ') : '',
      ].filter(Boolean).join('; '));
      return result;
    },
    async release() { if (!released) { released = true; await session.release(); } },
  };
}
module.exports = { createOrtAdapter };

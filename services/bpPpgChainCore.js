'use strict';
// Synthetic software verification. Derive every model input from raw PPG;
// reference tensors are comparison oracles only, never inference feeds.
const ppg = require('./bpPpgPreprocess');
const f = Math.fround;
const requireValue = (ok, message) => { if (!ok) throw new Error(message); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clock = () => typeof performance !== 'undefined' ? performance.now() : Date.now();
const IDS = Object.freeze({
  model: 'a8e26e25b852344814e4a474e73e92b9f8d40845c20948fdcce828c9e4f12fce',
  checkpoint: '2cabfe0c64bf2463495d9581dea837638c41c149948abd9730b8b6be25fd0169',
  ppgFixture: 'db0eae6bdc76c8ce73a3c03e9476356f9eb9e9db25ee39a0bc6836c7a89461f0',
  normalization: 'bc8a28b7ca84faa00644fa7d13ae706705ecd47b9543296753273555be3aba41',
});
function finite32(v) { return typeof v === 'number' && Number.isFinite(v) && f(v) === v; }
function matrix(value, rows, cols, label) {
  requireValue(Array.isArray(value) && value.length === rows && value.every(row =>
    Array.isArray(row) && row.length === cols && row.every(finite32)), 'Invalid ' + label);
}
function validate(fixture, reference, normalization) {
  ppg.validateFixture(fixture);
  const r = reference, n = normalization;
  requireValue(r && r.schemaVersion === 1 && r.test === 'cdd_raw_ppg_chain_reference' &&
    r.synthetic === true && r.contract === ppg.CONTRACT && r.inputStage === 'raw_ppg' &&
    r.outputStage === 'uncalibrated_model_outputs' && r.candidateCount === 31 &&
    r.candidatesReferenced === 4 && r.normalizationEpsilonAdded === false &&
    r.timingMaskApplied === false && r.calibrationApplied === false && r.aggregationApplied === false,
    'Unexpected connected-test reference contract.');
  requireValue(r.sourceHashes?.model === IDS.model && r.sourceHashes?.ppg_fixture === IDS.ppgFixture &&
    r.sourceHashes?.normalization === IDS.normalization, 'Reference model/fixture identity mismatch.');
  requireValue(same(r.intervals, fixture.first_four_intervals) && fixture.candidate_count === 31 &&
    same(r.normalizedBeatShape, [4, 3, 250]) && same(r.normalizedTimingShape, [4, 2]) &&
    same(r.expectedOutputShape, [4, 2]) && same(r.outputOrder, ['SBP', 'DBP']) && r.outputUnits === 'mmHg' &&
    r.tolerances?.normalizedAbsolute === 1e-6 && r.tolerances?.outputAbsoluteMmhg === 0.01,
    'Reference shapes, intervals or tolerances do not match.');
  requireValue(Array.isArray(r.normalizedBeats) && r.normalizedBeats.length === 4, 'Expected four reference beats.');
  r.normalizedBeats.forEach(beat => matrix(beat, 3, 250, 'normalized beat'));
  matrix(r.normalizedTiming, 4, 2, 'normalized timing'); matrix(r.expectedOutputs, 4, 2, 'expected outputs');
  requireValue(n && n.schema_version === 1 && n.sampling_rate_hz === 125 && n.samples_per_beat === 250 &&
    n.model_sha256 === IDS.checkpoint && same(n.channel_order, ['PPG', 'dPPG', 'd2PPG']) &&
    same(n.timing_feature_order, ['scaled_upstroke_time', 'scaled_beat_interval']) &&
    same(n.output_order, ['SBP', 'DBP']) && n.output_units === 'mmHg', 'Unexpected saved normalization contract.');
  for (const [key, size] of [['channel_mean', 3], ['channel_std', 3], ['timing_mean', 2], ['timing_std', 2]]) {
    requireValue(Array.isArray(n[key]) && n[key].length === size && n[key].every(finite32) &&
      same(n[key], r.normalization[key]), 'Normalization differs from reference: ' + key);
    if (key.endsWith('_std')) requireValue(n[key].every(v => v > 0), 'Nonpositive standard deviation.');
  }
}
function normalizeValue(value, mean, std) {
  const normalized = f(f(f(value) - f(mean)) / f(std));
  requireValue(Number.isFinite(normalized), 'Nonfinite normalized value.');
  return normalized;
}
function prepareInputs(fixture, reference, normalization, now = clock) {
  validate(fixture, reference, normalization);
  const t0 = now(), derived = ppg.extractPpg(fixture.raw_ppg, fixture.sampling_rate_hz);
  const preprocessingMs = now() - t0;
  requireValue(derived.beats.length >= 4, 'Fewer than four candidates.');
  let wave = 0, timing = 0;
  for (let b = 0; b < 4; b++) {
    for (let c = 0; c < 3; c++) for (let j = 0; j < 250; j++) {
      wave = Math.max(wave, Math.abs(derived.beats[b][c][j] - fixture.first_four_beats[b][c][j]));
    }
    for (let j = 0; j < 2; j++) timing = Math.max(timing,
      Math.abs(derived.timing[b][j] - fixture.first_four_timing[b][j]));
  }
  const preprocessing = { passed: derived.beats.length === 31 &&
    same(derived.intervals.slice(0, 4), reference.intervals) && wave <= 1e-6 && timing <= 1e-7,
    candidateCount: derived.beats.length, expectedCandidateCount: 31,
    candidatesNumericallyChecked: 4, channelValuesChecked: 3000, timingValuesChecked: 8,
    intervalsMatch: same(derived.intervals.slice(0, 4), reference.intervals),
    maxWaveDifference: wave, maxTimingDifference: timing,
    peakCount: derived.peaks.length, selectedScaleIndex: derived.selectedScaleIndex,
    preprocessingMs, exactMatch: wave === 0 && timing === 0 };
  if (!preprocessing.passed) return { preprocessing, normalization: null, beats: [], timing: [] };
  const t1 = now(), beats = [], times = [];
  const n = normalization;
  for (let b = 0; b < 4; b++) {
    const beat = new Float32Array(750), time = new Float32Array(2);
    for (let c = 0; c < 3; c++) for (let j = 0; j < 250; j++) {
      beat[c * 250 + j] = normalizeValue(derived.beats[b][c][j], n.channel_mean[c], n.channel_std[c]);
    }
    for (let j = 0; j < 2; j++) time[j] = normalizeValue(derived.timing[b][j], n.timing_mean[j], n.timing_std[j]);
    beats.push(beat); times.push(time);
  }
  const normalizationMs = now() - t1;
  let beatDifference = 0, timingDifference = 0;
  for (let b = 0; b < 4; b++) {
    for (let c = 0; c < 3; c++) for (let j = 0; j < 250; j++) beatDifference = Math.max(beatDifference,
      Math.abs(beats[b][c * 250 + j] - reference.normalizedBeats[b][c][j]));
    for (let j = 0; j < 2; j++) timingDifference = Math.max(timingDifference,
      Math.abs(times[b][j] - reference.normalizedTiming[b][j]));
  }
  return { preprocessing, beats, timing: times, normalization: {
    passed: beatDifference <= 1e-6 && timingDifference <= 1e-6,
    channelValuesChecked: 3000, timingValuesChecked: 8,
    maxBeatDifference: beatDifference, maxTimingDifference: timingDifference,
    exactMatch: beatDifference === 0 && timingDifference === 0,
    absoluteTolerance: 1e-6, normalizationMs, timingMaskApplied: false, paddedValuesStandardized: true } };
}
async function runChain({fixture, reference, normalization, createAdapter, shouldCancel = () => false, now = clock}) {
  const start = now(); let adapter, phase = 'validation';
  const report = { schemaVersion: 1, test: 'cdd_raw_ppg_chain', synthetic: true,
    startedAt: new Date().toISOString(), finishedAt: null, contract: ppg.CONTRACT,
    inputStage: 'raw_ppg', outputStage: 'uncalibrated_model_outputs',
    rawSampleCount: 3750, samplingRateHz: 125, candidatesPlanned: 4,
    complete: false, passed: false, cancelled: false, failure: null, cleanupFailure: null,
    preprocessing: null, normalization: null, modelInferenceRun: false,
    attempted: 0, successful: 0, parityFailures: 0, runtimeFailures: 0,
    outputOrder: ['SBP', 'DBP'], outputUnits: 'mmHg', outputToleranceMmhg: 0.01,
    outputs: [], maxDifferenceMmhg: null, inferenceMs: [],
    adapterTimings: null, releaseMs: null, sessionReleased: false,
    normalizationApplied: false, calibrationApplied: false, aggregationApplied: false,
    qualityValidated: false, bpAccuracyEvaluated: false, memoryMeasured: false, energyMeasured: false,
    appColdLaunchMeasured: false, osCacheState: 'uncontrolled', freshSession: true,
    referenceMethod: 'Python preprocessing + NumPy normalization + Python ONNX Runtime CPU',
    sourceDigestVerification: 'Installer verified asset/source hashes; bundled identifiers are not runtime attestation.',
  };
  function cancelCheck() { if (shouldCancel()) { report.cancelled = true; throw new Error('Test cancelled or app left the foreground.'); } }
  try {
    cancelCheck();
    phase = 'preprocessing_or_normalization';
    const prepared = prepareInputs(fixture, reference, normalization, now);
    report.preprocessing = prepared.preprocessing; report.normalization = prepared.normalization;
    report.normalizationApplied = prepared.normalization !== null;
    requireValue(prepared.preprocessing.passed, 'Preprocessing parity failed; inference was not started.');
    requireValue(prepared.normalization?.passed, 'Normalization parity failed; inference was not started.');
    cancelCheck(); phase = 'session_creation';
    adapter = await createAdapter(); report.adapterTimings = adapter.timings || null;
    cancelCheck(); phase = 'inference';
    for (let b = 0; b < 4; b++) {
      cancelCheck(); report.attempted++; report.modelInferenceRun = true;
      const result = await adapter.run(prepared.beats[b], prepared.timing[b]);
      requireValue(Array.isArray(result.values) && result.values.length === 2 && result.values.every(finite32) &&
        Number.isFinite(result.inferenceMs) && result.inferenceMs >= 0, 'Invalid inference result.');
      report.successful++;
      const expected = reference.expectedOutputs[b];
      const difference = result.values.map((v, j) => Math.abs(v - expected[j]));
      const passed = difference.every(v => v <= 0.01);
      if (!passed) report.parityFailures++;
      report.outputs.push({ candidate: b + 1, interval: reference.intervals[b],
        phone: result.values, reference: expected.slice(), differenceMmhg: difference, passed });
      report.inferenceMs.push(result.inferenceMs);
      const old = report.maxDifferenceMmhg || {SBP: 0, DBP: 0};
      report.maxDifferenceMmhg = { SBP: Math.max(old.SBP, difference[0]), DBP: Math.max(old.DBP, difference[1]) };
      cancelCheck();
    }
    report.complete = true;
  } catch (error) {
    report.failure = { phase, message: error instanceof Error ? error.message : String(error) };
    if (phase === 'inference' && !report.cancelled) report.runtimeFailures++;
  } finally {
    if (adapter) {
      const releaseStart = now();
      try { await adapter.release(); report.sessionReleased = true; }
      catch (error) { report.cleanupFailure = error instanceof Error ? error.message : String(error); }
      report.releaseMs = now() - releaseStart;
    }
    if (shouldCancel()) report.cancelled = true;
    report.passed = report.complete && !report.cancelled && !report.failure && !report.cleanupFailure &&
      report.parityFailures === 0 && report.successful === 4 && report.sessionReleased;
    report.totalWallMs = now() - start;
    report.finishedAt = new Date().toISOString();
  }
  return report;
}
module.exports = { IDS, validate, normalizeValue, prepareInputs, runChain };

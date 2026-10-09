'use strict';
// Research preprocessing parity only. No BP prediction, normalization or quality certification.
// Independent JS implementation of the reviewed legacy_ppg_candidates_v1 contract.
const CONTRACT = 'legacy_ppg_candidates_v1';
const f = Math.fround;
const add = (a, b) => f(f(a) + f(b));
const sub = (a, b) => f(f(a) - f(b));
const mul = (a, b) => f(f(a) * f(b));
const div = (a, b) => f(f(a) / f(b));
function requireValue(ok, message) { if (!ok) throw new Error(message); }

function validatePpg(raw, samplingRateHz) {
  requireValue(samplingRateHz === 125, 'This contract requires 125 Hz; no implicit resampling.');
  requireValue((Array.isArray(raw) || raw instanceof Float32Array || raw instanceof Float64Array) &&
    raw.length === 3750, 'Expected one 3750-sample PPG recording.');
  const x = new Float32Array(3750);
  for (let i = 0; i < raw.length; i++) {
    requireValue(typeof raw[i] === 'number' && Number.isFinite(raw[i]), 'PPG contains a nonfinite/non-numeric value.');
    x[i] = raw[i];
    requireValue(Number.isFinite(x[i]), 'PPG overflows float32.');
  }
  return x;
}

function kalmanFloat32(input) {
  const filtered = new Float64Array(input.length);
  let x = 0, p = 1, q = 1e-5, r = 1e-2;
  for (let i = 0; i < input.length; i++) {
    const prior = x;
    // On the first update, P/Q/R are Python scalars (double precision).
    // Once mixed with np.float32 input, NumPy 2.2.6 scalar promotion applies.
    const pp = i === 0 ? p + q : add(p, q);
    const k = i === 0 ? pp / (pp + r) : div(pp, add(pp, r));
    x = add(prior, mul(k, sub(input[i], prior)));
    p = i === 0 ? (1 - k) * pp : mul(sub(1, k), pp);
    filtered[i] = x;
    const residual = sub(input[i], prior);
    const squared = mul(residual, residual);
    q = add(i === 0 ? 0.99 * q : mul(0.99, q), mul(0.01, squared));
    r = add(i === 0 ? 0.99 * r : mul(0.99, r), mul(0.01, squared));
    requireValue(Number.isFinite(x) && Number.isFinite(p) && Number.isFinite(q) && Number.isFinite(r),
      'Nonfinite Kalman state; recording rejected.');
  }
  return filtered;
}

function detrendLinear(input) {
  // Centered least-squares fit. Algebraically the same linear detrend used by
  // SciPy; floating-point reduction order differs. Peak parity is tested.
  const n = input.length, center = (n - 1) / 2;
  let sum = 0, covariance = 0;
  for (let i = 0; i < n; i++) sum += input[i];
  const mean = sum / n;
  for (let i = 0; i < n; i++) covariance += (i - center) * (input[i] - mean);
  const slope = covariance / (n * (n * n - 1) / 12);
  return Float64Array.from(input, (value, i) => value - (mean + slope * (i - center)));
}

function ampdPeaks(input) {
  // Match installed pyampd 0.0.1 find_peaks, including its edge comparisons,
  // weighted scale choice, first-maximum tie rule and exclusive scale slice.
  // No local-scalogram matrix is retained; rows are counted then reevaluated.
  const x = detrendLinear(input), n = x.length, levels = Math.min(125, Math.floor(n / 2));
  let bestIndex = 0, bestWeight = -1;
  function atScale(i, k) {
    return (i + k >= n || x[i] > x[i + k]) && (i < k || x[i] > x[i - k]);
  }
  for (let k = 1; k <= levels; k++) {
    let count = 0;
    for (let i = 0; i < n; i++) if (atScale(i, k)) count++;
    const weight = count * (Math.floor(n / 2) - k + 1);
    if (weight > bestWeight) { bestIndex = k - 1; bestWeight = weight; }
  }
  requireValue(bestIndex > 0, 'AMPD has no usable scale (legacy empty-reduction case).');
  const peaks = [];
  for (let i = 0; i < n; i++) {
    let keep = true;
    for (let k = 1; k <= bestIndex; k++) if (!atScale(i, k)) { keep = false; break; }
    if (keep) peaks.push(i);
  }
  return { peaks, selectedScaleIndex: bestIndex };
}

function gradient(input) {
  requireValue(input.length >= 2, 'Gradient requires at least two samples.');
  const n = input.length, out = new Float64Array(n);
  out[0] = input[1] - input[0]; out[n - 1] = input[n - 1] - input[n - 2];
  for (let i = 1; i < n - 1; i++) out[i] = (input[i + 1] - input[i - 1]) / 2;
  return out;
}

function featuresFromPeaks(filtered, peaks) {
  requireValue(Array.isArray(peaks) && peaks.every((v, i) => Number.isInteger(v) && v >= 0 &&
    v < filtered.length && (i === 0 || v > peaks[i - 1])), 'Invalid peak indices.');
  const beats = [], timing = [], intervals = [];
  let shortIntervalsRejected = 0;
  for (let i = 2; i < peaks.length; i++) {
    const start = peaks[i - 1], end = peaks[i];
    if (end - start < 10) { shortIntervalsRejected++; continue; }
    const segment = filtered.slice(start, end), d1 = gradient(segment), d2 = gradient(d1);
    const channels = [segment, d1, d2].map(channel => {
      const out = new Float32Array(250);
      for (let j = 0; j < Math.min(channel.length, 250); j++) out[j] = channel[j];
      return out;
    });
    let maximum = 0;
    for (let j = 1; j < segment.length; j++) if (segment[j] > segment[maximum]) maximum = j;
    beats.push(channels);
    timing.push(Float32Array.of(f(Math.min(3, Math.max(0, (maximum / 125) / 0.15))),
      f(Math.min(3, Math.max(0, ((end - start) / 125) / 1.2)))));
    intervals.push([start, end]);
  }
  return { beats, timing, intervals, shortIntervalsRejected };
}

function extractPpg(raw, samplingRateHz = 125) {
  const filtered = kalmanFloat32(validatePpg(raw, samplingRateHz));
  const detection = ampdPeaks(filtered);
  return { contract: CONTRACT, stage: 'unnormalized_features', samplingRateHz,
    ...featuresFromPeaks(filtered, detection.peaks), peaks: detection.peaks,
    selectedScaleIndex: detection.selectedScaleIndex };
}

const FIXTURE_TOLERANCES = Object.freeze({ waveAbsolute: 1e-6, timingAbsolute: 1e-7 });
function validateFixture(fixture) {
  requireValue(fixture && fixture.schema_version === 1 && fixture.synthetic === true &&
    fixture.contract === CONTRACT && fixture.stage === 'unnormalized_features' &&
    fixture.sampling_rate_hz === 125 && Number.isInteger(fixture.candidate_count) &&
    fixture.candidate_count >= 4, 'Unexpected synthetic fixture contract.');
  validatePpg(fixture.raw_ppg, 125);
  const list = fixture.first_four_intervals;
  requireValue(Array.isArray(list) && list.length === 4 && list.every((v, i) =>
    Array.isArray(v) && v.length === 2 && v.every(Number.isInteger) && v[0] >= 0 && v[1] < 3750 &&
    v[1] - v[0] >= 10 && (i === 0 || v[0] >= list[i - 1][1])), 'Invalid reference intervals.');
  for (const [values, channels, length] of [[fixture.first_four_beats, 3, 250], [fixture.first_four_timing, 1, 2]]) {
    requireValue(Array.isArray(values) && values.length === 4, 'Expected four reference candidates.');
    for (const candidate of values) {
      const rows = channels === 1 ? [candidate] : candidate;
      requireValue(Array.isArray(rows) && rows.length === channels && rows.every(row =>
        Array.isArray(row) && row.length === length && row.every(v => typeof v === 'number' &&
          Number.isFinite(v) && f(v) === v)), 'Reference features must be finite float32 values.');
    }
  }
}

function runFixture(fixture) {
  validateFixture(fixture);
  const clock = () => typeof performance !== 'undefined' ? performance.now() : Date.now();
  const start = clock(), result = extractPpg(fixture.raw_ppg), elapsedMs = clock() - start;
  const candidateCountMatches = result.beats.length === fixture.candidate_count;
  const intervalsMatch = JSON.stringify(result.intervals.slice(0, 4)) === JSON.stringify(fixture.first_four_intervals);
  let maxWaveDifference = 0, maxTimingDifference = 0;
  if (result.beats.length < 4) throw new Error('Fewer than four candidates were produced.');
  for (let b = 0; b < 4; b++) {
    for (let c = 0; c < 3; c++) for (let j = 0; j < 250; j++) {
      maxWaveDifference = Math.max(maxWaveDifference, Math.abs(result.beats[b][c][j] - fixture.first_four_beats[b][c][j]));
    }
    for (let j = 0; j < 2; j++) maxTimingDifference = Math.max(maxTimingDifference,
      Math.abs(result.timing[b][j] - fixture.first_four_timing[b][j]));
  }
  const passed = candidateCountMatches && intervalsMatch && Number.isFinite(maxWaveDifference) &&
    Number.isFinite(maxTimingDifference) && maxWaveDifference <= FIXTURE_TOLERANCES.waveAbsolute &&
    maxTimingDifference <= FIXTURE_TOLERANCES.timingAbsolute;
  return { schemaVersion: 1, test: 'cdd_raw_ppg_preprocessing', synthetic: true,
    contract: CONTRACT, inputStage: 'raw_ppg', outputStage: 'unnormalized_features',
    rawSampleCount: 3750, samplingRateHz: 125, candidateCount: result.beats.length,
    expectedCandidateCount: fixture.candidate_count, candidatesNumericallyChecked: 4,
    channelValuesChecked: 3000, timingValuesChecked: 8, candidateCountMatches, intervalsMatch,
    maxWaveDifference, maxTimingDifference, tolerances: FIXTURE_TOLERANCES,
    exactMatch: passed && maxWaveDifference === 0 && maxTimingDifference === 0,
    passed, preprocessingMs: elapsedMs, peakCount: result.peaks.length,
    selectedScaleIndex: result.selectedScaleIndex, shortIntervalsRejected: result.shortIntervalsRejected,
    normalizationApplied: false, modelInferenceRun: false, qualityValidated: false,
    memoryMeasured: false, energyMeasured: false };
}

module.exports = { CONTRACT, FIXTURE_TOLERANCES, extractPpg, runFixture,
  // Low-level functions support cross-language tests, not alternate production contracts.
  kalmanFloat32, detrendLinear, ampdPeaks, gradient, featuresFromPeaks, validateFixture };

'use strict';
// Transport/data diagnostics only. No inference, normalization, resampling or clinical SQI.
const CONTRACT = 'cdd_ppg_recording_v1';
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_SAMPLES = 30000;
const TIMING_RELATIVE_TOLERANCE = 0.20;
const need = (ok, message) => { if (!ok) throw new Error(message); };
const finite = v => typeof v === 'number' && Number.isFinite(v);
function object(v, label) { need(v && typeof v === 'object' && !Array.isArray(v), label + ' must be an object.'); }
function text(v, label) { need(typeof v === 'string' && v.trim().length > 0 && v.length <= 160, label + ' must be 1–160 characters.'); }
function keys(v, allowed, label) {
  object(v, label);
  need(Object.keys(v).every(k => allowed.includes(k)), label + ' contains unsupported fields. Use the documented recording format.');
  need(allowed.every(k => Object.prototype.hasOwnProperty.call(v, k)), label + ' is missing a required field.');
}
function utf8Bytes(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 128) n++; else if (c < 2048) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && s.charCodeAt(i + 1) >= 0xdc00 && s.charCodeAt(i + 1) <= 0xdfff) { n += 4; i++; }
    else n += 3;
  }
  return n;
}
function validateRecording(r) {
  keys(r, ['schemaVersion','kind','source','recordingId','participantCode','startedAt','samplingRateHz','timingSource','sensor','channel','acquisition','samples'], 'recording');
  need(r.schemaVersion === 1 && r.kind === CONTRACT, 'Unsupported recording version or kind.');
  need(['synthetic','recorded'].includes(r.source), 'source must be synthetic or recorded.');
  for (const k of ['recordingId','participantCode']) text(r[k], k);
  need(/^[A-Za-z0-9_-]{1,64}$/.test(r.participantCode), 'Use a participant code of letters, numbers, hyphens or underscores, not a name/email.');
  const date = Date.parse(r.startedAt);
  need(Number.isFinite(date) && new Date(date).toISOString() === r.startedAt, 'startedAt must be UTC ISO with milliseconds, e.g. 2026-10-07T12:00:00.000Z.');
  need(finite(r.samplingRateHz) && r.samplingRateHz >= 1 && r.samplingRateHz <= 2000, 'samplingRateHz must be between 1 and 2000.');
  need(['sensor','sample_clock','arrival'].includes(r.timingSource), 'Declare whether timestamps come from the sensor, sample clock, or packet arrival.');
  keys(r.sensor, ['id','model','firmwareVersion','site'], 'sensor');
  for (const k of Object.keys(r.sensor)) text(r.sensor[k], 'sensor.' + k);
  keys(r.channel, ['name','wavelengthNm','units','adcMin','adcMax'], 'channel');
  text(r.channel.name, 'channel.name'); text(r.channel.units, 'channel.units');
  need(r.channel.wavelengthNm === null || (finite(r.channel.wavelengthNm) && r.channel.wavelengthNm > 0), 'wavelengthNm must be positive or null when unknown.');
  const low = r.channel.adcMin, high = r.channel.adcMax;
  need((low === null && high === null) || (finite(low) && finite(high) && low < high), 'Provide both ADC limits in the supplied units, or set both to null.');
  keys(r.acquisition, ['gain','ledCurrentMa','preprocessing'], 'acquisition');
  text(r.acquisition.gain, 'acquisition.gain'); text(r.acquisition.preprocessing, 'acquisition.preprocessing');
  need(r.acquisition.ledCurrentMa === null || (finite(r.acquisition.ledCurrentMa) && r.acquisition.ledCurrentMa >= 0), 'ledCurrentMa must be nonnegative or null.');
  need(Array.isArray(r.samples) && r.samples.length >= 2 && r.samples.length <= MAX_SAMPLES, 'Expected 2–30,000 samples.');
  for (const row of r.samples) {
    need(Array.isArray(row) && row.length === 3, 'Each sample must be [sequence, offset_ms, ppg_value].');
    need(Number.isSafeInteger(row[0]) && row[0] >= 0, 'Sample sequence must be a nonnegative safe integer.');
    need(finite(row[1]) && row[1] >= 0 && row[1] <= 86400000, 'Sample offset must be milliseconds within one day.');
    need(finite(row[2]) && Number.isFinite(Math.fround(row[2])), 'PPG values must be finite numbers within float32 range.');
  }
  return r;
}
function parseRecordingJson(json) {
  need(typeof json === 'string' && json.length <= MAX_FILE_BYTES && utf8Bytes(json) <= MAX_FILE_BYTES, 'Recording file exceeds the 4 MiB import limit.');
  let r; try { r = JSON.parse(json); } catch { throw new Error('Invalid JSON. Choose a recording JSON file or use the format example.'); }
  return validateRecording(r);
}
function inspectRecording(input) {
  const r = validateRecording(input), values = r.samples, count = values.length;
  const expectedMs = 1000 / r.samplingRateHz, toleranceMs = Math.max(0.5, expectedMs * TIMING_RELATIVE_TOLERANCE);
  let missing = 0, duplicate = 0, order = 0, nonIncreasing = 0, timingMismatch = 0, maxGap = 0;
  let min = Infinity, max = -Infinity, mean = 0, m2 = 0, atRails = 0, outsideRails = 0, run = 0, maxRun = 0;
  const seen = new Set(), diffs = [];
  for (let i = 0; i < count; i++) {
    const [seq,t,v] = values[i];
    if (seen.has(seq)) duplicate++; seen.add(seq);
    min = Math.min(min,v); max = Math.max(max,v);
    const delta = v - mean; mean += delta / (i + 1); m2 += delta * (v - mean);
    run = i && v === values[i-1][2] ? run + 1 : 1; maxRun = Math.max(maxRun,run);
    if (r.channel.adcMin !== null) {
      if (v <= r.channel.adcMin || v >= r.channel.adcMax) atRails++;
      if (v < r.channel.adcMin || v > r.channel.adcMax) outsideRails++;
    }
    if (i) {
      const ds = seq - values[i-1][0], dt = t - values[i-1][1];
      if (ds < 0) order++; if (ds > 1) missing += ds - 1;
      if (dt <= 0) nonIncreasing++; else diffs.push(dt);
      maxGap = Math.max(maxGap,dt);
      if (ds > 0 && Math.abs(dt - ds * expectedMs) > toleranceMs) timingMismatch++;
    }
  }
  diffs.sort((a,b) => a-b);
  const medianMs = diffs.length ? diffs[Math.floor(diffs.length/2)] : null;
  const spanMs = values[count-1][1] - values[0][1];
  const sequenceSpan = values[count-1][0] - values[0][0];
  const observedRate = spanMs > 0 && sequenceSpan > 0 ? sequenceSpan * 1000 / spanMs : null;
  const blockers = [], warnings = [];
  if (missing) blockers.push(`${missing} missing sequence positions.`);
  if (duplicate) blockers.push(`${duplicate} duplicate sequence numbers.`);
  if (order) blockers.push(`${order} sequence reversals.`);
  if (nonIncreasing) blockers.push(`${nonIncreasing} repeated or reversed timestamps.`);
  if (timingMismatch) blockers.push(`${timingMismatch} timestamp intervals disagree with the declared sample clock.`);
  if (observedRate !== null && Math.abs(observedRate/r.samplingRateHz - 1) > 0.01) blockers.push('Overall timestamp rate differs from the declared rate by more than 1%.');
  if (min === max) blockers.push('The selected signal is completely flat.');
  else if (maxRun >= Math.max(2,Math.ceil(r.samplingRateHz))) blockers.push('At least one second of identical consecutive values.');
  if (atRails) blockers.push(`${atRails} samples touch or exceed a declared ADC limit; check clipping.`);
  if (r.timingSource === 'arrival') blockers.push('Packet arrival timestamps cannot establish individual sample timing for this preview.');
  if (r.samplingRateHz !== 125) blockers.push('Beat preview requires actual 125 Hz data; resampling is not implemented.');
  if (count < 3750) blockers.push('Beat preview needs at least 3,750 samples (30 seconds at 125 Hz).');
  if (r.channel.adcMin === null) warnings.push('ADC limits are unknown, so hardware clipping cannot be checked.');
  if (r.timingSource === 'sample_clock') warnings.push('Sample-clock timestamps do not independently measure sampling jitter.');
  if (r.acquisition.preprocessing.toLowerCase() !== 'none') warnings.push('Upstream filtering is declared; review it before choosing model preprocessing.');
  warnings.push('Passing these engineering checks does not establish usable pulse morphology or BP accuracy.');
  return {
    schemaVersion:1, contract:CONTRACT, source:r.source, sampleCount:count,
    samplingRateHz:r.samplingRateHz, observedSequenceRateHz:observedRate,
    elapsedSeconds:spanMs/1000, nominalDurationSeconds:count/r.samplingRateHz,
    missingSequencePositions:missing, duplicateSequences:duplicate, sequenceReversals:order,
    nonIncreasingTimestamps:nonIncreasing, timingMismatchIntervals:timingMismatch,
    medianIntervalMs:medianMs, maxIntervalMs:maxGap, timingToleranceMs:toleranceMs,
    signal:{min,max,mean,std:Math.sqrt(Math.max(0,m2/count)),longestConstantRun:maxRun,atRails,outsideRails},
    completePreviewWindows:Math.floor(count/3750), remainderSamples:count%3750,
    previewAllowed:blockers.length===0, blockers,warnings,
    sensorCompatibilityVerified:false, qualityValidated:false, modelInferenceRun:false,
  };
}
function previewBeatExtraction(recording) {
  const report = inspectRecording(recording);
  need(report.previewAllowed, 'Beat preview blocked: ' + report.blockers.join(' '));
  const {extractPpg} = require('../bpPpgPreprocess');
  const windows=[];
  for (let i=0; i<report.completePreviewWindows; i++) {
    const samples=recording.samples.slice(i*3750,(i+1)*3750);
    try {
      const extracted=extractPpg(samples.map(row=>row[2]),125);
      windows.push({window:i+1,firstSequence:samples[0][0],candidateCount:extracted.beats.length,
        peakCount:extracted.peaks.length,shortIntervalsRejected:extracted.shortIntervalsRejected,error:null});
    } catch(error) {
      windows.push({window:i+1,firstSequence:samples[0][0],candidateCount:0,peakCount:0,
        shortIntervalsRejected:0,error:error instanceof Error?error.message:String(error)});
    }
  }
  return {windows,remainderSamples:report.remainderSamples,modelInferenceRun:false,normalizationApplied:false,
    passed:windows.length>0 && windows.every(w=>!w.error && w.candidateCount>0)};
}
// A deterministic software example; it is never marked as a person's recording.
function makeDemoRecording() {
  return {schemaVersion:1,kind:CONTRACT,source:'synthetic',recordingId:'synthetic-demo-001',participantCode:'DEMO',
    startedAt:'2026-10-07T12:00:00.000Z',samplingRateHz:125,timingSource:'sample_clock',
    sensor:{id:'synthetic',model:'generated-waveform',firmwareVersion:'none',site:'none'},
    channel:{name:'synthetic_ppg',wavelengthNm:null,units:'arbitrary_units',adcMin:null,adcMax:null},
    acquisition:{gain:'not applicable',ledCurrentMa:null,preprocessing:'none'},
    samples:Array.from({length:3750},(_,i)=>[i,i*8,Math.fround(1+0.5*Math.sin(2*Math.PI*1.1*i/125)+0.08*Math.sin(4*Math.PI*1.1*i/125))])};
}
module.exports={CONTRACT,MAX_FILE_BYTES,MAX_SAMPLES,parseRecordingJson,validateRecording,inspectRecording,previewBeatExtraction,makeDemoRecording};

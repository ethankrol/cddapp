'use strict';
// Read the team's serial capture formats without inventing a sample clock or patient metadata.
const {MAX_FILE_BYTES,MAX_SAMPLES} = require('./recordingCore');
const LEGACY_HEADER='time_stamp_millis,RawRed,RawIR';
const RAW_HEADER='sequence,read_started_us,read_finished_us,fifo_available,red_counts,ir_counts';
const need=(ok,message)=>{if(!ok)throw new Error(message);};
function parseSerialCsv(text) {
  need(typeof text==='string' && text.length<=MAX_FILE_BYTES,'CSV exceeds the 4 MiB import limit.');
  // These serial formats are ASCII numeric CSV, not general spreadsheets with quoted fields.
  need(/^[\x00-\x7f\uFEFF]*$/.test(text),'Serial CSV must contain an ASCII header and numeric rows.');
  const lines=text.replace(/^\uFEFF/,'').trim().split(/\r?\n/);
  const header=lines.shift().trim();
  need(header===LEGACY_HEADER||header===RAW_HEADER,'Unsupported CSV header. See the recording format guide.');
  need(lines.length>=2 && lines.length<=MAX_SAMPLES,'Expected 2–30,000 CSV samples.');
  const width=header===LEGACY_HEADER?3:6;
  const numeric=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
  const rows=lines.map((line,i)=>{
    const cells=line.split(',').map(c=>c.trim());
    need(cells.length===width && cells.every(c=>numeric.test(c)),`Invalid numeric CSV row ${i+2}; no rows were silently discarded.`);
    const values=cells.map(Number);
    need(values.every(v=>Number.isFinite(v) && Number.isFinite(Math.fround(v))),`Non-finite or oversized value in row ${i+2}.`);
    if(width===3) need(Number.isInteger(values[0]) && values[0]>=0 && values[0]<=0xffffffff,'Device milliseconds must fit uint32.');
    else {
      need(values.every(v=>Number.isSafeInteger(v)&&v>=0),'Raw capture fields must be nonnegative integers.');
      need(values[1]<=0xffffffff && values[2]<=0xffffffff,'Device microseconds must fit uint32.');
      need(values[3]<=255,'FIFO count must fit uint8.');
      need(values[4]<=0xffffff && values[5]<=0xffffff,'Raw LED counts must fit the library 24-bit transport.');
    }
    return values;
  });
  return {kind:'cdd_serial_csv_v1',format:width===3?'legacy_ac':'raw_readout',rows};
}
function stats(values) {
  let min=Infinity,max=-Infinity,mean=0,m2=0,maxStep=0;
  values.forEach((v,i)=>{min=Math.min(min,v);max=Math.max(max,v);const d=v-mean;mean+=d/(i+1);m2+=d*(v-mean);if(i)maxStep=Math.max(maxStep,Math.abs(v-values[i-1]));});
  return {min,max,mean,std:Math.sqrt(Math.max(0,m2/values.length)),largestAdjacentChange:maxStep};
}
function inspectSerialCsv(recording) {
  need(recording?.kind==='cdd_serial_csv_v1','Expected a parsed serial recording.');
  // Round-trip through the strict parser also validates caller-created objects.
  const legacy=recording.format==='legacy_ac';
  need(legacy||recording.format==='raw_readout','Unknown serial format.');
  const r=parseSerialCsv((legacy?LEGACY_HEADER:RAW_HEADER)+'\n'+recording.rows.map(row=>row.join(',')).join('\n'));
  const rows=r.rows;
  const t=rows.map(v=>legacy?v[0]:v[1]/1000);
  const intervals=t.slice(1).map((v,i)=>v-t[i]),sorted=intervals.slice().sort((a,b)=>a-b);
  const median=sorted.length%2?sorted[(sorted.length-1)/2]:(sorted[sorted.length/2-1]+sorted[sorted.length/2])/2;
  const elapsed=t[t.length-1]-t[0],nonIncreasing=intervals.filter(v=>v<=0).length;
  const histogram=new Map();for(const v of intervals)histogram.set(v,(histogram.get(v)||0)+1);
  let sequenceMissing=null,sequenceNonIncreasing=null;
  if(!legacy) {
    sequenceMissing=0;sequenceNonIncreasing=0;
    for(let i=1;i<rows.length;i++){const ds=rows[i][0]-rows[i-1][0];if(ds>1)sequenceMissing+=ds-1;if(ds<=0)sequenceNonIncreasing++;}
  }
  return {schemaVersion:1,format:r.format,source:'recorded',sampleCount:rows.length,elapsedSeconds:elapsed/1000,
    observedLoggedPairsPerSecond:elapsed>0&&!nonIncreasing?(rows.length-1)*1000/elapsed:null,
    declaredSensorRateHz:null,timestampsDescribe:legacy?'device_print_time_ms':'device_read_start_us',
    nonIncreasingTimestamps:nonIncreasing,intervalMs:{min:sorted[0],median,p95:sorted[Math.ceil(.95*sorted.length)-1],max:sorted[sorted.length-1]},
    mostCommonIntervals:Array.from(histogram,([ms,count])=>({ms,count})).sort((a,b)=>b.count-a.count).slice(0,10),
    hostSequenceMissing:sequenceMissing,hostSequenceNonIncreasing:sequenceNonIncreasing,
    sensorSamplesLost:null,fifoMaximum:legacy?null:Math.max(...rows.map(v=>v[3])),
    red:stats(rows.map(v=>v[legacy?1:4])),infrared:stats(rows.map(v=>v[legacy?2:5])),
    previewAllowed:false,modelInferenceRun:false,qualityValidated:false,bpAccuracyEvaluated:false,
    blockers:[
      'Sensor sample rate and exact acquisition timestamps are not established by this CSV. Readout times are not a verified sample clock.',
      ...(legacy?['The supplied firmware subtracts a moving baseline. RawRed and RawIR are processed AC values, not original ADC counts.']:[]),
      ...(nonIncreasing?['Device timestamps repeat or reverse; check wrap, restart or row order before interpreting duration.']:[]),
      'The original beat model expects compatible PPG at evenly spaced 125 Hz. This inspection does not resample; the separate AnyPPG CSV demo uses explicitly unverified print-time interpolation.',
      'This file contains no paired cuff readings, so BP error and personal calibration cannot be evaluated.'
    ],
    warnings:['Red and infrared are separate optical channels. The original beat model’s three channels are PPG plus its first and second derivatives.',
      'Logged row counts and gaps cannot prove how many sensor samples were skipped before logging.',
      'Missing metadata is kept unknown; it is not filled in from the filename.']};
}
function parseRecordingFile(text) {
  const cleaned=text.replace(/^\uFEFF/,'').trimStart();
  return cleaned.startsWith('{')?require('./recordingCore').parseRecordingJson(cleaned):parseSerialCsv(cleaned);
}
module.exports={LEGACY_HEADER,RAW_HEADER,parseSerialCsv,inspectSerialCsv,parseRecordingFile};

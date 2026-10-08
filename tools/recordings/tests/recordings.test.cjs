const test=require('node:test');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {mkdtempSync,writeFileSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const path=require('node:path');
const core=require('../../../services/recordings/recordingCore');
const csv=require('../../../services/recordings/serialCsv');

test('125 Hz synthetic recording checks and every full window is previewed',()=>{
 const r=core.makeDemoRecording();const parsed=core.parseRecordingJson(JSON.stringify(r));
 assert.equal(core.inspectRecording(parsed).previewAllowed,true);
 parsed.samples.push(...r.samples.map(([n,t,v])=>[n+3750,t+30000,v]));
 parsed.samples.push([7500,60000,1]);
 const preview=core.previewBeatExtraction(parsed);
 assert.equal(preview.windows.length,2);assert.equal(preview.remainderSamples,1);
 assert(preview.windows.every(w=>w.candidateCount>0&&!w.error));
 assert.equal(preview.modelInferenceRun,false);assert.equal(preview.normalizationApplied,false);
});
test('each timing/transport failure blocks extraction independently',()=>{
 for(const edit of [r=>r.samples.splice(10,1),r=>r.samples[10][0]=9,r=>r.samples[10][1]=r.samples[9][1],
  r=>r.samplingRateHz=50,r=>r.timingSource='arrival',r=>r.samples.forEach(x=>x[2]=7),
  r=>{r.channel.adcMin=0;r.channel.adcMax=1;}]){
  const r=core.makeDemoRecording();edit(r);assert.equal(core.inspectRecording(r).previewAllowed,false);
  assert.throws(()=>core.previewBeatExtraction(r),/blocked/);
 }
});
test('rejects corrupt JSON and malformed schema or nonfinite waveform',()=>{
 assert.throws(()=>core.parseRecordingJson('{'));
 for(const edit of [r=>r.samples[0][2]=NaN,r=>r.samples[0][2]=Infinity,r=>r.startedAt='yesterday',r=>r.extra=true]){
  const r=core.makeDemoRecording();edit(r);assert.throws(()=>core.validateRecording(r));
 }
 assert.throws(()=>core.parseRecordingJson(' '.repeat(core.MAX_FILE_BYTES+1)));
});
test('legacy serial CSV preserves both channels and does not invent sample rate',()=>{
 const r=csv.parseRecordingFile('\uFEFF'+csv.LEGACY_HEADER+'\r\n100.0,-1.5,5\r\n121,2,6\r\n202,9,-10\r\n');
 const report=csv.inspectSerialCsv(r);
 assert.equal(report.sampleCount,3);assert.equal(report.red.min,-1.5);assert.equal(report.infrared.min,-10);
 assert.equal(report.intervalMs.median,51);assert.equal(report.declaredSensorRateHz,null);
 assert.equal(report.sensorSamplesLost,null);assert.equal(report.previewAllowed,false);assert.equal(report.modelInferenceRun,false);
});
test('even 125 logged rows per second does not certify a CSV sample clock',()=>{
 const r=csv.parseSerialCsv(csv.LEGACY_HEADER+'\n0,1,2\n8,2,3\n16,3,4');
 const report=csv.inspectSerialCsv(r);assert.equal(report.observedLoggedPairsPerSecond,125);assert.equal(report.previewAllowed,false);
});
test('CSV errors never silently drop rows or accept missing numeric cells',()=>{
 for(const row of ['2,,5','2,3','2,Infinity,5','2,NaN,3','2,"3",5','2,0x12,4','2,3,4,5','2,3,4\n\n3,4,5'])
  assert.throws(()=>csv.parseSerialCsv(csv.LEGACY_HEADER+'\n1,2,3\n'+row));
 assert.throws(()=>csv.parseSerialCsv('timestamp,red,ir\n1,2,3\n2,3,4'));
});
test('raw readout sequence gaps and time rollover stay visible',()=>{
 const r=csv.parseSerialCsv(csv.RAW_HEADER+'\n0,4294967280,4294967290,1,10,20\n2,10,20,4,11,21');
 const report=csv.inspectSerialCsv(r);
 assert.equal(report.hostSequenceMissing,1);assert.equal(report.nonIncreasingTimestamps,1);
 assert.equal(report.observedLoggedPairsPerSecond,null);assert.equal(report.fifoMaximum,4);
});
test('inspection CLI reports blocked recordings with exit 2 and no waveform',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'cdd-recording-'));
 try{const f=path.join(dir,'private.csv');writeFileSync(f,csv.LEGACY_HEADER+'\n0,1,2\n10,3,4');
  try{execFileSync(process.execPath,[path.resolve(__dirname,'../inspect_recording.cjs'),f]);assert.fail('Expected blocked exit');}
  catch(e){assert.equal(e.status,2);const out=JSON.parse(e.stdout);assert.equal(out.inspection.sampleCount,2);assert.equal(out.preview,null);assert.equal(out.inspection.rows,undefined);}
 }finally{rmSync(dir,{recursive:true,force:true});}
});

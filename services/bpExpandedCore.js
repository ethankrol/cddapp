'use strict';
const {extractPpg} = require('./bpPpgPreprocess');
const f = Math.fround;
const requireValue = (ok, msg) => { if (!ok) throw new Error(msg); };
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const MODEL = 'a8e26e25b852344814e4a474e73e92b9f8d40845c20948fdcce828c9e4f12fce';
const NORM = 'bc8a28b7ca84faa00644fa7d13ae706705ecd47b9543296753273555be3aba41';
function median(x) {
  if (!x.length) return null;
  const a = [...x].sort((a,b)=>a-b), m = Math.floor(a.length/2);
  return a.length%2 ? a[m] : (a[m-1]+a[m])/2;
}
function validate(r) {
  requireValue(r?.test === 'cdd_full_ppg_reference' && r.schemaVersion === 1 && r.synthetic === true &&
    r.contract === 'legacy_ppg_candidates_v1' && r.samplingRateHz === 125 &&
    r.sourceHashes?.model === MODEL && r.sourceHashes?.normalization === NORM &&
    r.outputToleranceMmhg === 0.01, 'Unexpected full-reference contract.');
  const numeric = (x,n) => Array.isArray(x) && x.length === n && x.every(v=>typeof v==='number' && Number.isFinite(v) && f(v)===v);
  requireValue(numeric(r.raw,3750), 'Expected 3750 finite float32 samples.');
  requireValue(Array.isArray(r.windows) && r.windows.length===6, 'Expected six reference windows.');
  for (let i=0;i<6;i++) {
    const w=r.windows[i], n=w?.beats?.length;
    requireValue(w.offsetSamples===i*625 && Number.isInteger(n) && n>0 && n<375, 'Invalid window/count.');
    requireValue(i!==0 || n===31, 'Expected all 31 original beats.');
    for(const key of ['beats','normalizedBeats']) requireValue(w[key].length===n && w[key].every(b=>Array.isArray(b)&&b.length===3&&b.every(c=>numeric(c,250))), 'Invalid '+key);
    for(const key of ['timing','normalizedTiming','outputs']) requireValue(w[key].length===n && w[key].every(t=>numeric(t,2)), 'Invalid '+key);
    requireValue(w.intervals.length===n && w.intervals.every((v,j)=>Array.isArray(v)&&v.length===2&&v.every(Number.isInteger)&&v[0]>=0&&v[1]<=3750&&v[1]-v[0]>=10&&(j===0||v[0]>=w.intervals[j-1][1])), 'Invalid intervals.');
  }
  const n=r.normalization;
  requireValue(n?.sampling_rate_hz===125 && n.samples_per_beat===250 && same(n.channel_order,['PPG','dPPG','d2PPG']) && same(n.output_order,['SBP','DBP']), 'Invalid normalization contract.');
  for (const [k,len] of [['channel_mean',3],['channel_std',3],['timing_mean',2],['timing_std',2]]) {
    requireValue(numeric(n[k],len) && (!k.endsWith('_std') || n[k].every(v=>v>0)), 'Invalid normalization '+k);
  }
}
function rotated(raw, offset) { return raw.slice(offset).concat(raw.slice(0,offset)); }
function normalize(v,m,s) { return f(f(f(v)-f(m))/f(s)); }
function prepare(raw,w,norm) {
  const actual=extractPpg(raw), inputs=[];
  requireValue(same(actual.intervals,w.intervals) && actual.beats.length===w.beats.length, 'Candidate count/interval mismatch.');
  let maxRaw=0,maxTiming=0,maxNormalized=0;
  for(let b=0;b<actual.beats.length;b++) {
    const x=new Float32Array(750),t=new Float32Array(2);
    for(let c=0;c<3;c++) for(let j=0;j<250;j++) {
      const value=actual.beats[b][c][j];
      maxRaw=Math.max(maxRaw,Math.abs(value-w.beats[b][c][j]));
      x[c*250+j]=normalize(value,norm.channel_mean[c],norm.channel_std[c]);
      maxNormalized=Math.max(maxNormalized,Math.abs(x[c*250+j]-w.normalizedBeats[b][c][j]));
    }
    for(let j=0;j<2;j++) {
      maxTiming=Math.max(maxTiming,Math.abs(actual.timing[b][j]-w.timing[b][j]));
      t[j]=normalize(actual.timing[b][j],norm.timing_mean[j],norm.timing_std[j]);
      maxNormalized=Math.max(maxNormalized,Math.abs(t[j]-w.normalizedTiming[b][j]));
    }
    inputs.push({beat:x,timing:t});
  }
  requireValue(maxRaw<=1e-6 && maxTiming<=1e-7 && maxNormalized<=1e-6, 'Preprocessing/normalization comparison failed.');
  return {inputs, maxRaw, maxTiming, maxNormalized};
}
function compareOverlap(previous,current) {
  if(!previous) return null;
  const map=new Map(previous.intervals.map((v,i)=>[v.map(x=>x+previous.startSample).join(':'),previous.outputs[i]]));
  const diffs=[];
  current.intervals.forEach((v,i)=>{
    const old=map.get(v.map(x=>x+current.startSample).join(':'));
    if(old) diffs.push(old.map((x,j)=>Math.abs(x-current.outputs[i][j])));
  });
  return {matchedExactIntervals:diffs.length, previousCandidates:previous.outputs.length,
    currentCandidates:current.outputs.length, maxOutputDifferenceMmhg:diffs.length?[0,1].map(j=>Math.max(...diffs.map(v=>v[j]))):null,
    interpretation:'Exact shared intervals only; mismatched boundaries are not paired. Differences measure window sensitivity, not BP error.'};
}
async function runExpanded({reference:r,mode='full',durationSeconds=300,createAdapter,
  shouldCancel=()=>false,onProgress=()=>{},now=()=>performance.now(),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}) {
  const wall=now(), report={schemaVersion:1,test:'cdd_expanded_ppg',synthetic:true,mode,
    startedAt:new Date().toISOString(),complete:false,passed:false,cancelled:false,failure:null,cleanupFailure:null,
    modelSha256:MODEL,attempted:0,successful:0,parityFailures:0,windows:[],
    sessionReleased:false,maxArrivalLagMs:0,deadlineMisses:0,maxBufferSamples:0,
    energyMeasured:false,memoryMeasured:false,appColdLaunchMeasured:false,sensorAcquisition:false,
    calibrationApplied:false,bpAccuracyEvaluated:false,qualityValidated:false,
    aggregation:'Per-window unweighted mean and median, software diagnostics only; overlapping windows are never pooled.',
    signal:'Repeated synthetic 30-second fixture. Artificial wrap boundaries; no BLE, motion or missing samples.',
    referenceChecksIncludedInWorkload:true};
  let adapter,previous;
  function cancelled() { if(shouldCancel()) { report.cancelled=true; throw new Error('Cancelled or app left foreground.'); } }
  async function processWindow(raw,startSample) {
    cancelled();
    const w=r.windows[(startSample%3750)/625];
    const begin=now(), prep=prepare(raw,w,r.normalization), preprocessAndChecksMs=now()-begin;
    const outputs=[],inferenceMs=[];
    let maxDifference=[0,0];
    for(let i=0;i<prep.inputs.length;i++) {
      cancelled();report.attempted++;
      const result=await adapter.run(prep.inputs[i].beat,prep.inputs[i].timing);
      requireValue(Array.isArray(result.values)&&result.values.length===2&&result.values.every(Number.isFinite), 'Invalid model outputs.');
      requireValue(Number.isFinite(result.inferenceMs)&&result.inferenceMs>=0,'Invalid timing.');
      report.successful++;outputs.push(result.values);inferenceMs.push(result.inferenceMs);
      const d=result.values.map((v,j)=>Math.abs(v-w.outputs[i][j]));
      maxDifference=maxDifference.map((v,j)=>Math.max(v,d[j]));
      if(d.some(v=>v>0.01)) report.parityFailures++;
      if(i%8===7) await sleep(0); // Let cancel/background events run.
    }
    cancelled();
    const current={startSample,intervals:w.intervals,outputs};
    const row={startSample,finishedAt:new Date().toISOString(),candidates:outputs.length,channelValuesChecked:outputs.length*750,timingValuesChecked:outputs.length*2,
      maxRawDifference:prep.maxRaw,maxTimingDifference:prep.maxTiming,maxNormalizedDifference:prep.maxNormalized,
      maxOutputDifferenceMmhg:maxDifference,preprocessAndChecksMs,totalWindowMs:now()-begin,
      inferenceMeanMs:inferenceMs.reduce((a,b)=>a+b,0)/inferenceMs.length,
      mean:[0,1].map(j=>outputs.reduce((s,v)=>s+v[j],0)/outputs.length),
      median:[0,1].map(j=>median(outputs.map(v=>v[j]))),overlapWithPrevious:compareOverlap(previous,current)};
    if(mode==='full') Object.assign(row,{intervals:w.intervals,outputs,expectedOutputs:w.outputs});
    report.windows.push(row);previous=current;
  }
  try {
    validate(r);
    requireValue(['full','blocks','rolling','idle'].includes(mode),'Unknown mode.');
    requireValue(Number.isInteger(durationSeconds)&&durationSeconds>=30&&durationSeconds<=1200&&durationSeconds%30===0,'Duration must be 30..1200 seconds in 30-second increments.');
    cancelled();
    if(mode!=='idle') { adapter=await createAdapter();report.adapterTimings=adapter.timings; }
    if(mode==='full') {
      for(const w of r.windows) { await processWindow(rotated(r.raw,w.offsetSamples),w.offsetSamples);onProgress({windows:report.windows.length}); }
    } else {
      const start=now();report.durationSeconds=durationSeconds;report.pacingStartAfterSessionSetup=true;report.pacingStartedAt=new Date().toISOString();
      let buffer=[];
      for(let second=1;second<=durationSeconds;second++) {
        const deadline=start+second*1000;
        while(now()<deadline) { cancelled();await sleep(Math.min(200,deadline-now())); }
        cancelled();const lag=now()-deadline;
        report.maxArrivalLagMs=Math.max(report.maxArrivalLagMs,lag);
        if(lag>1000) { report.deadlineMisses++;throw new Error('More than one simulated arrival behind; replay stopped instead of hiding a backlog.'); }
        const offset=((second-1)*125)%3750;
        buffer=buffer.concat(r.raw.slice(offset,offset+125)).slice(-3750);
        report.maxBufferSamples=Math.max(report.maxBufferSamples,buffer.length);
        if(mode!=='idle' && second>=30 && (mode==='rolling'?(second-30)%5===0:second%30===0)) await processWindow(buffer,(second-30)*125);
        onProgress({seconds:second,durationSeconds,windows:report.windows.length});
      }
    }
    cancelled();report.complete=true;
  } catch(error) { report.failure=String(error); }
  finally {
    if(adapter) try { await adapter.release();report.sessionReleased=true; } catch(error) { report.cleanupFailure=String(error); }
  }
  report.passed=report.complete&&!report.cancelled&&!report.failure&&!report.cleanupFailure&&report.parityFailures===0;
  report.inferencePassed=mode==='idle'?null:report.passed&&report.successful>0;
  report.finishedAt=new Date().toISOString();report.totalWallMs=now()-wall;
  return report;
}
module.exports={validate,prepare,rotated,compareOverlap,runExpanded};

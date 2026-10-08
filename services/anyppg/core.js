'use strict';
const {inspectSerialCsv} = require('../recordings/serialCsv');
const need = (ok, message) => { if (!ok) throw new Error(message); };
const MODEL_ID = 'anyppg_frozen_ridge_raw_v1';

function prepareRecording(recording) {
  const inspection = inspectSerialCsv(recording);
  need(recording.format === 'legacy_ac', 'This experimental model currently accepts the original time_stamp_millis,RawRed,RawIR CSV only. New raw-count captures need a separate acquisition review.');
  need(inspection.nonIncreasingTimestamps === 0, 'Timestamps must increase strictly; duplicate, wrapped or reversed times cannot be inferred.');
  need(inspection.intervalMs.max <= 1000, 'The file has a gap longer than 1 second. This demo will not interpolate across that gap.');
  need(inspection.elapsedSeconds >= 30 && inspection.elapsedSeconds <= 600, 'Choose a recording lasting 30 seconds to 10 minutes.');
  const rows = recording.rows, origin = rows[0][0];
  const length = Math.floor((rows[rows.length-1][0]-origin)/8)+1;
  const starts = [];
  for(let start=0;start+3750<=length;start+=3750) starts.push(start);
  if(starts[starts.length-1] !== length-3750) starts.push(length-3750);
  const channels = [];
  for(const [channel,col] of [['red',1],['infrared',2]]) {
    const signal = new Float64Array(length);
    let right=1;
    for(let i=0;i<length;i++) {
      const t=origin+i*8;
      while(right<rows.length-1 && rows[right][0]<t) right++;
      const left=right-1;
      // Same linear interpolation contract as NumPy; never extrapolate.
      const slope=(rows[right][col]-rows[left][col])/(rows[right][0]-rows[left][0]);
      signal[i]=rows[left][col]+slope*(t-rows[left][0]);
    }
    channels.push({channel,signal});
  }
  return {inspection,starts,channels,gridSamples:length};
}

function standardizeWindow(window) {
  need(window.length === 3750, 'AnyPPG requires exactly 3750 samples per window.');
  const out=new Float32Array(3750);
  for(let k=0;k<3;k++) {
    const start=k*1250; let sum=0;
    for(let i=start;i<start+1250;i++){need(Number.isFinite(window[i]),'Signal contains a non-finite value.');sum+=window[i];}
    const mean=sum/1250;let variance=0;
    for(let i=start;i<start+1250;i++) variance+=(window[i]-mean)**2;
    const std=Math.sqrt(variance/1250);
    need(Number.isFinite(std)&&std>1e-12,'A 10-second signal section is flat or invalid; no BP estimate was produced.');
    for(let i=start;i<start+1250;i++) out[i]=(window[i]-mean)/(std+1e-8);
  }
  need(out.every(Number.isFinite),'Signal normalization overflowed.');
  return out;
}

function applyHead(features,head) {
  need(features.length === 1536 && Array.from(features).every(Number.isFinite),'Invalid encoder output.');
  need(head.model===MODEL_ID && head.feature_mean?.length===512 && head.feature_std?.length===512 && head.coefficients?.length===512 && head.target_mean?.length===2,'Wrong saved BP head.');
  const bp=head.target_mean.slice();
  for(let j=0;j<512;j++) {
    // NumPy float32 reduction of the 3 chunk embeddings, then float64 saved head.
    const mean=Math.fround(Math.fround(Math.fround(features[j]+features[512+j])+features[1024+j])/3);
    need(Number.isFinite(head.feature_mean[j]) && Number.isFinite(head.feature_std[j]) && head.feature_std[j]>0 && head.coefficients[j]?.length===2 && head.coefficients[j].every(Number.isFinite),'Invalid saved BP head scaling.');
    const z=(mean-head.feature_mean[j])/head.feature_std[j];
    bp[0]+=z*head.coefficients[j][0];bp[1]+=z*head.coefficients[j][1];
  }
  need(bp.every(Number.isFinite),'Model produced a non-finite result.');
  return bp;
}

async function runRecording({recording,head,manifest,createAdapter,shouldCancel=()=>false,onProgress=()=>{},now=()=>performance.now()}) {
  const startedAt=new Date().toISOString(),start=now();
  need(manifest.modelId===MODEL_ID,'Wrong model package.');
  const prepared=prepareRecording(recording), windows=[];
  // Validate all chunks before allocating a native session; retain no partial successful report.
  for(const {signal} of prepared.channels) for(const at of prepared.starts) standardizeWindow(signal.subarray(at,at+3750));
  const checkCancel=()=>need(!shouldCancel(),'CSV inference cancelled.');
  checkCancel();
  let adapter, error, cleanupFailure;
  try {
    adapter=await createAdapter();
    for(const {channel,signal} of prepared.channels) for(const at of prepared.starts) {
      checkCancel();
      const result=await adapter.run(standardizeWindow(signal.subarray(at,at+3750)));
      checkCancel();
      const bp=applyHead(result.features,head);
      windows.push({channel,startSeconds:at/125,lastSampleSeconds:(at+3749)/125,sbp:bp[0],dbp:bp[1],inferenceMs:result.inferenceMs});
      onProgress(windows.length,prepared.starts.length*2);
    }
  } catch(e) { error=e; }
  finally { if(adapter) try {await adapter.release();} catch(e) {cleanupFailure=String(e);} }
  if(error || cleanupFailure) throw new Error([error?String(error):'',cleanupFailure?'Session cleanup failed: '+cleanupFailure:''].filter(Boolean).join('; '));
  checkCancel();
  return {schemaVersion:1,modelId:MODEL_ID,source:'recorded',experimental:true,complete:true,
    startedAt,finishedAt:new Date().toISOString(),totalWallMs:now()-start,
    modelSha256:manifest.modelSha256,headSha256:manifest.headSha256,
    inputFormat:recording.format,sourceRows:recording.rows.length,sourceDurationSeconds:prepared.inspection.elapsedSeconds,
    gridSamples:prepared.gridSamples,maxLoggedGapMs:prepared.inspection.intervalMs.max,
    modelSamplingRateHz:125,sensorSamplingRateHz:null,timebase:'unverified_device_print_times',
    sensorSite:'unknown',windows,windowPolicy:'Nonoverlapping full blocks plus final overlapping block when needed; no pooling.',
    channelPolicy:'Red and infrared independently; no fusion or preferred-channel selection.',
    calibrationApplied:false,bpAccuracyEvaluated:false,qualityValidated:false,sensorCompatibilityVerified:false,
    sessionReleased:true,executionProvider:'cpu',threads:1,graphOptimizationLevel:'disabled'};
}
module.exports={MODEL_ID,prepareRecording,standardizeWindow,applyHead,runRecording};

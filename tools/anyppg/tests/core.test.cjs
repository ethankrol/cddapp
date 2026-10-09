/* global __dirname */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'../../..');
const {prepareRecording,standardizeWindow,applyHead,runRecording}=require('../../../services/anyppg/core');
const {createAdapter}=require('../../../services/anyppg/ort');
const fixture=require('../../../assets/models/anyppg/synthetic_reference.json');
const head=require('../../../assets/models/anyppg/ridge_head.json');
const manifest=require('../../../assets/models/anyppg/manifest.json');
const recording={kind:'cdd_serial_csv_v1',format:'legacy_ac',rows:fixture.rows};
const options={recording,head,manifest};
test('packaged model and saved head match the export manifest',()=>{
 for(const [file,expected] of [['anyppg_encoder.onnx',manifest.modelSha256],['ridge_head.json',manifest.headSha256],['synthetic_reference.json',manifest.syntheticFixtureSha256]])
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'assets/models/anyppg',file))).digest('hex'),expected);
});
test('all red/IR windows match independently generated Python scaling and BP references',()=>{
 const p=prepareRecording(recording);let i=0;
 for(const {channel,signal} of p.channels)for(const start of p.starts){
  const ref=fixture.windows[i++];assert.equal(channel,ref.channel);assert.equal(start,ref.startSample);
  const x=standardizeWindow(signal.subarray(start,start+3750));
  assert.ok(x.every((v,j)=>Math.abs(v-ref.normalized[j])<=1e-6));
  const bp=applyHead(ref.features,head);
  bp.forEach((v,j)=>assert.ok(Math.abs(v-ref.expected[j])<=.01));
 }
 assert.equal(i,4);
});
test('reject invalid timeline, unsupported raw counts, short recordings and flat chunks',()=>{
 assert.throws(()=>prepareRecording({...recording,rows:recording.rows.slice(0,10)}),/30 seconds/);
 const duplicate=recording.rows.map(r=>r.slice());duplicate[1][0]=duplicate[0][0];
 assert.throws(()=>prepareRecording({...recording,rows:duplicate}),/increase strictly/);
 const gapped=recording.rows.map(r=>r.slice());for(let i=1;i<gapped.length;i++)gapped[i][0]+=1200;
 assert.throws(()=>prepareRecording({...recording,rows:gapped}),/gap longer/);
 assert.throws(()=>prepareRecording({...recording,format:'raw_readout'}));
 assert.throws(()=>standardizeWindow(new Float64Array(3750)),/flat/);
 assert.throws(()=>applyHead(new Float32Array(1536),{...head,feature_std:new Array(512).fill(0)}),/scaling/);
});
test('whole recording completes without channel/window pooling and always releases',async()=>{
 let calls=0,released=0;
 const report=await runRecording({...options,createAdapter:async()=>({run:async()=>({features:fixture.windows[calls++].features,inferenceMs:1}),release:async()=>{released++;}})});
 assert.equal(report.windows.length,4);assert.equal(released,1);assert.equal(report.calibrationApplied,false);
 assert.equal(report.sensorSamplingRateHz,null);assert.equal(report.bpAccuracyEvaluated,false);
});
test('failure, cancellation and cleanup errors cannot yield a successful report',async()=>{
 let released=0,cancel=false;
 const adapter={run:async()=>{cancel=true;return {features:fixture.windows[0].features,inferenceMs:1};},release:async()=>{released++;}};
 await assert.rejects(runRecording({...options,createAdapter:async()=>adapter,shouldCancel:()=>cancel}),/cancelled/);assert.equal(released,1);
 await assert.rejects(runRecording({...options,createAdapter:async()=>({run:async()=>{throw Error('native failure');},release:async()=>{released++;}})}),/native failure/);assert.equal(released,2);
 await assert.rejects(runRecording({...options,createAdapter:async()=>({run:async()=>({features:fixture.windows[0].features,inferenceMs:1}),release:async()=>{throw Error('release failed');}})}),/cleanup/);
});
test('native adapter pins optimization off, enforces shape, and disposes all tensors',async()=>{
 let options,disposed=0,released=0;
 const ort={Tensor:class {constructor(type,data,dims){Object.assign(this,{type,data,dims});}dispose(){disposed++;}},InferenceSession:{create:async(_uri,o)=>{
  options=o;return {inputNames:['chunks'],outputNames:['features'],run:async()=>({features:new ort.Tensor('float32',new Float32Array(1536),[3,512])}),release:async()=>{released++;}};
 }}};
 const adapter=await createAdapter({ort,uri:'bundled-model'});
 assert.equal(options.graphOptimizationLevel,'disabled');
 await adapter.run(new Float32Array(3750));assert.equal(disposed,2);
 await adapter.release();await adapter.release();assert.equal(released,1);
 await assert.rejects(adapter.run(new Float32Array(3750)),/released/);
});

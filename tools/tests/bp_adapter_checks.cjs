'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {createOrtAdapter}=require('../../services/bpPpgChainOrt');
function setup({wrongNames=false,runFails=false,wrongShape=false,ctorFails=false,disposeFails=false}={}){
 const tensors=[];let releases=0,count=0;
 class Tensor{
  constructor(type,data,dims){if(ctorFails&&++count===2)throw new Error('timing ctor failed');
   Object.assign(this,{type,data,dims,disposed:0});tensors.push(this);}
  dispose(){this.disposed++;if(disposeFails)throw new Error('dispose failed');}
 }
 const session={inputNames:wrongNames?['wrong']:['beat','timing'],outputNames:['bp'],
  async run(feeds){assert.deepEqual(feeds.beat.dims,[1,3,250]);assert.deepEqual(feeds.timing.dims,[1,2]);
   if(runFails)throw new Error('native run failed');
   return {bp:new Tensor('float32',Float32Array.of(1,2),wrongShape?[2,1]:[1,2])};},
  async release(){releases++;}};
 const ort={Tensor,InferenceSession:{async create(uri,opts){assert.equal(uri,'file:///test.onnx');
  assert.deepEqual(opts,{executionProviders:['cpu'],intraOpNumThreads:1,interOpNumThreads:1});return session;}}};
 return {tensors,get releases(){return releases;},config:{loadOrt:async()=>ort,resolveModel:async()=>'file:///test.onnx',now:()=>0}};
}
test('adapter validates shape, disposes all tensors and releases once',async()=>{
 const s=setup(),a=await createOrtAdapter(s.config);
 const r=await a.run(new Float32Array(750),new Float32Array(2));assert.deepEqual(r.values,[1,2]);
 assert.equal(s.tensors.length,3);assert.ok(s.tensors.every(t=>t.disposed===1));
 await a.release();await a.release();assert.equal(s.releases,1);
 await assert.rejects(()=>a.run(new Float32Array(750),new Float32Array(2)),/released/);
});
test('interface mismatch releases newly created session',async()=>{
 const s=setup({wrongNames:true});await assert.rejects(()=>createOrtAdapter(s.config),/input\/output/);assert.equal(s.releases,1);
});
test('native run failure still disposes inputs',async()=>{
 const s=setup({runFails:true}),a=await createOrtAdapter(s.config);
 await assert.rejects(()=>a.run(new Float32Array(750),new Float32Array(2)),/native run failed/);
 assert.equal(s.tensors.length,2);assert.ok(s.tensors.every(t=>t.disposed===1));await a.release();
});
test('output validation failure still disposes output and inputs',async()=>{
 const s=setup({wrongShape:true}),a=await createOrtAdapter(s.config);
 await assert.rejects(()=>a.run(new Float32Array(750),new Float32Array(2)),/output tensor/);
 assert.equal(s.tensors.length,3);assert.ok(s.tensors.every(t=>t.disposed===1));await a.release();
});
test('partial tensor construction cleans up the first tensor',async()=>{
 const s=setup({ctorFails:true}),a=await createOrtAdapter(s.config);
 await assert.rejects(()=>a.run(new Float32Array(750),new Float32Array(2)),/ctor failed/);
 assert.equal(s.tensors.length,1);assert.equal(s.tensors[0].disposed,1);await a.release();
});
test('tensor disposal failure is surfaced while other tensors are still disposed',async()=>{
 const s=setup({disposeFails:true}),a=await createOrtAdapter(s.config);
 await assert.rejects(()=>a.run(new Float32Array(750),new Float32Array(2)),/cleanup failed/);
 assert.ok(s.tensors.every(t=>t.disposed===1));await a.release();
});

'use strict';
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),Module=require('module');
const root=path.resolve(__dirname,'../..'),filename=path.join(root,'services/bpExpandedCore.js');
const m=new Module(filename,module);m.filename=filename;m.paths=module.paths;
m.require=name=>name==='./bpPpgPreprocess'?require(path.join(root,'services/bpPpgPreprocess.js')):require(name);
m._compile(fs.readFileSync(filename,'utf8'),filename);const core=m.exports;
function value(x,t){return [Math.fround(x[0]+t[0]),Math.fround(x[749]+t[1])];}
function fixture(){
  const r=JSON.parse(fs.readFileSync(path.join(root,'assets/ppg-expanded/full_ppg_reference_v1.json')));
  r.test='cdd_full_ppg_reference';r.sourceHashes={model:'a8e26e25b852344814e4a474e73e92b9f8d40845c20948fdcce828c9e4f12fce',normalization:'bc8a28b7ca84faa00644fa7d13ae706705ecd47b9543296753273555be3aba41'};
  r.outputToleranceMmhg=.01;
  for(const w of r.windows)w.outputs=w.normalizedBeats.map((b,i)=>value(b.flat(),w.normalizedTiming[i]));
  return r;
}
async function execute(options={}) {
  let time=0,releases=0,calls=0;
  const r=options.reference||fixture();
  const report=await core.runExpanded({reference:r,mode:'full',now:()=>time,sleep:async ms=>{time+=ms;},
    createAdapter:async()=>({timings:{localTestDouble:true},run:async(x,t)=>{calls++;time+=3;return {values:value(x,t),inferenceMs:3};},release:async()=>{releases++;}}),...options});
  return {report,releases,calls};
}
const tests=[];const test=async(name,fn)=>{await fn();tests.push(name);console.log('PASS',name);};
(async()=>{
 await test('All 189 Python feature and normalized inputs, including all original 31, match exactly',async()=>{
   const r=fixture();core.validate(r);let n=0;
   for(const w of r.windows){const p=core.prepare(core.rotated(r.raw,w.offsetSamples),w,r.normalization);assert.equal(p.maxRaw,0);assert.equal(p.maxTiming,0);assert.equal(p.maxNormalized,0);n+=p.inputs.length;}
   assert.equal(n,189);
 });
 await test('All-candidate control flow runs 189 real-input test-double calls and releases once',async()=>{
   const {report:r,calls,releases}=await execute();assert.equal(calls,189);assert.equal(releases,1);assert.equal(r.passed,true);assert.equal(r.windows[0].outputs.length,31);assert.equal(r.windows.length,6);
 });
 await test('Five-minute fixed blocks: 10 windows, 310 calls, bounded 3750 sample buffer',async()=>{
   const {report:r}=await execute({mode:'blocks',durationSeconds:300});assert.equal(r.passed,true);assert.equal(r.successful,310);assert.equal(r.windows.length,10);assert.equal(r.maxBufferSamples,3750);assert.ok(r.totalWallMs>=300000);
 });
 await test('Five-minute rolling replay: 55 windows; all 1732 model calls; no hidden backlog',async()=>{
   const {report:r}=await execute({mode:'rolling',durationSeconds:300});assert.equal(r.passed,true);assert.equal(r.windows.length,55);assert.equal(r.successful,1732);assert.equal(r.deadlineMisses,0);assert.equal(r.maxBufferSamples,3750);
 });
 await test('20-minute scheduling is bounded and complete with accelerated test clock',async()=>{
   const {report:r}=await execute({mode:'blocks',durationSeconds:1200});assert.equal(r.windows.length,40);assert.equal(r.successful,1240);assert.equal(r.passed,true);
 });
 await test('Idle baseline makes no model session/calls and no inference-pass claim',async()=>{
   const {report:r,calls,releases}=await execute({mode:'idle',durationSeconds:30});assert.equal(r.passed,true);assert.equal(r.inferencePassed,null);assert.equal(calls,0);assert.equal(releases,0);
 });
 await test('Corrupt expected output fails parity; oracle is not used as inference input',async()=>{
   const r=fixture();r.windows[0].outputs[0][0]=Math.fround(r.windows[0].outputs[0][0]+100);
   const {report}=await execute({reference:r});assert.equal(report.passed,false);assert.equal(report.parityFailures,1);
 });
 await test('Corrupt late candidate 31 is detected, beyond old first-four coverage',async()=>{
   const r=fixture();r.windows[0].beats[30][0][80]=Math.fround(r.windows[0].beats[30][0][80]+1);
   const {report,releases,calls}=await execute({reference:r});assert.equal(report.passed,false);assert.equal(calls,0);assert.equal(releases,1);
 });
 await test('Cancellation terminates workload and releases session',async()=>{
   let n=0;const {report,releases}=await execute({shouldCancel:()=>++n>6});assert.equal(report.passed,false);assert.equal(report.cancelled,true);assert.equal(releases,1);
 });
 await test('Runtime failure releases; cleanup failure prevents pass',async()=>{
   let release=0;let {report}=await execute({createAdapter:async()=>({run:async()=>{throw new Error('injected');},release:async()=>{release++;}})});
   assert.equal(report.passed,false);assert.equal(release,1);
   ({report}=await execute({createAdapter:async()=>({run:async(x,t)=>({values:value(x,t),inferenceMs:3}),release:async()=>{throw new Error('release failed');}})}));
   assert.equal(report.passed,false);assert.match(report.cleanupFailure,/release failed/);
 });
 await test('Delayed sample arrivals stop instead of silently skipping/catching up',async()=>{
   let t=0;const {report:r,releases}=await execute({mode:'rolling',now:()=>t,sleep:async ms=>{t+=ms+1200;}});
   assert.equal(r.passed,false);assert.equal(r.deadlineMisses,1);assert.equal(releases,1);
 });
 await test('Malformed nonfinite fixture is refused before session creation',async()=>{
   const r=fixture();r.raw[0]=NaN;const {report,releases}=await execute({reference:r});assert.equal(report.passed,false);assert.equal(releases,0);
 });
 console.log(JSON.stringify({testsPassed:tests.length,pythonFeatureCandidates:189,modelExecution:'test double only; actual host ORT is tested separately by verify_bp_package.py',replayTiming:'accelerated clock; not physical elapsed performance'},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});

const test=require('node:test');const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {mkdtempSync,rmSync}=require('node:fs');const path=require('node:path');const {tmpdir}=require('node:os');
const {createResearchStore}=require('../../../services/recordings/calibrationStoreCore');
const cal=require('../../../services/bp-calibration-research/bpCalibration');
const context={userId:'P001',modelSha256:'a'.repeat(64),normalizationSha256:'b'.repeat(64),preprocessingVersion:'test',sensorId:'test',firmwareVersion:'test',sensorSite:'test',channelConfiguration:'test',samplingRateHz:125,resamplingVersion:'none',qualityPolicyVersion:'test',pairingProtocolVersion:'test'};
const now='2026-10-07T12:10:00.000Z';
function open(file){const db=new DatabaseSync(file);const store=createResearchStore({execAsync:async sql=>db.exec(sql),runAsync:async(sql,p)=>db.prepare(sql).run(...p),getAllAsync:async(sql,p)=>db.prepare(sql).all(...p)});return {db,store};}
function draft(participant='P001'){return {schemaVersion:1,kind:'cdd_cuff_reference_draft_v1',status:'unmatched',participantCode:participant,referenceId:'R1',recordingId:'REC1',cuffDeviceId:'CUFF1',source:'recorded',measuredAt:now,createdAt:now,units:'mmHg',cuff:{sbp:120,dbp:80}};}
function profile(id='A',minute=0){
 const time=n=>`2026-10-07T12:${String(minute+n).padStart(2,'0')}:00.000Z`;
 const pairs=[0,1].map(i=>({referenceId:id+i,sessionId:id,cuffDeviceId:'CUFF1',measuredAt:time(i),units:'mmHg',cuff:{sbp:120,dbp:80},accepted:true,
  recording:{schemaVersion:1,stage:'uncalibrated_recording',source:'recorded',recordingId:id+'rec'+i,context,startedAt:time(i),endedAt:time(i),estimate:{sbp:110,dbp:75},acceptedBeatCount:1,rejectedBeatCount:0,positiveWeightBeatCount:1}}));
 const result=cal.createCalibration({profileId:id,sessionId:id,context,now,pairs,policy:{version:'test-only',intervalDays:30,minPairs:2,maxPairGapMs:0,maxSessionSpanMs:120000}});
 assert.equal(result.ok,true,JSON.stringify(result));return result.value;
}
test('drafts persist after database restart, stay unmatched, and are isolated by participant',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'cdd-store-'));let connection;
 try{const file=path.join(dir,'test.sqlite');connection=open(file);await connection.store.init();
  await connection.store.saveDraft(draft());await connection.store.saveDraft(draft('P002'));
  await assert.rejects(connection.store.saveDraft({...draft(),cuff:{sbp:125,dbp:81}}),/UNIQUE/);
  connection.db.close();connection=open(file);await connection.store.init();
  assert.equal((await connection.store.listDrafts('P001')).length,1);
  assert.equal((await connection.store.listDrafts('P001'))[0].status,'unmatched');
  assert.equal((await connection.store.listDrafts('P001'))[0].cuff.sbp,120);
  assert.equal((await connection.store.getActiveProfile(context,now)).ok,false);
  await connection.store.deleteDraft('P001','R1');assert.equal((await connection.store.listDrafts('P001')).length,0);
  assert.equal((await connection.store.listDrafts('P002')).length,1);
 }finally{connection?.db.close();rmSync(dir,{recursive:true,force:true});}
});
test('profile validation, expiry, context mismatch and revocation are enforced',async()=>{
 const {db,store}=open(':memory:');try{await store.init();const first=profile('A',0),second=profile('B',3);
  await store.saveProfile(first);await store.saveProfile(second);
  assert.equal((await store.getActiveProfile(context,now)).value.profileId,'B');
  assert.equal((await store.getActiveProfile({...context,sensorId:'changed'},now)).ok,false);
  assert.equal((await store.getActiveProfile(context,'2026-12-01T00:00:00.000Z')).status,'stale');
  await assert.rejects(store.saveProfile({...first,offsets:{sbp:999,dbp:0}}));
  await store.revokeProfile('P001','B',now);
  assert.equal((await store.getActiveProfile(context,now)).status,'revoked');
  assert.equal((await store.getActiveProfile({...context,userId:'P002'},now)).ok,false);
 }finally{db.close();}
});
test('stored identity tampering and invalid cuff inputs fail closed',async()=>{
 const {db,store}=open(':memory:');try{await store.init();
  await assert.rejects(store.saveDraft({...draft(),measuredAt:'2027-01-01T00:00:00.000Z'}));
  await assert.rejects(store.saveDraft({...draft(),cuff:{sbp:70,dbp:80}}));
  await assert.rejects(store.saveDraft({...draft(),participantCode:"P001' OR 1=1"}));
  await store.saveDraft(draft());db.exec("UPDATE cdd_cuff_drafts_v1 SET reference_id='tampered'");
  await assert.rejects(store.listDrafts('P001'),/identity mismatch/);
 }finally{db.close();}
});

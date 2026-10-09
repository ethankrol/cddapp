'use strict';
// Local research persistence. Draft cuff readings never become active calibration automatically.
const calibration = require('../bp-calibration-research/bpCalibration');
const need=(ok,msg)=>{if(!ok)throw new Error(msg);};
const code=(value,label)=>need(typeof value==='string' && /^[A-Za-z0-9_-]{1,64}$/.test(value),label+' must be a short code, not a name or email.');
const utc=(s,label)=>{const t=Date.parse(s);need(Number.isFinite(t)&&new Date(t).toISOString()===s,label+' must be UTC ISO with milliseconds.');return t;};
const str=(s,label)=>need(typeof s==='string'&&s.trim().length>0&&s.length<=160,label+' is required (maximum 160 characters).');
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS cdd_cuff_drafts_v1 (
 participant_code TEXT NOT NULL, reference_id TEXT NOT NULL, recorded_at TEXT NOT NULL,
 payload TEXT NOT NULL, PRIMARY KEY (participant_code, reference_id)
);
CREATE TABLE IF NOT EXISTS cdd_calibration_profiles_v1 (
 user_id TEXT NOT NULL, profile_id TEXT NOT NULL, payload TEXT NOT NULL,
 revoked_at TEXT, PRIMARY KEY (user_id, profile_id)
);`;
function validateDraft(value) {
  need(value && typeof value==='object','Reference draft is required.');
  need(value.schemaVersion===1&&value.kind==='cdd_cuff_reference_draft_v1'&&value.status==='unmatched','Only unmatched reference drafts are accepted.');
  code(value.participantCode,'Participant code');code(value.referenceId,'Reference ID');
  str(value.recordingId,'Recording ID');str(value.cuffDeviceId,'Cuff device');
  need(['recorded','synthetic'].includes(value.source),'Declare recorded or synthetic source.');
  const measured=utc(value.measuredAt,'Measured time'),created=utc(value.createdAt,'Created time');
  need(measured<=created,'Measured time cannot be after the draft creation time.');
  need(value.units==='mmHg','Cuff units must be mmHg.');
  need(value.cuff&&Number.isFinite(value.cuff.sbp)&&Number.isFinite(value.cuff.dbp)&&value.cuff.sbp>value.cuff.dbp&&value.cuff.dbp>0,
    'Enter finite cuff readings with SBP greater than DBP and DBP above zero.');
  // Store only this explicit set of fields; no unbounded notes or imported waveform.
  return {schemaVersion:1,kind:'cdd_cuff_reference_draft_v1',status:'unmatched',
    participantCode:value.participantCode,referenceId:value.referenceId,recordingId:value.recordingId,
    cuffDeviceId:value.cuffDeviceId,source:value.source,measuredAt:value.measuredAt,createdAt:value.createdAt,
    units:'mmHg',cuff:{sbp:value.cuff.sbp,dbp:value.cuff.dbp}};
}
function createResearchStore(db) {
  return {
    async init() { await db.execAsync(SCHEMA_SQL); },
    async saveDraft(input) {
      const draft=validateDraft(input);
      await db.runAsync('INSERT INTO cdd_cuff_drafts_v1 (participant_code,reference_id,recorded_at,payload) VALUES (?,?,?,?)',
        [draft.participantCode,draft.referenceId,draft.measuredAt,JSON.stringify(draft)]);
      return draft;
    },
    async listDrafts(participantCode) {
      code(participantCode,'Participant code');
      const rows=await db.getAllAsync('SELECT participant_code,reference_id,payload FROM cdd_cuff_drafts_v1 WHERE participant_code=? ORDER BY recorded_at DESC,reference_id',[participantCode]);
      return rows.map(row=>{
        const draft=validateDraft(JSON.parse(row.payload));
        need(draft.participantCode===participantCode&&draft.participantCode===row.participant_code&&draft.referenceId===row.reference_id,'Stored draft identity mismatch.');
        return draft;
      });
    },
    async deleteDraft(participantCode,referenceId) {
      code(participantCode,'Participant code');code(referenceId,'Reference ID');
      await db.runAsync('DELETE FROM cdd_cuff_drafts_v1 WHERE participant_code=? AND reference_id=?',[participantCode,referenceId]);
    },
    async saveProfile(input) {
      const serialized=calibration.serializeProfile(input);
      need(serialized.ok,serialized.reason||'Invalid calibration profile.');
      const profile=JSON.parse(serialized.value);
      await db.runAsync('INSERT INTO cdd_calibration_profiles_v1 (user_id,profile_id,payload,revoked_at) VALUES (?,?,?,NULL)',
        [profile.context.userId,profile.profileId,serialized.value]);
      return profile;
    },
    async getActiveProfile(context,now) {
      str(context?.userId,'User ID');utc(now,'Current time');
      const rows=await db.getAllAsync('SELECT user_id,profile_id,payload,revoked_at FROM cdd_calibration_profiles_v1 WHERE user_id=?',[context.userId]);
      const profiles=rows.map(row=>{
        const result=calibration.deserializeProfile(row.payload);
        need(result.ok,result.reason||'Stored profile failed validation.');
        need(result.value.context.userId===row.user_id&&result.value.profileId===row.profile_id,'Stored profile identity mismatch.');
        return result.value;
      });
      // Select newest matching profile BEFORE checking revocation. Never fall back to an older correction.
      const selected=calibration.selectLatestCalibration(profiles,context,now);
      if(!selected.ok)return selected;
      const row=rows.find(r=>r.profile_id===selected.value.profileId);
      if(row.revoked_at!==null)return {ok:false,status:'revoked',reason:'The newest matching calibration was revoked. A new accepted session is required.'};
      return selected;
    },
    async revokeProfile(userId,profileId,now) {
      str(userId,'User ID');str(profileId,'Profile ID');utc(now,'Revocation time');
      await db.runAsync('UPDATE cdd_calibration_profiles_v1 SET revoked_at=? WHERE user_id=? AND profile_id=? AND revoked_at IS NULL',[now,userId,profileId]);
    },
  };
}
module.exports={SCHEMA_SQL,validateDraft,createResearchStore};

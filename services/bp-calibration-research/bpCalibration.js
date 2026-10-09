'use strict';

// Research-only arithmetic/state core. No clinical thresholds or sensor-quality
// algorithm are inferred here. No I/O, dependencies, model execution, or clocks.
const SCHEMA_VERSION = 1;
const DAY_MS = 86400000;
const CONTEXT_KEYS = [
  'userId', 'modelSha256', 'normalizationSha256', 'preprocessingVersion',
  'sensorId', 'firmwareVersion', 'sensorSite', 'channelConfiguration',
  'samplingRateHz', 'resamplingVersion', 'qualityPolicyVersion',
  'pairingProtocolVersion',
];
class Rejection extends Error {
  constructor(status, reason) { super(reason); this.status = status; }
}
function need(condition, status, reason) {
  if (!condition) throw new Rejection(status, reason);
}
function boundary(fn) {
  try { return { ok: true, value: fn() }; }
  catch (e) {
    if (e instanceof Rejection) return { ok: false, status: e.status, reason: e.message };
    throw e;
  }
}
function obj(v, label) {
  need(v !== null && typeof v === 'object' && !Array.isArray(v), 'invalid_input', label + ' must be an object.');
}
function str(v, label) {
  need(typeof v === 'string' && v.trim().length > 0, 'invalid_input', label + ' must be a nonempty string.');
}
function finite(v, label) {
  need(typeof v === 'number' && Number.isFinite(v), 'invalid_input', label + ' must be finite.');
}
function timestamp(v, label) {
  str(v, label);
  const n = Date.parse(v);
  need(Number.isFinite(n) && new Date(n).toISOString() === v, 'time_error', label + ' must be canonical UTC ISO, e.g. 2026-09-24T12:00:00.000Z.');
  return n;
}
function bp(v, label) {
  obj(v, label); finite(v.sbp, label + '.sbp'); finite(v.dbp, label + '.dbp');
  need(v.dbp > 0 && v.sbp > v.dbp, 'invalid_input', label + ' requires SBP > DBP > 0; values are not clamped.');
}
function context(v) {
  obj(v, 'context');
  for (const k of CONTEXT_KEYS) {
    if (k === 'samplingRateHz') {
      finite(v[k], k); need(v[k] > 0, 'invalid_input', k + ' must be positive.');
    } else str(v[k], k);
  }
  for (const k of ['modelSha256', 'normalizationSha256'])
    need(/^[0-9a-f]{64}$/.test(v[k]), 'invalid_input', k + ' must be a lowercase SHA-256 digest.');
}
function sameContext(a, b) {
  context(a); context(b);
  return CONTEXT_KEYS.every(k => a[k] === b[k]);
}
function copyContext(v) { return Object.fromEntries(CONTEXT_KEYS.map(k => [k, v[k]])); }
function weight(v) {
  const w = v === undefined ? 1 : v;
  finite(w, 'weight'); need(w >= 0, 'invalid_input', 'Weights cannot be negative.'); return w;
}
function weighted(rows, select, status) {
  const maxWeight = rows.reduce((m, r) => Math.max(m, r.weight), 0);
  need(maxWeight > 0, status, 'No positive accepted weight.');
  // Scale before summing to avoid overflow from large finite weights.
  const total = rows.reduce((s, r) => s + r.weight / maxWeight, 0);
  const result = { sbp: 0, dbp: 0 };
  for (const r of rows) {
    const v = select(r), w = (r.weight / maxWeight) / total;
    result.sbp += w * v.sbp; result.dbp += w * v.dbp;
  }
  finite(result.sbp, 'weighted SBP'); finite(result.dbp, 'weighted DBP'); return result;
}
function unique(ids, label) {
  ids.forEach(id => str(id, label));
  need(new Set(ids).size === ids.length, 'invalid_input', 'Duplicate ' + label + '.');
}
function recording(v, now) {
  obj(v, 'recording');
  need(v.schemaVersion === SCHEMA_VERSION && v.stage === 'uncalibrated_recording', 'already_processed', 'Expected an uncalibrated recording; calibration cannot be applied twice.');
  str(v.recordingId, 'recordingId'); context(v.context); bp(v.estimate, 'estimate');
  need(v.source === 'recorded' || v.source === 'synthetic', 'invalid_input', 'Unknown recording source.');
  const start = timestamp(v.startedAt, 'startedAt'), end = timestamp(v.endedAt, 'endedAt');
  need(start <= end && end <= now, 'time_error', 'Recording times are reversed or in the future.');
  for (const k of ['acceptedBeatCount', 'rejectedBeatCount', 'positiveWeightBeatCount'])
    need(Number.isInteger(v[k]) && v[k] >= 0, 'invalid_input', 'Invalid ' + k + '.');
  need(v.positiveWeightBeatCount > 0 && v.acceptedBeatCount >= v.positiveWeightBeatCount, 'insufficient_signal', 'No accepted, positively weighted beats.');
}
function policy(v) {
  obj(v, 'policy'); str(v.version, 'policy.version');
  finite(v.intervalDays, 'intervalDays');
  need(v.intervalDays > 0, 'invalid_input', 'intervalDays must be positive.');
  need(Number.isInteger(v.minPairs) && v.minPairs >= 2, 'invalid_input', 'At least two distinct cuff/prediction pairs are required by this research implementation.');
  finite(v.maxPairGapMs, 'maxPairGapMs');
  need(v.maxPairGapMs >= 0, 'invalid_input', 'Specify the pairing protocol time limit; no clinical default is assumed.');
  finite(v.maxSessionSpanMs, 'maxSessionSpanMs');
  need(v.maxSessionSpanMs >= 0, 'invalid_input', 'Specify the maximum duration of one calibration session; no clinical default is assumed.');
}

function aggregatePrediction(input) {
  return boundary(() => {
    obj(input, 'input'); const now = timestamp(input.now, 'now'); context(input.context);
    str(input.recordingId, 'recordingId');
    need(Array.isArray(input.beats), 'invalid_input', 'beats must be an array.');
    unique(input.beats.map(b => { obj(b, 'beat'); return b.beatId; }), 'beatId');
    const accepted = [];
    for (const b of input.beats) {
      need(typeof b.accepted === 'boolean', 'invalid_input', 'Each beat needs an explicit quality decision.');
      const w = weight(b.weight);
      if (b.accepted) { bp(b, 'accepted beat'); accepted.push({ ...b, weight: w }); }
      else str(b.rejectionReason, 'rejectionReason');
    }
    const result = {
      schemaVersion: SCHEMA_VERSION, stage: 'uncalibrated_recording',
      source: input.source, recordingId: input.recordingId, context: copyContext(input.context),
      startedAt: input.startedAt, endedAt: input.endedAt,
      estimate: weighted(accepted, b => b, 'insufficient_signal'),
      acceptedBeatCount: accepted.length,
      rejectedBeatCount: input.beats.length - accepted.length,
      positiveWeightBeatCount: accepted.filter(b => b.weight > 0).length,
    };
    recording(result, now); return result;
  });
}

function buildProfile(input) {
  obj(input, 'input'); str(input.profileId, 'profileId'); str(input.sessionId, 'sessionId'); context(input.context); policy(input.policy);
  const now = timestamp(input.now, 'now');
  need(Array.isArray(input.pairs), 'invalid_input', 'pairs must be an array.');
  const rows = [], storedPairs = [];
  unique(input.pairs.map(p => { obj(p, 'pair'); return p.referenceId; }), 'referenceId');
  unique(input.pairs.map(p => p.recording && p.recording.recordingId), 'calibration recordingId');
  let calibrationTime = -Infinity, sessionStart = Infinity;
  for (const p of input.pairs) {
    str(p.sessionId, 'pair.sessionId');
    need(p.sessionId === input.sessionId, 'incompatible', 'All calibration references must belong to this one session.');
    str(p.cuffDeviceId, 'cuffDeviceId'); bp(p.cuff, 'cuff');
    need(p.units === 'mmHg', 'invalid_input', 'Reference units must be mmHg.');
    need(typeof p.accepted === 'boolean', 'invalid_input', 'Each pair needs an explicit acceptance decision.');
    const w = weight(p.weight), measured = timestamp(p.measuredAt, 'measuredAt');
    recording(p.recording, now);
    need(p.recording.source === 'recorded', 'synthetic_excluded', 'Synthetic input cannot create personal calibration.');
    need(sameContext(p.recording.context, input.context), 'incompatible', 'Pair and profile user/model/preprocessing/sensor identities differ.');
    need(measured <= now, 'time_error', 'Cuff timestamp is in the future.');
    const start = timestamp(p.recording.startedAt, 'startedAt'), end = timestamp(p.recording.endedAt, 'endedAt');
    const gap = Math.max(start - measured, measured - end, 0);
    if (p.accepted) {
      need(gap <= input.policy.maxPairGapMs, 'time_error', 'Accepted cuff/recording pair exceeds the specified pairing window.');
      if (w > 0) {
        const residual = { sbp: p.cuff.sbp - p.recording.estimate.sbp, dbp: p.cuff.dbp - p.recording.estimate.dbp };
        finite(residual.sbp, 'SBP residual'); finite(residual.dbp, 'DBP residual');
        rows.push({ weight: w, residual }); calibrationTime = Math.max(calibrationTime, measured, end);
        sessionStart = Math.min(sessionStart, measured, start);
      }
    } else str(p.rejectionReason, 'pair rejectionReason');
    storedPairs.push({
      referenceId: p.referenceId, sessionId: p.sessionId, cuffDeviceId: p.cuffDeviceId, measuredAt: p.measuredAt,
      units: 'mmHg', cuff: { sbp: p.cuff.sbp, dbp: p.cuff.dbp }, weight: w,
      accepted: p.accepted, rejectionReason: p.accepted ? null : p.rejectionReason,
      recording: JSON.parse(JSON.stringify(p.recording)),
    });
  }
  need(rows.length >= input.policy.minPairs, 'insufficient_calibration', 'Too few distinct, accepted cuff pairs with positive weights.');
  need(calibrationTime - sessionStart <= input.policy.maxSessionSpanMs, 'time_error', 'Accepted references exceed the specified single-session duration.');
  const expires = calibrationTime + input.policy.intervalDays * DAY_MS;
  need(Number.isFinite(expires) && expires <= 8640000000000000, 'time_error', 'Expiry exceeds the timestamp range.');
  need(now < expires, 'stale', 'Calibration is already stale at creation.');
  if (input.supersedesProfileId != null) {
    str(input.supersedesProfileId, 'supersedesProfileId');
    need(input.supersedesProfileId !== input.profileId, 'invalid_input', 'A profile cannot supersede itself.');
  }
  return {
    schemaVersion: SCHEMA_VERSION, kind: 'research_calibration_profile', method: 'per_output_offset_v1',
    profileId: input.profileId, sessionId: input.sessionId, profileRevision: 1, status: 'accepted',
    createdAt: input.now, calibratedAt: new Date(calibrationTime).toISOString(), expiresAt: new Date(expires).toISOString(),
    context: copyContext(input.context), policy: { ...input.policy },
    offsets: weighted(rows, r => r.residual, 'insufficient_calibration'),
    pairs: storedPairs, acceptedPairCount: rows.length,
    supersedesProfileId: input.supersedesProfileId || null,
  };
}
function createCalibration(input) { return boundary(() => buildProfile(input)); }

function validateProfile(p) {
  obj(p, 'profile');
  need(p.schemaVersion === SCHEMA_VERSION && p.kind === 'research_calibration_profile' && p.method === 'per_output_offset_v1' && p.profileRevision === 1,
    'invalid_profile', 'Unsupported profile schema, method, or revision.');
  need(p.status === 'accepted', 'invalid_profile', 'This profile is not accepted. Keep invalidation/activation records in the app storage layer.');
  const rebuilt = buildProfile({ profileId: p.profileId, sessionId: p.sessionId, now: p.createdAt, context: p.context, policy: p.policy, pairs: p.pairs, supersedesProfileId: p.supersedesProfileId });
  for (const k of ['calibratedAt', 'expiresAt', 'acceptedPairCount'])
    need(p[k] === rebuilt[k], 'invalid_profile', 'Profile ' + k + ' disagrees with its references/policy.');
  obj(p.offsets, 'offsets');
  for (const k of ['sbp', 'dbp'])
    need(p.offsets[k] === rebuilt.offsets[k], 'invalid_profile', 'Stored offsets disagree with reference arithmetic.');
  return rebuilt;
}

function checkActive(profile, now) {
  need(timestamp(profile.createdAt, 'createdAt') <= now && timestamp(profile.calibratedAt, 'calibratedAt') <= now, 'time_error', 'Profile timestamps are in the future.');
  need(now < timestamp(profile.expiresAt, 'expiresAt'), 'stale', 'Calibration reached its research-policy expiry; a current corrected result is withheld.');
}
function selectLatestCalibration(profiles, wantedContext, nowUtc) {
  return boundary(() => {
    context(wantedContext); const now = timestamp(nowUtc, 'now');
    need(Array.isArray(profiles), 'invalid_input', 'profiles must be an array.');
    need(profiles.length > 0, 'calibration_required', 'No calibration profiles.');
    const validated = profiles.map(validateProfile);
    unique(validated.map(p => p.profileId), 'profileId');
    const candidates = validated.filter(p => sameContext(p.context, wantedContext));
    need(candidates.length > 0, 'incompatible', 'No profile matches this user/model/preprocessing/sensor context.');
    candidates.sort((a, b) => Date.parse(b.calibratedAt) - Date.parse(a.calibratedAt));
    need(candidates.length === 1 || candidates[0].calibratedAt !== candidates[1].calibratedAt, 'profile_conflict', 'Newest session time is tied; resolve activation in storage.');
    checkActive(candidates[0], now); return candidates[0];
  });
}

function applyCalibration(estimate, profile, wantedContext, nowUtc) {
  return boundary(() => {
    const now = timestamp(nowUtc, 'now'); context(wantedContext); recording(estimate, now);
    need(estimate.source === 'recorded', 'synthetic_excluded', 'Synthetic smoke-test output cannot become a calibrated personal result.');
    need(sameContext(estimate.context, wantedContext), 'incompatible', 'Recording does not match the active user/model/sensor context.');
    need(profile != null, 'calibration_required', 'A compatible calibration is required.');
    const p = validateProfile(profile);
    need(sameContext(p.context, wantedContext), 'incompatible', 'Calibration identities do not match this recording.');
    checkActive(p, now);
    need(timestamp(estimate.startedAt, 'startedAt') >= timestamp(p.calibratedAt, 'calibratedAt'), 'time_error', 'Current recording predates calibration.');
    need(!p.pairs.some(pair => pair.recording.recordingId === estimate.recordingId), 'reference_reuse', 'A calibration reference recording cannot also be a prospective calibrated prediction.');
    const corrected = { sbp: estimate.estimate.sbp + p.offsets.sbp, dbp: estimate.estimate.dbp + p.offsets.dbp };
    bp(corrected, 'corrected estimate');
    return {
      schemaVersion: SCHEMA_VERSION, stage: 'calibrated_research_result', source: 'recorded',
      recordingId: estimate.recordingId, startedAt: estimate.startedAt, endedAt: estimate.endedAt,
      context: copyContext(wantedContext), uncalibratedEstimate: { ...estimate.estimate },
      calibratedEstimate: corrected, calibrationProfileId: p.profileId, calibrationProfileRevision: p.profileRevision,
      calibrationAgeDays: (now - Date.parse(p.calibratedAt)) / DAY_MS,
      calibrationStatus: 'active_under_research_policy', appliedAt: nowUtc,
      acceptedBeatCount: estimate.acceptedBeatCount, rejectedBeatCount: estimate.rejectedBeatCount,
    };
  });
}
function serializeProfile(p) { return boundary(() => JSON.stringify(validateProfile(p))); }
function deserializeProfile(json) {
  return boundary(() => {
    str(json, 'profile JSON');
    let parsed; try { parsed = JSON.parse(json); } catch (_) { throw new Rejection('invalid_profile', 'Invalid JSON.'); }
    return validateProfile(parsed);
  });
}

module.exports = { SCHEMA_VERSION, aggregatePrediction, createCalibration, selectLatestCalibration, applyCalibration, serializeProfile, deserializeProfile };

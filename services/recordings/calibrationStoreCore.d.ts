import type { CalibrationProfile, Context, Result } from '../bp-calibration-research/bpCalibration';
export type CuffDraft = {
  schemaVersion: 1; kind: 'cdd_cuff_reference_draft_v1'; status: 'unmatched';
  participantCode: string; referenceId: string; recordingId: string; cuffDeviceId: string;
  source: 'recorded' | 'synthetic'; measuredAt: string; createdAt: string; units: 'mmHg';
  cuff: {sbp: number; dbp: number};
};
export type DatabaseAdapter = {
  execAsync(sql: string): Promise<unknown>;
  runAsync(sql: string, params: (string | number | null)[]): Promise<unknown>;
  getAllAsync(sql: string, params: (string | number | null)[]): Promise<{[key: string]: string | null}[]>;
};
export type ResearchStore = {
  init(): Promise<void>;
  saveDraft(draft: CuffDraft): Promise<CuffDraft>;
  listDrafts(participantCode: string): Promise<CuffDraft[]>;
  deleteDraft(participantCode: string, referenceId: string): Promise<void>;
  saveProfile(profile: CalibrationProfile): Promise<CalibrationProfile>;
  getActiveProfile(context: Context, now: string): Promise<Result<CalibrationProfile> | {ok: false; status: 'revoked'; reason: string}>;
  revokeProfile(userId: string, profileId: string, now: string): Promise<void>;
};
export const SCHEMA_SQL: string;
export function validateDraft(value: unknown): CuffDraft;
export function createResearchStore(db: DatabaseAdapter): ResearchStore;

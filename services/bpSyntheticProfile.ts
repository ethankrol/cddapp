import type { ProfileOptions, SyntheticProfile } from './bpSyntheticProfile.types';

export async function runBpSyntheticProfile(_options: ProfileOptions): Promise<SyntheticProfile> {
  throw new Error('Use the installed iPhone build. Browser profiling is not configured.');
}

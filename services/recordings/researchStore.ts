import type { ResearchStore } from './calibrationStoreCore';
export async function getResearchStore(): Promise<ResearchStore> {
  throw new Error('Use the installed iPhone app for local cuff-reference storage.');
}

import type { ExpandedMode, ExpandedReport, Progress } from './bpExpandedCore';
export async function runExpandedPhone(_mode: ExpandedMode, _duration: number,
  _cancel: () => boolean, _progress: (value: Progress) => void): Promise<ExpandedReport> {
  throw new Error('Use the installed iPhone app.');
}

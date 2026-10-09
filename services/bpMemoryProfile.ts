import type { MemoryOptions, MemoryReport } from './bpMemoryProtocol';
export async function runBpMemoryProfile(_options: MemoryOptions): Promise<MemoryReport> {
  throw new Error('The automated memory test requires a rebuilt app on a physical iPhone.');
}

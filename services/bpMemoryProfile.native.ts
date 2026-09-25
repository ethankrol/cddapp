import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';
import { runBpSyntheticProfile } from './bpSyntheticProfile';
import { runMemoryProtocol, type MemoryOptions, type MemoryReport } from './bpMemoryProtocol';

export async function runBpMemoryProfile(options: MemoryOptions): Promise<MemoryReport> {
  if (Platform.OS !== 'ios') throw new Error('Use the installed app on your physical iPhone.');
  const sampler = requireOptionalNativeModule('CDDMemoryProbe');
  if (!sampler) throw new Error('Native memory sampler is missing. Run pod install and rebuild/install the iOS app once.');
  return runMemoryProtocol({ sampler, runProfile: runBpSyntheticProfile }, {
    ...options, metadata: { platform: Platform.OS, osVersion: String(Platform.Version),
      developmentBuild: __DEV__, ...require('./bpMemoryProfile.install.json') },
  });
}

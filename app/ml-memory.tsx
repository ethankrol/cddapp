import { Stack } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { runBpMemoryProfile } from '../services/bpMemoryProfile';
import { memorySummaryForSharing, type MemoryReport } from '../services/bpMemoryProtocol';

export default function MlMemoryScreen() {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<MemoryReport | null>(null);
  const mounted = useRef(true), running = useRef(false), stop = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const listener = AppState.addEventListener('change', state => { if (state !== 'active') stop.current = true; });
    return () => { mounted.current = false; stop.current = true; listener.remove(); };
  }, []);
  async function run() {
    if (running.current) return;
    running.current = true; stop.current = false;
    setBusy(true); setResult(null); setError('');
    try {
      const report = await runBpMemoryProfile({
        shouldStop: () => stop.current || !mounted.current,
        onProgress: value => { if (mounted.current) setProgress(value); },
      });
      if (mounted.current) setResult(report);
    } catch (err) { if (mounted.current) setError(err instanceof Error ? err.message : String(err)); }
    finally { running.current = false; if (mounted.current) setBusy(false); }
  }
  const mb = (value: number | null) => value === null ? 'not measured' : `${(value / 1000000).toFixed(2)} MB`;
  return <>
    <Stack.Screen options={{ title: 'Automatic memory test', headerShown: true, gestureEnabled: !busy, headerBackVisible: !busy }} />
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.title}>Five cycles, one tap</Text>
      <Text style={styles.notice}>Synthetic software test. No health reading or health-journal entry.</Text>
      <Text style={styles.body}>The app records a two-second baseline, runs five synthetic benchmarks and waits ten seconds after each model session is released. Usually about a minute. Keep this screen open.</Text>
      <Text style={styles.body}>For a fresh baseline, close and reopen the app first, then come here without running either earlier test. Memory includes the whole app and this recorder.</Text>
      {__DEV__ && <Text style={styles.notice}>Development build: use Release for your recorded results.</Text>}
      <Pressable accessibilityRole="button" style={styles.button} disabled={busy || Platform.OS !== 'ios'} onPress={run}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Run automated memory test</Text>}
      </Pressable>
      {busy && <><Text style={styles.body}>{progress}</Text><Pressable accessibilityRole="button" onPress={() => { stop.current = true; }}><Text style={styles.cancel}>Stop after current operation</Text></Pressable></>}
      {!!error && <Text style={styles.error}>{error}</Text>}
      {result && <View style={styles.card}>
        <Text style={styles.title}>{result.complete ? 'Completed — memory captured' : result.cancelled ? 'Cancelled — partial report' : 'Incomplete — check report'}</Text>
        <Text style={styles.body}>All five inference cycles passed: {result.inferencePassed ? 'yes' : 'no'}. Memory trace complete: {result.memorySamplingComplete ? 'yes' : 'no'}.</Text>
        {result.summary && <>
          <Text selectable style={styles.body}>Baseline: {mb(result.summary.baselineMedianBytes)}</Text>
          <Text selectable style={styles.body}>Highest observed sample: {mb(result.summary.observedPeakBytes)}</Text>
          {result.summary.cycles.map(row => <View key={row.cycle} style={styles.row}>
            <Text style={styles.body}>Cycle {row.cycle}</Text>
            <Text selectable style={styles.body}>Observed peak: {mb(row.observedPeakBytes)}</Text>
            <Text selectable style={styles.body}>After ten-second wait: {mb(row.settledMedianBytes)}</Text>
          </View>)}
          <Text selectable style={styles.body}>Final settled minus first settled: {mb(result.summary.finalSettledMinusFirstSettledBytes)}</Text>
        </>}
        {result.failure && <Text style={styles.error}>{result.failure}</Text>}
        <Text style={styles.body}>This records memory use; it does not automatically diagnose a leak. Sampling can miss brief peaks.</Text>
        <Pressable accessibilityRole="button" style={styles.button} onPress={async () => {
          try { await Share.share({ message: JSON.stringify(memorySummaryForSharing(result), null, 2), title: 'CDD automatic memory summary' }); }
          catch (err) { setError(err instanceof Error ? err.message : String(err)); }
        }}><Text style={styles.buttonText}>Share summary JSON</Text></Pressable>
        <Pressable accessibilityRole="button" style={styles.button} onPress={async () => {
          try { await Share.share({ message: JSON.stringify(result, null, 2), title: 'CDD full memory trace' }); }
          catch (err) { setError(err instanceof Error ? err.message : String(err)); }
        }}><Text style={styles.buttonText}>Share full trace JSON</Text></Pressable>
      </View>}
      <Text style={styles.body}>Memory is sampled every 50 ms on iOS. Values use decimal MB; the JSON stores bytes. This instrumented test is separate from the earlier inference-only timing runs.</Text>
    </ScrollView>
  </>;
}

const styles = StyleSheet.create({
  page: { padding: 20, paddingBottom: 48, gap: 16, backgroundColor: '#f6f8fa' },
  title: { fontSize: 23, fontWeight: '700', color: '#172b3a' },
  body: { fontSize: 15, lineHeight: 23, color: '#435466' },
  notice: { padding: 14, backgroundColor: '#fff2c6', color: '#614b0a', borderRadius: 12, fontSize: 15 },
  button: { padding: 18, backgroundColor: '#184b66', borderRadius: 12, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  cancel: { color: '#184b66', paddingVertical: 14, fontSize: 16 },
  error: { color: '#b91c1c', fontSize: 15, lineHeight: 23 },
  card: { padding: 16, gap: 16, backgroundColor: '#fff', borderRadius: 12 },
  row: { borderTopWidth: 1, borderTopColor: '#dde3e8', paddingTop: 10 },
});

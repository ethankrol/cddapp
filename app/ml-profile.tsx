import { Link, Stack, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { runBpSyntheticProfile } from '../services/bpSyntheticProfile';
import type { SyntheticProfile } from '../services/bpSyntheticProfile.types';

export default function MlProfileScreen() {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<SyntheticProfile | null>(null);
  const mounted = useRef(true); const running = useRef(false); const stop = useRef(false);
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
      const report = await runBpSyntheticProfile({
        shouldStop: () => stop.current || !mounted.current,
        onProgress: value => { if (mounted.current) setProgress(value); },
      });
      if (mounted.current) setResult(report);
    } catch (err) { if (mounted.current) setError(err instanceof Error ? err.message : String(err)); }
    finally { running.current = false; if (mounted.current) setBusy(false); }
  }
  const ms = (value: number | null) => value === null ? 'not measured' : `${value.toFixed(2)} ms`;
  return <>
    <Stack.Screen options={{ title: 'Synthetic model profile', headerShown: true, gestureEnabled: !busy, headerBackVisible: !busy }} />
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.title}>Synthetic inference benchmark</Text>
      <Text style={styles.notice}>Software test only. No health reading or health-journal entry.</Text>
      <Text style={styles.body}>Fresh session, one first call, 10 warm-up calls, then 100 measured calls. Every output must match the bundled Python reference within 0.01 mmHg.</Text>
      <Text style={styles.body}>For memory measurements, fully close and reopen the app first. Open this page without running the original synthetic test.</Text>
      {__DEV__ && <Text style={styles.notice}>Development build: use a Release build for reported performance.</Text>}
      <Pressable accessibilityRole="button" style={styles.button} disabled={busy || Platform.OS !== 'ios'} onPress={run}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Run 100-call benchmark</Text>}
      </Pressable>
      <Link href={"/ml-memory" as Href} asChild>
        <Pressable accessibilityRole="button" disabled={busy} style={styles.button}>
          <Text style={styles.buttonText}>Automated memory test</Text>
        </Pressable>
      </Link>
      {busy && <><Text style={styles.body}>{progress}</Text><Pressable accessibilityRole="button" onPress={() => { stop.current = true; }}><Text style={styles.cancel}>Stop after current call</Text></Pressable></>}
      {!!error && <Text style={styles.error}>{error}</Text>}
      {result && <View style={styles.card}>
        <Text style={styles.title}>{result.passed ? 'PASS — all 111 calls match' : result.cancelled ? 'CANCELLED — incomplete' : 'FAIL / incomplete'}</Text>
        {[
          ['Runtime import', result.importMs], ['Asset resolution', result.assetResolveMs],
          ['Model session creation', result.sessionCreateMs], ['First inference', result.firstInferenceMs],
          ['Work to first result', result.firstResultWallMs], ['Session release', result.releaseMs],
        ].map(([label, value]) => <Text key={String(label)} selectable style={styles.body}>{label}: {ms(value as number | null)}</Text>)}
        {result.latency && <>
          <Text style={styles.body}>Measured calls: {result.latency.count}/100</Text>
          <Text selectable style={styles.body}>p50: {ms(result.latency.p50)} · p95: {ms(result.latency.p95)}</Text>
          <Text selectable style={styles.body}>Mean: {ms(result.latency.mean)} · Maximum: {ms(result.latency.max)}</Text>
        </>}
        <Text style={styles.body}>Successful calls: {result.successful}/{result.attempted}. Parity failures: {result.parityFailures}. Runtime failures: {result.runtimeFailures}.</Text>
        <Text selectable style={styles.body}>Maximum SBP / DBP difference: {result.maxDifferenceMmhg.SBP.toFixed(6)} / {result.maxDifferenceMmhg.DBP.toFixed(6)} mmHg</Text>
        {result.failure && <Text style={styles.error}>{result.failure}</Text>}
        <Pressable accessibilityRole="button" style={styles.button} onPress={async () => {
          try { await Share.share({ message: JSON.stringify(result, null, 2), title: 'CDD synthetic model profile' }); }
          catch (err) { setError(err instanceof Error ? err.message : String(err)); }
        }}><Text style={styles.buttonText}>Share JSON report</Text></Pressable>
      </View>}
      <Text style={styles.body}>Inference timing includes the JavaScript/native call boundary. It excludes tensor preparation, output checks, model loading, and UI rendering. Fresh session creation does not mean a cold OS file cache. Memory, battery, and app launch require separate measurements.</Text>
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
});

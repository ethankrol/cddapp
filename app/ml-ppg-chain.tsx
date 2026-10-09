import { Stack } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { runPpgChain } from '../services/bpPpgChain';
import type { PpgChainReport } from '../services/bpPpgChainCore';

export default function PpgChainScreen() {
  const [report, setReport] = useState<PpgChainReport | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const mounted = useRef(true), running = useRef(false), cancelled = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener('change', state => {
      if (running.current && state !== 'active') cancelled.current = true;
    });
    return () => {
      mounted.current = false; cancelled.current = true; subscription.remove();
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);
  function run() {
    if (running.current || Platform.OS !== 'ios') return;
    running.current = true; cancelled.current = false;
    setBusy(true); setReport(null); setError('');
    timer.current = setTimeout(() => {
      timer.current = null;
      void (async () => {
        try {
          const next = await runPpgChain(() => cancelled.current || !mounted.current || AppState.currentState !== 'active');
          if (mounted.current) setReport({ ...next, platform: Platform.OS,
            osVersion: String(Platform.Version), developmentBuild: __DEV__,
            jsEngine: (globalThis as typeof globalThis & { HermesInternal?: unknown }).HermesInternal ? 'Hermes' : 'other' });
        } catch (err) { if (mounted.current) setError(err instanceof Error ? err.message : String(err)); }
        finally { running.current = false; if (mounted.current) setBusy(false); }
      })();
    }, 0);
  }
  async function share() {
    if (!report) return;
    try { await Share.share({message: JSON.stringify(report, null, 2)}); }
    catch (err) { if (mounted.current) setError(err instanceof Error ? err.message : String(err)); }
  }
  const status = (value: boolean | undefined) => value === undefined ? 'Not run' : value ? 'PASS' : 'FAIL';
  return <>
    <Stack.Screen options={{title: 'Raw PPG Model Test', headerShown: true}} />
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.notice}>
        <Text style={styles.noticeTitle}>SYNTHETIC SOFTWARE TEST</Text>
        <Text style={styles.body}>Generated PPG and model outputs for software verification. These numbers are not your blood pressure.</Text>
      </View>
      <Text style={styles.title}>Test the connected signal path</Text>
      <Text style={styles.body}>Process a 30-second synthetic recording, normalize its first four beat inputs, and run the existing model. Compare each stage with the saved Python references.</Text>
      <Pressable accessibilityRole="button" onPress={run} disabled={busy || Platform.OS !== 'ios'}
        style={[styles.button, (busy || Platform.OS !== 'ios') && styles.disabled]}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Run connected test</Text>}
      </Pressable>
      {Platform.OS !== 'ios' && <Text style={styles.error}>Use the installed iPhone app.</Text>}
      {!!error && <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>}
      {report && <View style={styles.card}>
        <Text accessibilityLiveRegion="polite" style={[styles.status, {color: report.passed ? '#166534' : '#b91c1c'}]}>
          {report.cancelled ? 'CANCELLED' : report.passed ? 'PASS — connected path matches' : 'FAIL — inspect stage results'}
        </Text>
        <Text style={styles.body}>Preprocessing: {status(report.preprocessing?.passed)}</Text>
        <Text style={styles.body}>Normalization: {status(report.normalization?.passed)}</Text>
        <Text style={styles.body}>Inference: {report.successful}/4 completed; {report.parityFailures} comparison failures</Text>
        {report.preprocessing && <Text style={styles.body}>Candidates: {report.preprocessing.candidateCount}; first four checked. Preprocessing: {report.preprocessing.preprocessingMs.toFixed(1)} ms.</Text>}
        {report.normalization && <Text style={styles.body}>Maximum normalized differences: channels {report.normalization.maxBeatDifference.toExponential(3)}, timing {report.normalization.maxTimingDifference.toExponential(3)}.</Text>}
        {report.outputs.map(row => <View key={row.candidate} style={styles.row}>
          <Text style={styles.rowTitle}>Synthetic candidate {row.candidate} — {row.passed ? 'PASS' : 'FAIL'}</Text>
          <Text style={styles.body}>Phone: {row.phone[0].toFixed(4)} / {row.phone[1].toFixed(4)} mmHg</Text>
          <Text style={styles.body}>Reference: {row.reference[0].toFixed(4)} / {row.reference[1].toFixed(4)} mmHg</Text>
          <Text style={styles.body}>Difference: {row.differenceMmhg[0].toExponential(3)} / {row.differenceMmhg[1].toExponential(3)} mmHg</Text>
        </View>)}
        <Text style={styles.body}>Allowed output difference: 0.01 mmHg per output. Total test-call time: {report.totalWallMs.toFixed(1)} ms, including comparisons and session setup/release.</Text>
        {!!report.failure && <Text style={styles.error}>{report.failure.phase}: {report.failure.message}</Text>}
        {!!report.cleanupFailure && <Text style={styles.error}>Resource cleanup: {report.cleanupFailure}</Text>}
        <Pressable accessibilityRole="button" onPress={share} style={styles.button}>
          <Text style={styles.buttonText}>Share test report</Text>
        </Pressable>
      </View>}
      <Text style={styles.footnote}>This checks four synthetic beat outputs. Signal quality, calibration, recording-level aggregation, wearable transfer and BP accuracy remain separate work. Nothing is saved to your health journal.</Text>
    </ScrollView>
  </>;
}
const styles = StyleSheet.create({
  content: {padding: 20, paddingBottom: 50, flexGrow: 1, backgroundColor: '#f6f8fa'},
  notice: {padding: 16, borderRadius: 12, backgroundColor: '#fff2c6', marginBottom: 22},
  noticeTitle: {color: '#705300', fontSize: 13, fontWeight: '800'},
  title: {fontSize: 25, fontWeight: '700', color: '#172b3a', marginBottom: 12},
  body: {color: '#435466', fontSize: 15, lineHeight: 23, marginTop: 8},
  button: {backgroundColor: '#184b66', padding: 18, marginTop: 22, borderRadius: 12, alignItems: 'center'},
  buttonText: {color: '#fff', fontSize: 17, fontWeight: '700'}, disabled: {opacity: 0.5},
  error: {color: '#b91c1c', marginTop: 18, fontSize: 15},
  card: {padding: 16, borderRadius: 14, marginTop: 20, backgroundColor: '#fff'},
  status: {fontSize: 20, fontWeight: '700'},
  row: {paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eef1f3'},
  rowTitle: {fontSize: 15, fontWeight: '700', color: '#172b3a'},
  footnote: {color: '#596978', fontSize: 13, lineHeight: 20, marginTop: 24},
});

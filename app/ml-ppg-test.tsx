import { Stack } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { runFixture, type PpgFixtureResult } from '../services/bpPpgPreprocess';

const fixture = require('../assets/ppg-reference/synthetic_ppg_reference.json');
const provenance = require('../assets/ppg-reference/provenance.json');
type PhoneResult = PpgFixtureResult & {
  startedAt: string; finishedAt: string; platform: string; osVersion: string;
  developmentBuild: boolean; jsEngine: string; provenance: typeof provenance;
  sourceDigestVerification: string;
};

export default function PpgPreprocessingTest() {
  const [report, setReport] = useState<PhoneResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true), running = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; if (timer.current !== null) clearTimeout(timer.current); };
  }, []);

  function run() {
    if (running.current || Platform.OS !== 'ios') return;
    running.current = true;
    setBusy(true); setError(''); setReport(null);
    timer.current = setTimeout(() => {
      timer.current = null;
      try {
        if (AppState.currentState !== 'active') throw new Error('Bring the app to the foreground and retry.');
        const startedAt = new Date().toISOString();
        const result = runFixture(fixture);
        const engine = (globalThis as typeof globalThis & { HermesInternal?: unknown }).HermesInternal;
        const next: PhoneResult = { ...result, startedAt, finishedAt: new Date().toISOString(),
          platform: Platform.OS, osVersion: String(Platform.Version), developmentBuild: __DEV__,
          jsEngine: engine ? 'Hermes' : 'other', provenance,
          sourceDigestVerification: 'Installer verified bundled source/fixture hashes; not runtime attestation.' };
        if (mounted.current) setReport(next);
      } catch (err) {
        if (mounted.current) setError(err instanceof Error ? err.message : String(err));
      } finally {
        running.current = false;
        if (mounted.current) setBusy(false);
      }
    }, 0);
  }

  async function share() {
    if (!report) return;
    try { await Share.share({ message: JSON.stringify(report, null, 2) }); }
    catch (err) { if (mounted.current) setError(err instanceof Error ? err.message : String(err)); }
  }

  return (
    <>
      <Stack.Screen options={{ title: 'PPG Preprocessing Test', headerShown: true }} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>SYNTHETIC SOFTWARE TEST</Text>
          <Text style={styles.body}>This test uses generated PPG. It does not measure or predict your blood pressure.</Text>
        </View>
        <Text style={styles.title}>Process raw PPG on your phone</Text>
        <Text style={styles.body}>Filter a 30-second generated signal, detect peaks, and construct three-channel beat inputs. Compare the first four inputs and their timing features with the saved Python reference.</Text>
        <Pressable accessibilityRole="button" disabled={busy || Platform.OS !== 'ios'} onPress={run}
          style={[styles.button, (busy || Platform.OS !== 'ios') && styles.disabled]}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Run preprocessing test</Text>}
        </Pressable>
        {Platform.OS !== 'ios' && <Text style={styles.error}>Open the installed iPhone app for this device test.</Text>}
        {!!error && <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>}
        {report && <View style={styles.card}>
          <Text accessibilityLiveRegion="polite" style={[styles.status, { color: report.passed ? '#166534' : '#b91c1c' }]}>
            {report.passed ? 'PASS — matches Python' : 'FAIL — preprocessing differs'}
          </Text>
          <Text style={styles.body}>Candidates: {report.candidateCount} / expected {report.expectedCandidateCount}</Text>
          <Text style={styles.body}>First four intervals match: {report.intervalsMatch ? 'yes' : 'no'}</Text>
          <Text style={styles.body}>Maximum channel difference: {report.maxWaveDifference.toExponential(3)}</Text>
          <Text style={styles.body}>Maximum timing difference: {report.maxTimingDifference.toExponential(3)}</Text>
          <Text style={styles.body}>Allowed absolute differences: {report.tolerances.waveAbsolute} for channels; {report.tolerances.timingAbsolute} for timing features. These are feature units, not mmHg.</Text>
          <Text style={styles.body}>Exact numerical match: {report.exactMatch ? 'yes' : 'no'}</Text>
          <Text style={styles.body}>Preprocessing call: {report.preprocessingMs.toFixed(1)} ms. This excludes screen loading and result comparison.</Text>
          <Text style={styles.body}>JavaScript engine: {report.jsEngine}. Development build: {report.developmentBuild ? 'yes' : 'no'}.</Text>
          <Pressable accessibilityRole="button" onPress={share} style={styles.button}>
            <Text style={styles.buttonText}>Share test report</Text>
          </Pressable>
        </View>}
        <Text style={styles.footnote}>The output is unnormalized. Model inference, signal-quality validation, watch transfer, and BP accuracy are separate steps. Nothing is saved to your health journal.</Text>
      </ScrollView>
    </>
  );
}
const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 50, flexGrow: 1, backgroundColor: '#f6f8fa' },
  notice: { padding: 16, borderRadius: 12, backgroundColor: '#fff2c6', marginBottom: 22 },
  noticeTitle: { color: '#705300', fontSize: 13, fontWeight: '800' },
  title: { fontSize: 25, fontWeight: '700', color: '#172b3a', marginBottom: 12 },
  body: { color: '#435466', fontSize: 15, lineHeight: 23, marginTop: 8 },
  button: { backgroundColor: '#184b66', padding: 18, marginTop: 22, borderRadius: 12, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  disabled: { opacity: 0.5 }, error: { color: '#b91c1c', marginTop: 18, fontSize: 15 },
  card: { padding: 16, borderRadius: 14, marginTop: 20, backgroundColor: '#fff' },
  status: { fontSize: 20, fontWeight: '700' },
  footnote: { color: '#596978', fontSize: 13, lineHeight: 20, marginTop: 24 },
});

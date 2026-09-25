import BpPpgChainLink from '../components/BpPpgChainLink';
import BpPpgPreprocessingLink from '../components/BpPpgPreprocessingLink';
import { Link, Stack, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { runBpSmokeTest } from '../services/bpSmokeTest';
import type { BpSmokeResult } from '../services/bpSmokeTest.types';

export default function MlTestScreen() {
  const [result, setResult] = useState<BpSmokeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const running = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function run() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const next = await runBpSmokeTest();
      if (mounted.current) setResult(next);
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: 'ML Model Test', headerShown: true }} />
      <ScrollView contentContainerStyle={styles.content}>
        {/* CDD_PPG_CHAIN_LINK_V1 */}
        <BpPpgChainLink />
        {/* CDD_PPG_PREPROCESSING_LINK_V1 */}
        <BpPpgPreprocessingLink />
        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>SYNTHETIC TEST</Text>
          <Text style={styles.noticeBody}>These numbers are software-test outputs, not a health reading.</Text>
        </View>
        <Text style={styles.title}>Run the model on your phone</Text>
        <Text style={styles.body}>
          The phone loads the trained model and calculates SBP and DBP from a bundled test input.
          The input is already normalized. The result is compared with the saved Python output.
        </Text>
        {Platform.OS === 'web' && (
          <Text style={styles.error}>Use the iPhone development build to run this test.</Text>
        )}
        <Pressable
          accessibilityRole="button"
          disabled={busy || Platform.OS === 'web'}
          onPress={run}
          style={[styles.button, (busy || Platform.OS === 'web') && styles.disabled]}
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Run synthetic test</Text>}
        </Pressable>
        {busy && <Text style={styles.body}>Loading the model and running inference…</Text>}
        {!!error && <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>}
        {result && (
          <View style={styles.card}>
            <Text style={[styles.status, { color: result.passed ? '#166534' : '#b91c1c' }]}>
              {result.passed ? 'PASS — matches Python' : 'FAIL — prediction differs'}
            </Text>
            <View style={styles.row}>
              <Text style={styles.label}>Output (mmHg)</Text>
              <Text style={styles.cell}>SBP</Text>
              <Text style={styles.cell}>DBP</Text>
            </View>
            {[
              ['Phone', result.systolic.toFixed(4), result.diastolic.toFixed(4)],
              ['Python reference', result.expectedSystolic.toFixed(4), result.expectedDiastolic.toFixed(4)],
              ['Difference', result.systolicDifference.toFixed(6), result.diastolicDifference.toFixed(6)],
            ].map(([label, sbp, dbp]) => (
              <View key={label} style={styles.row}>
                <Text style={styles.label}>{label}</Text>
                <Text style={styles.cell}>{sbp}</Text>
                <Text style={styles.cell}>{dbp}</Text>
              </View>
            ))}
            <Text style={styles.body}>Allowed difference: {result.tolerance} mmHg per output.</Text>
            <Text style={styles.body}>Inference call: {result.inferenceMs.toFixed(1)} ms. Model loading is excluded.</Text>
            {!result.pairingVerified && <Text style={styles.note}>The training-cache/checkpoint pairing remains unconfirmed.</Text>}
          </View>
        )}
        <Link href={"/ml-profile" as Href} asChild>
          <Pressable accessibilityRole="button" disabled={busy} style={styles.button}>
            <Text style={styles.buttonText}>Profile synthetic inference</Text>
          </Pressable>
        </Link>
        <Text style={styles.footnote}>
          This checks model execution on the device. Raw PPG processing, watch transfer, recording-level
          aggregation and BP accuracy are separate steps. Test results are not saved to your health journal.
        </Text>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 48, backgroundColor: '#f6f8fa', flexGrow: 1 },
  notice: { padding: 16, borderRadius: 12, backgroundColor: '#fff2c6', marginBottom: 22 },
  noticeTitle: { fontSize: 12, fontWeight: '800', color: '#705300', letterSpacing: 1 },
  noticeBody: { color: '#614b0a', marginTop: 6, fontSize: 15, lineHeight: 21 },
  title: { fontSize: 25, fontWeight: '700', color: '#172b3a', marginBottom: 12 },
  body: { fontSize: 15, lineHeight: 23, color: '#435466', marginTop: 8 },
  button: { marginTop: 22, marginBottom: 16, borderRadius: 12, padding: 18, backgroundColor: '#184b66', alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  disabled: { opacity: 0.55 },
  error: { color: '#b91c1c', fontSize: 15, lineHeight: 22, marginVertical: 12 },
  card: { backgroundColor: '#fff', padding: 16, borderRadius: 14, marginTop: 12 },
  status: { fontWeight: '700', fontSize: 18, marginBottom: 16 },
  row: { flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#eef1f3' },
  label: { flex: 1.4, color: '#435466', fontSize: 13 },
  cell: { flex: 1, textAlign: 'right', fontVariant: ['tabular-nums'], fontSize: 13, color: '#172b3a' },
  note: { marginTop: 14, fontSize: 13, lineHeight: 19, color: '#705300' },
  footnote: { color: '#596978', fontSize: 13, lineHeight: 20, marginTop: 24 },
});

#!/usr/bin/env node
'use strict';
// Run from the cddapp project folder after copying the ONNX export into assets/models.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = process.cwd();
const fail = message => { throw new Error(message); };
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const exists = name => fs.existsSync(path.join(root, name));
const sha256 = name => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const validNumbers = (value, size) => Array.isArray(value) && value.length === size &&
  value.every(v => typeof v === 'number' && Number.isFinite(v));

if (!exists('package.json') || !exists('app.json') || !exists('app/(tabs)/index.tsx')) {
  fail('Run this from /Users/rithika/Desktop/cddapp (the folder containing package.json).');
}
if (['app.config.js', 'app.config.ts', 'app.config.mjs', 'app.config.cjs'].some(exists)) {
  fail('A dynamic Expo config is present. Stop here so the settings can be merged into it.');
}
const pkg = JSON.parse(read('package.json'));
if (!/54\./.test(pkg.dependencies?.expo || '')) fail('This setup was checked for Expo SDK 54.');
const assetDir = 'assets/models/onnx_export';
for (const name of ['cbp_tnet.onnx', 'normalization.json', 'export_report.json', 'synthetic_model_smoke_test.json']) {
  if (!exists(assetDir + '/' + name)) fail('Missing ' + assetDir + '/' + name + '. Copy the exported package from HiPerGator first.');
}
const report = JSON.parse(read(assetDir + '/export_report.json'));
const fixture = JSON.parse(read(assetDir + '/synthetic_model_smoke_test.json'));
const normal = JSON.parse(read(assetDir + '/normalization.json'));
if (report.conversion_parity_passed !== true ||
    report.normalization_in_graph !== false ||
    report.input_stage !== 'normalized_model_inputs') fail('The package has not passed the required export checks.');
if (sha256(assetDir + '/cbp_tnet.onnx') !== report.onnx_sha256 ||
    sha256(assetDir + '/normalization.json') !== report.normalization_sha256 ||
    normal.model_sha256 !== report.checkpoint_sha256) fail('The model/settings hashes do not match export_report.json.');
if (fixture.mock !== true || fixture.dtype !== 'float32' ||
    fixture.input_stage !== 'normalized_model_inputs' ||
    !same(fixture.inputs?.beat?.shape, [1, 3, 250]) ||
    !same(fixture.inputs?.timing?.shape, [1, 2]) ||
    !validNumbers(fixture.inputs?.beat?.data, 750) ||
    !validNumbers(fixture.inputs?.timing?.data, 2) ||
    !same(fixture.expected_output?.shape, [1, 2]) ||
    !same(fixture.expected_output?.order, ['SBP', 'DBP']) ||
    fixture.expected_output?.name !== 'bp' ||
    !validNumbers(fixture.expected_output?.data, 2) ||
    fixture.comparison_absolute_tolerance_mmhg !== 0.01) fail('Unexpected synthetic test format.');

const generated = {
  "services/bpSmokeTest.types.ts": "export type BpSmokeResult = {\n  systolic: number;\n  diastolic: number;\n  expectedSystolic: number;\n  expectedDiastolic: number;\n  systolicDifference: number;\n  diastolicDifference: number;\n  tolerance: number;\n  passed: boolean;\n  inferenceMs: number;\n  pairingVerified: boolean;\n};\n",
  "services/bpSmokeTest.native.ts": "import { Asset } from 'expo-asset';\nimport type { BpSmokeResult } from './bpSmokeTest.types';\nimport type { InferenceSession } from 'onnxruntime-react-native';\n\nconst fixture = require('../assets/models/onnx_export/synthetic_model_smoke_test.json');\nconst report = require('../assets/models/onnx_export/export_report.json');\nlet pendingSession: Promise<InferenceSession> | undefined;\n\nfunction values(value: unknown, count: number, name: string): Float32Array {\n  if (!Array.isArray(value) || value.length !== count ||\n      !value.every(v => typeof v === 'number' && Number.isFinite(v))) {\n    throw new Error('Invalid synthetic test input: ' + name);\n  }\n  return Float32Array.from(value);\n}\n\nfunction validateFixture() {\n  if (fixture.mock !== true || fixture.input_stage !== 'normalized_model_inputs' ||\n      fixture.dtype !== 'float32' || report.conversion_parity_passed !== true ||\n      JSON.stringify(fixture.inputs?.beat?.shape) !== '[1,3,250]' ||\n      JSON.stringify(fixture.inputs?.timing?.shape) !== '[1,2]' ||\n      JSON.stringify(fixture.expected_output?.order) !== '[\"SBP\",\"DBP\"]' ||\n      JSON.stringify(fixture.expected_output?.shape) !== '[1,2]' ||\n      fixture.expected_output?.name !== 'bp' ||\n      fixture.comparison_absolute_tolerance_mmhg !== 0.01) {\n    throw new Error('The exported smoke-test package does not match the model interface.');\n  }\n  return {\n    beat: values(fixture.inputs.beat.data, 750, 'beat'),\n    timing: values(fixture.inputs.timing.data, 2, 'timing'),\n    expected: values(fixture.expected_output.data, 2, 'expected output'),\n  };\n}\n\nexport async function runBpSmokeTest(): Promise<BpSmokeResult> {\n  const input = validateFixture();\n  let ort: typeof import('onnxruntime-react-native');\n  try {\n    ort = await import('onnxruntime-react-native');\n  } catch (error) {\n    const detail = error instanceof Error ? error.message : String(error);\n    throw new Error('ONNX Runtime could not load. Open the iOS development build, then try again. Expo Go cannot run this test. ' + detail);\n  }\n  if (!pendingSession) {\n    pendingSession = (async () => {\n      const asset = Asset.fromModule(require('../assets/models/onnx_export/cbp_tnet.onnx'));\n      await asset.downloadAsync();\n      if (!asset.localUri) throw new Error('The model could not be downloaded to the phone.');\n      const session = await ort.InferenceSession.create(asset.localUri, {\n        executionProviders: ['cpu'],\n        intraOpNumThreads: 1,\n        interOpNumThreads: 1,\n      });\n      if (JSON.stringify(session.inputNames) !== '[\"beat\",\"timing\"]' ||\n          JSON.stringify(session.outputNames) !== '[\"bp\"]') {\n        await session.release();\n        throw new Error('Model input/output names do not match the exported package.');\n      }\n      return session;\n    })();\n    pendingSession.catch(() => { pendingSession = undefined; });\n  }\n  const session = await pendingSession;\n  const beat = new ort.Tensor('float32', input.beat, [1, 3, 250]);\n  const timing = new ort.Tensor('float32', input.timing, [1, 2]);\n  let outputs: InferenceSession.ReturnType | undefined;\n  try {\n    const start = performance.now();\n    outputs = await session.run({ beat, timing });\n    const elapsed = performance.now() - start;\n    const output = outputs.bp;\n    if (!output || output.type !== 'float32' || JSON.stringify(output.dims) !== '[1,2]') {\n      throw new Error('Model returned an unexpected output tensor.');\n    }\n    const systolic = Number(output.data[0]);\n    const diastolic = Number(output.data[1]);\n    if (!Number.isFinite(systolic) || !Number.isFinite(diastolic)) {\n      throw new Error('Model returned a nonfinite prediction.');\n    }\n    const systolicDifference = Math.abs(systolic - input.expected[0]);\n    const diastolicDifference = Math.abs(diastolic - input.expected[1]);\n    return {\n      systolic, diastolic,\n      expectedSystolic: input.expected[0],\n      expectedDiastolic: input.expected[1],\n      systolicDifference, diastolicDifference,\n      tolerance: 0.01,\n      passed: systolicDifference <= 0.01 && diastolicDifference <= 0.01,\n      inferenceMs: elapsed,\n      pairingVerified: report.cache_checkpoint_pairing_verified === true,\n    };\n  } finally {\n    beat.dispose();\n    timing.dispose();\n    if (outputs) Object.values(outputs).forEach(tensor => tensor.dispose());\n  }\n}\n",
  "services/bpSmokeTest.ts": "import type { BpSmokeResult } from './bpSmokeTest.types';\n\nexport async function runBpSmokeTest(): Promise<BpSmokeResult> {\n  throw new Error('Open this test in the iPhone development build. Browser inference is not configured.');\n}\n",
  "components/BpSmokeTestLink.tsx": "import { Link, type Href } from 'expo-router';\nimport { Pressable, StyleSheet, Text } from 'react-native';\n\nexport default function BpSmokeTestLink() {\n  return (\n    <Link href={'/ml-test' as Href} asChild>\n      <Pressable accessibilityRole=\"button\" style={styles.button}>\n        <Text style={styles.title}>Test ML model</Text>\n        <Text style={styles.subtitle}>Run a synthetic sample on this device</Text>\n      </Pressable>\n    </Link>\n  );\n}\n\nconst styles = StyleSheet.create({\n  button: { margin: 24, marginTop: 32, padding: 20, borderRadius: 14, backgroundColor: '#184b66' },\n  title: { color: '#fff', fontWeight: '700', fontSize: 18 },\n  subtitle: { color: '#dcebf1', fontSize: 14, marginTop: 6 },\n});\n",
  "app/ml-test.tsx": "import { Stack } from 'expo-router';\nimport { useEffect, useRef, useState } from 'react';\nimport { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';\nimport { runBpSmokeTest } from '../services/bpSmokeTest';\nimport type { BpSmokeResult } from '../services/bpSmokeTest.types';\n\nexport default function MlTestScreen() {\n  const [result, setResult] = useState<BpSmokeResult | null>(null);\n  const [busy, setBusy] = useState(false);\n  const [error, setError] = useState('');\n  const mounted = useRef(true);\n  const running = useRef(false);\n  useEffect(() => {\n    mounted.current = true;\n    return () => { mounted.current = false; };\n  }, []);\n\n  async function run() {\n    if (running.current) return;\n    running.current = true;\n    setBusy(true);\n    setError('');\n    setResult(null);\n    try {\n      const next = await runBpSmokeTest();\n      if (mounted.current) setResult(next);\n    } catch (err) {\n      if (mounted.current) setError(err instanceof Error ? err.message : String(err));\n    } finally {\n      running.current = false;\n      if (mounted.current) setBusy(false);\n    }\n  }\n\n  return (\n    <>\n      <Stack.Screen options={{ title: 'ML Model Test', headerShown: true }} />\n      <ScrollView contentContainerStyle={styles.content}>\n        <View style={styles.notice}>\n          <Text style={styles.noticeTitle}>SYNTHETIC TEST</Text>\n          <Text style={styles.noticeBody}>These numbers are software-test outputs, not a health reading.</Text>\n        </View>\n        <Text style={styles.title}>Run the model on your phone</Text>\n        <Text style={styles.body}>\n          The phone loads the trained model and calculates SBP and DBP from a bundled test input.\n          The input is already normalized. The result is compared with the saved Python output.\n        </Text>\n        {Platform.OS === 'web' && (\n          <Text style={styles.error}>Use the iPhone development build to run this test.</Text>\n        )}\n        <Pressable\n          accessibilityRole=\"button\"\n          disabled={busy || Platform.OS === 'web'}\n          onPress={run}\n          style={[styles.button, (busy || Platform.OS === 'web') && styles.disabled]}\n        >\n          {busy ? <ActivityIndicator color=\"#fff\" /> : <Text style={styles.buttonText}>Run synthetic test</Text>}\n        </Pressable>\n        {busy && <Text style={styles.body}>Loading the model and running inference…</Text>}\n        {!!error && <Text accessibilityLiveRegion=\"polite\" style={styles.error}>{error}</Text>}\n        {result && (\n          <View style={styles.card}>\n            <Text style={[styles.status, { color: result.passed ? '#166534' : '#b91c1c' }]}>\n              {result.passed ? 'PASS — matches Python' : 'FAIL — prediction differs'}\n            </Text>\n            <View style={styles.row}>\n              <Text style={styles.label}>Output (mmHg)</Text>\n              <Text style={styles.cell}>SBP</Text>\n              <Text style={styles.cell}>DBP</Text>\n            </View>\n            {[\n              ['Phone', result.systolic.toFixed(4), result.diastolic.toFixed(4)],\n              ['Python reference', result.expectedSystolic.toFixed(4), result.expectedDiastolic.toFixed(4)],\n              ['Difference', result.systolicDifference.toFixed(6), result.diastolicDifference.toFixed(6)],\n            ].map(([label, sbp, dbp]) => (\n              <View key={label} style={styles.row}>\n                <Text style={styles.label}>{label}</Text>\n                <Text style={styles.cell}>{sbp}</Text>\n                <Text style={styles.cell}>{dbp}</Text>\n              </View>\n            ))}\n            <Text style={styles.body}>Allowed difference: {result.tolerance} mmHg per output.</Text>\n            <Text style={styles.body}>Inference call: {result.inferenceMs.toFixed(1)} ms. Model loading is excluded.</Text>\n            {!result.pairingVerified && <Text style={styles.note}>The training-cache/checkpoint pairing remains unconfirmed.</Text>}\n          </View>\n        )}\n        <Text style={styles.footnote}>\n          This checks model execution on the device. Raw PPG processing, watch transfer, recording-level\n          aggregation and BP accuracy are separate steps. Test results are not saved to your health journal.\n        </Text>\n      </ScrollView>\n    </>\n  );\n}\n\nconst styles = StyleSheet.create({\n  content: { padding: 20, paddingBottom: 48, backgroundColor: '#f6f8fa', flexGrow: 1 },\n  notice: { padding: 16, borderRadius: 12, backgroundColor: '#fff2c6', marginBottom: 22 },\n  noticeTitle: { fontSize: 12, fontWeight: '800', color: '#705300', letterSpacing: 1 },\n  noticeBody: { color: '#614b0a', marginTop: 6, fontSize: 15, lineHeight: 21 },\n  title: { fontSize: 25, fontWeight: '700', color: '#172b3a', marginBottom: 12 },\n  body: { fontSize: 15, lineHeight: 23, color: '#435466', marginTop: 8 },\n  button: { marginTop: 22, marginBottom: 16, borderRadius: 12, padding: 18, backgroundColor: '#184b66', alignItems: 'center' },\n  buttonText: { color: '#fff', fontSize: 17, fontWeight: '700' },\n  disabled: { opacity: 0.55 },\n  error: { color: '#b91c1c', fontSize: 15, lineHeight: 22, marginVertical: 12 },\n  card: { backgroundColor: '#fff', padding: 16, borderRadius: 14, marginTop: 12 },\n  status: { fontWeight: '700', fontSize: 18, marginBottom: 16 },\n  row: { flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#eef1f3' },\n  label: { flex: 1.4, color: '#435466', fontSize: 13 },\n  cell: { flex: 1, textAlign: 'right', fontVariant: ['tabular-nums'], fontSize: 13, color: '#172b3a' },\n  note: { marginTop: 14, fontSize: 13, lineHeight: 19, color: '#705300' },\n  footnote: { color: '#596978', fontSize: 13, lineHeight: 20, marginTop: 24 },\n});\n"
};
for (const [name, text] of Object.entries(generated)) {
  if (exists(name) && read(name) !== text) fail(name + ' already exists with different content. No files were changed.');
}
const changes = new Map(Object.entries(generated));
let home = read('app/(tabs)/index.tsx');
if (!home.includes("import BpSmokeTestLink from")) {
  if (!/<Header\s*\/>/.test(home)) fail('The home screen differs from the inspected version. No files were changed.');
  home = "import BpSmokeTestLink from '@/components/BpSmokeTestLink';\n" +
    home.replace(/<Header\s*\/>/, '<Header />\n      <BpSmokeTestLink />');
}
if (!home.includes('<BpSmokeTestLink />')) fail('Home-screen integration is incomplete; no files were changed.');
changes.set('app/(tabs)/index.tsx', home);

let metro = exists('metro.config.js') ? read('metro.config.js') :
  "const { getDefaultConfig } = require('expo/metro-config');\nmodule.exports = getDefaultConfig(__dirname);\n";
if (!metro.includes('CBP_ONNX_ASSET_SUPPORT')) {
  metro += "\n// CBP_ONNX_ASSET_SUPPORT\n;(() => {\n  const config = module.exports;\n  if (!config.resolver || !Array.isArray(config.resolver.assetExts)) {\n    throw new Error('Expected an object Metro config with resolver.assetExts.');\n  }\n  if (!config.resolver.assetExts.includes('onnx')) config.resolver.assetExts.push('onnx');\n})();\n";
}
changes.set('metro.config.js', metro);
const config = JSON.parse(read('app.json'));
config.expo = config.expo || {};
config.expo.ios = config.expo.ios || {};
config.expo.ios.bundleIdentifier = config.expo.ios.bundleIdentifier || 'com.rithikamathew.cddapp';
config.expo.plugins = config.expo.plugins || [];
if (!config.expo.plugins.some(p => (Array.isArray(p) ? p[0] : p) === 'onnxruntime-react-native')) {
  config.expo.plugins.push('onnxruntime-react-native');
}
changes.set('app.json', JSON.stringify(config, null, 2) + '\n');
let ignore = exists('.gitignore') ? read('.gitignore') : '';
if (!ignore.split(/\r?\n/).includes('/iphone-test-backups/')) {
  ignore = ignore.trimEnd() + '\n\n/iphone-test-backups/\n';
}
changes.set('.gitignore', ignore);

const pending = [...changes].filter(([name, text]) => !exists(name) || read(name) !== text);
if (pending.length === 0) {
  console.log('The iPhone model-test files are already installed.');
  process.exit(0);
}
const backup = path.join(root, 'iphone-test-backups', new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(backup, { recursive: true });
for (const name of new Set([...pending.map(([name]) => name), 'package.json', 'package-lock.json'])) {
  if (exists(name)) {
    const target = path.join(backup, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, name), target);
  }
}
for (const [name, text] of pending) {
  const target = path.join(root, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text);
}
fs.writeFileSync(path.join(backup, 'changed-files.json'), JSON.stringify(pending.map(([name]) => name), null, 2));
console.log('Installed the home-screen button, test screen, inference service and ONNX config.');
console.log('Original files backed up to: ' + backup);
console.log('Next: npm install --save-exact onnxruntime-react-native@1.24.3');
console.log('Then: npx expo install expo-asset expo-dev-client');
console.log('Then: npx expo prebuild --platform ios');
console.log('Then: npx expo run:ios --device');


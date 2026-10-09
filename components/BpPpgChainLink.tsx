import { Link, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';
export default function BpPpgChainLink() {
  return <Link href={'/ml-ppg-chain' as Href} asChild>
    <Pressable accessibilityRole="button" style={styles.button}>
      <Text style={styles.title}>Test raw PPG to model output</Text>
      <Text style={styles.body}>Check preprocessing, normalization and inference together</Text>
    </Pressable>
  </Link>;
}
const styles = StyleSheet.create({
  button: { padding: 18, marginBottom: 20, borderRadius: 12, backgroundColor: '#184b66' },
  title: { color: '#fff', fontSize: 17, fontWeight: '700' },
  body: { color: '#e1edf4', fontSize: 14, marginTop: 6 },
});

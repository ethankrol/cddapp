import { Link, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';

export default function BpSmokeTestLink() {
  return (
    <Link href={'/ml-test' as Href} asChild>
      <Pressable accessibilityRole="button" style={styles.button}>
        <Text style={styles.title}>Test ML model</Text>
        <Text style={styles.subtitle}>Run a synthetic sample on this device</Text>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  button: { margin: 24, marginTop: 32, padding: 20, borderRadius: 14, backgroundColor: '#184b66' },
  title: { color: '#fff', fontWeight: '700', fontSize: 18 },
  subtitle: { color: '#dcebf1', fontSize: 14, marginTop: 6 },
});

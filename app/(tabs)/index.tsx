import BpSmokeTestLink from '@/components/BpSmokeTestLink';
import BpCsvCard from '@/components/BpCsvCard';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

function Header() {
  return (
    <View style={styles.header}>
      <Text style={styles.headerSpacer}></Text>
      <Text style={styles.headerTitle}>Blood Pressure</Text>
      <Pressable onPress={() => alert('Notifications')}>
        <Ionicons name="notifications-outline" size={28} color="black" style={styles.notificationIcon} />
      </Pressable>
    </View>
  );
}

export default function HomePage() {
  return (
    <View style={styles.container}>
      <Header />
      <ScrollView contentContainerStyle={{paddingBottom:28}}>
        <BpCsvCard />
        <BpSmokeTestLink />
      </ScrollView>
    </View>
  );
}



const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    height: 100,
    paddingHorizontal: 20,
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    paddingTop: 70,
    fontSize: 20,
    fontWeight: '700',
    color: '#000',
    textAlign: 'center',
    flex: 1,
  },
  notificationIcon: {
    marginTop: 40,
    width: 28,
  },
  headerSpacer: {
    width : 28,
    height: 28,
  }
});

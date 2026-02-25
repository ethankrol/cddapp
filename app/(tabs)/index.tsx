import NotificationIcon from '@/assets/images/notification.svg';
import { Pressable, StyleSheet, Text, View } from 'react-native';

function Header() {
  return (
    <View style={styles.header}>
      <Text style={styles.headerSpacer}></Text>
      <Text style={styles.headerTitle}>Blood Pressure</Text>
      <Pressable onPress={() => alert('Notifications')}>
        <NotificationIcon style={styles.notificationIcon} />
      </Pressable>
    </View>
  );
}

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Header />
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
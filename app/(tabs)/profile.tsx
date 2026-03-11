import NotificationIcon from '@/assets/images/notification.svg';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

// mock data will replace this with db later
const INITIAL_USER = {
  firstName: 'First',
  lastName: 'Last',
  phone: '111-222-3333',
  email: 'user.email@email.com',
  dob: '01/01/2001',
  weight: 0,
  height: '5 ft.',
  age: 20,
  skinTone: 0,
};


const InfoItem = ({ icon, label, value, provider = "Ionicons" }: any) => (
  <View style={styles.infoRow}>
    {provider === "Ionicons" ? 
        <Ionicons name={icon} size={24} color="black" /> : 
        <MaterialCommunityIcons name={icon} size={24} color="black" />
    }
    <Text style={styles.infoText}>{label}: {value}</Text>
  </View>
);

function Header() {
  return (
    <View style={styles.header}>
      <Text style={styles.headerSpacer}></Text>
      <Text style={styles.headerTitle}>Profile</Text>
      <Pressable onPress={() => alert('Notifications')}>
        <NotificationIcon style={styles.notificationIcon} />
      </Pressable>
    </View>
  );
}

export default function ProfilePage() {
  const user = INITIAL_USER;

  return (
    <ScrollView style={styles.container}>
      {/* 0. Page Header */}
      <Header />

      {/* 1. Profile Header Section */}
      <View style={styles.profileHeader}>
        <View style={styles.avatarContainer}>
          <View style={styles.avatarPlaceholder} />
          <Pressable style={styles.editIconBadge}>
             <MaterialCommunityIcons name="pencil-outline" size={16} color="white" />
          </Pressable>
        </View>
        <Text style={styles.userName}>{`${user.firstName}\n${user.lastName}`}</Text>
      </View>

      {/* 2. Contact Information */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Contact Information:</Text>
          <InfoItem icon="call-outline" label="Phone" value={user.phone} />
          <InfoItem icon="mail-outline" label="Email" value={user.email} />
        </View>

        {/* 3. User Data */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>User Data:</Text>
          <InfoItem icon="calendar-outline" label="DOB" value={user.dob} />
          <InfoItem icon="scale-bathroom" label="Weight" value={user.weight} provider="MaterialCommunityIcons" />
          <InfoItem icon="human-male-height" label="Height" value={user.height} provider="MaterialCommunityIcons" />
          <InfoItem icon="person-outline" label="Age" value={user.age} />
        </View>
      </ScrollView>    
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
  },
  profileHeader: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    padding: 25, 
    marginTop: 20 
  },
  avatarContainer: { 
    position: 'relative' 
  },
  avatarPlaceholder: { 
    width: 140, 
    height: 140, 
    borderRadius: 80, 
    backgroundColor: '#E5E7EB' 
  },
  editIconBadge: { 
    position: 'absolute', 
    bottom: 5, 
    right: 5, 
    backgroundColor: '#1F2937', 
    borderRadius: 15, 
    padding: 5 
  },
  userName: { 
    fontSize: 32, 
    fontWeight: '500', 
    marginLeft: 20, 
    lineHeight: 40 
  },
  section: { 
    paddingHorizontal: 25, 
    marginTop: 25 
  },
  sectionTitle: { 
    fontSize: 18, 
    fontWeight: 'bold', 
    marginBottom: 15 
  },
  infoRow: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    marginBottom: 15 
  },
  infoText: { 
    fontSize: 18, 
    marginLeft: 15 
  },
});
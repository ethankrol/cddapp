import SkinTonePicker from '@/components/skintone-picker';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import React, { ComponentProps, useEffect, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  KeyboardTypeOptions,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
// If the @ alias fails, use relative path: import { ... } from '../../services/database';
import { getProfile, initDatabase, saveProfile, UserProfile } from '@/services/database';

const INITIAL_USER: UserProfile = {
  firstName: 'First',
  lastName: 'Last',
  phone: '111-222-3333',
  email: 'user.email@email.com',
  dob: '01/01/2001',
  weight: 165,
  height: '5 ft. 10 in.',
  age: 20,
  skinTone: 0,
};

interface InfoItemProps {
  icon: ComponentProps<typeof Ionicons>['name'] | ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  value: string | number;
  onChange: (text: string) => void;
  isEditing: boolean;
  provider?: "Ionicons" | "MaterialCommunityIcons";
  keyboardType?: KeyboardTypeOptions;
}

const InfoItem = ({ 
  icon, label, value, onChange, isEditing, provider = "Ionicons", keyboardType = "default" 
}: InfoItemProps) => (
  <View style={styles.infoRow}>
    <View style={styles.iconContainer}>
      {provider === "Ionicons" ? (
        <Ionicons name={icon as any} size={22} color="black" />
      ) : (
        <MaterialCommunityIcons name={icon as any} size={22} color="black" />
      )}
    </View>
    <View style={styles.inlineTextContainer}>
      <Text style={styles.fieldLabelInline}>{label}: </Text>
      {isEditing ? (
        <TextInput
          style={styles.inputFieldInline}
          value={String(value)}
          onChangeText={onChange}
          keyboardType={keyboardType}
        />
      ) : (
        <Text style={styles.infoTextInline}>{value}</Text>
      )}
    </View>
  </View>
);

function Header() {
  return (
    <View style={styles.header}>
      <View style={styles.headerSpacer} />
      <Text style={styles.headerTitle}>Profile</Text>
      <Pressable onPress={() => alert('Notifications')}>
        <Ionicons name="notifications-outline" size={28} color="black" style={styles.notificationIcon} />
      </Pressable>
    </View>
  );
}

export default function ProfilePage() {
  const [isEditing, setIsEditing] = useState(false);
  const [profile, setProfile] = useState<UserProfile>(INITIAL_USER);

  useEffect(() => {
    const setup = async () => {
      try {
        await initDatabase();
        const saved = await getProfile();
        if (saved) {
          setProfile(saved);
        }
      } catch (err) {
        console.error("Database Load Error:", err);
      }
    };
    setup();
  }, []);

  const handleToggleEdit = async () => {
    if (isEditing) {
      try {
        await saveProfile(profile);
      } catch (err) {
        console.error("Save Error:", err);
      }
    }
    setIsEditing(!isEditing);
  };

  return (
    <KeyboardAvoidingView
    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    style={{ flex: 1, backgroundColor: '#fff' }}
    // Optional: add keyboardVerticalOffset if you have a header or nav bar
    keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0} 
    >
    <Header />
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
      <ScrollView 
        style={styles.container} 
        contentContainerStyle={{ paddingBottom: 100 }} // Extra space for the Nav Bar4
        keyboardShouldPersistTaps="handled"
      >

        <View style={styles.profileHeader}>
          <View style={styles.avatarContainer}>
            <View style={styles.avatarPlaceholder} />
            <Pressable style={styles.editIconBadge} onPress={handleToggleEdit}>
              <MaterialCommunityIcons 
                name={isEditing ? "check" : "pencil-outline"} 
                size={18} 
                color="white" 
              />
            </Pressable>
          </View>
          <View style={styles.nameContainer}>
            {isEditing ? (
              <>
                <TextInput
                  style={[styles.userNameInput, { marginBottom: 8 }]}
                  value={profile.firstName}
                  onChangeText={(t) => setProfile({ ...profile, firstName: t })}
                />
                <TextInput
                  style={styles.userNameInput}
                  value={profile.lastName}
                  onChangeText={(t) => setProfile({ ...profile, lastName: t })}
                />
              </>
            ) : (
              <Text style={styles.userNameText}>{`${profile.firstName}\n${profile.lastName}`}</Text>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Contact Information:</Text>
          <InfoItem
            icon="call-outline"
            label="Phone"
            value={profile.phone}
            isEditing={isEditing}
            onChange={(t) => setProfile({ ...profile, phone: t })}
            keyboardType="phone-pad"
          />
          <InfoItem
            icon="mail-outline"
            label="Email"
            value={profile.email}
            isEditing={isEditing}
            onChange={(t) => setProfile({ ...profile, email: t })}
            keyboardType="email-address"
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>User Data:</Text>
          <InfoItem
            icon="calendar-outline"
            label="DOB"
            value={profile.dob}
            isEditing={isEditing}
            onChange={(t) => setProfile({ ...profile, dob: t })}
          />
          <InfoItem
            icon="scale-bathroom"
            label="Weight"
            value={profile.weight}
            provider="MaterialCommunityIcons"
            isEditing={isEditing}
            keyboardType="numeric"
            onChange={(t) => setProfile({ ...profile, weight: parseInt(t) || 0 })}
          />
          <InfoItem
            icon="human-male-height"
            label="Height"
            value={profile.height}
            provider="MaterialCommunityIcons"
            isEditing={isEditing}
            onChange={(t) => setProfile({ ...profile, height: t })}
          />
          <InfoItem
            icon="person-outline"
            label="Age"
            value={profile.age}
            isEditing={isEditing}
            keyboardType="numeric"
            onChange={(t) => setProfile({ ...profile, age: parseInt(t) || 0 })}
          />
          
          <View style={styles.infoRow}>
            <View style={styles.iconContainer}>
              <Ionicons name="body-outline" size={22} color="black" />
            </View>
            <View style={styles.inlineTextContainer}>
              <Text style={styles.fieldLabelInline}>Skin Tone: </Text>
              <View style={{ flex: 1, marginLeft: 10 }}>
                <SkinTonePicker
                  selected={profile.skinTone}
                  isEditable={isEditing}
                  onSelect={(index) => setProfile({ ...profile, skinTone: index })}
                />
              </View>
            </View>
          </View>
        </View>
        
        <View style={{ height: 60 }} />
    </ScrollView>
    </TouchableWithoutFeedback>
  </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
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
  notificationIcon: { marginTop: 40, width: 28 },
  headerSpacer: { width: 28, marginTop: 40 },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 25,
    marginTop: 30,
  },
  avatarContainer: { position: 'relative' },
  avatarPlaceholder: {
    width: 130,
    height: 130,
    borderRadius: 65,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  editIconBadge: {
    position: 'absolute',
    bottom: 5,
    right: 5,
    backgroundColor: '#1F2937',
    borderRadius: 20,
    padding: 8,
  },
  nameContainer: { flex: 1, marginLeft: 20 },
  userNameText: { fontSize: 32, fontWeight: '500', lineHeight: 38, color: '#111' },
  userNameInput: {
    fontSize: 24,
    fontWeight: '500',
    borderBottomWidth: 1,
    borderBottomColor: '#3e4550',
    color: '#111',
  },
  section: { paddingHorizontal: 25, marginTop: 30 },
  sectionTitle: { fontSize: 18, fontWeight: '700', marginBottom: 20, color: '#000' },
  infoRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
  iconContainer: { width: 30, alignItems: 'center' },
  inlineTextContainer: { flex: 1, flexDirection: 'row', alignItems: 'center', marginLeft: 15 },
  fieldLabelInline: { fontSize: 18, fontWeight: '600', color: '#000' },
  infoTextInline: { fontSize: 18, color: '#111', fontWeight: '400' },
  inputFieldInline: {
    flex: 1,
    fontSize: 18,
    borderBottomWidth: 1,
    borderBottomColor: '#3e4550',
    color: '#3e4550',
    paddingVertical: 0,
  },
});
import AnalyticsIcon from '@/assets/images/analytics.svg';
import HomeIcon from '@/assets/images/home.svg';
import JournalIcon from '@/assets/images/journal.svg';
import ProfileIcon from '@/assets/images/profile.svg';
import { useRouter, useSegments } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function CustomNavBar() {
  const router = useRouter();
  const segments = useSegments();
  const insets = useSafeAreaInsets();

  const currentRoute =
    segments[segments.length - 1] === '(tabs)'
      ? 'index'
      : segments[segments.length - 1];

  const tabs = [
    { name: 'index', icon: HomeIcon, label: 'Home' },
    { name: 'journal', icon: JournalIcon, label: 'Journal' },
    { name: 'analytics', icon: AnalyticsIcon, label: 'Analytics' },
    { name: 'profile', icon: ProfileIcon, label: 'Profile' },
  ];

  return (
    <View style={[styles.container, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      {tabs.map((tab) => {
        const isActive = currentRoute === tab.name;
        const IconComponent = tab.icon;

        return (
          <Pressable
            key={tab.name}
            onPress={() => router.replace((tab.name === 'index' ? '/' : `/${tab.name}`) as any)}
            style={styles.tab}
          >
            <IconComponent
              width={26}
              height={26}
              //fill="#000000"
              //color="#000000"
              //stroke="#000000"
            />
            <Text style={[styles.label, isActive && styles.activeLabel]}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: -6,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    paddingTop: 14,
    paddingHorizontal: 16,

    // Upward shadow for iOS
    shadowColor: '#000000',
    shadowOffset: {
      width: 0,
      height: -8,
    },
    shadowOpacity: 0.06,
    shadowRadius: 6,

    // Elevation for Android
    elevation: 8,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '400',
    marginTop: 6,
  },
  activeLabel: {
    fontWeight: '800',
  },
});
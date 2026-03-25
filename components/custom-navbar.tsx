import AnalyticsIcon from '@/assets/images/analytics.svg';
import HomeIcon from '@/assets/images/home.svg';
import JournalIcon from '@/assets/images/journal.svg';
import ProfileIcon from '@/assets/images/profile.svg';
import { useRouter, useSegments } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export default function CustomNavBar() {
  const router = useRouter();
  const segments = useSegments();

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
    <View style={styles.container}>
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
              width={20}
              height={20}
            />
            <Text style={[styles.label, isActive && { color: '#8d9ecc' }]}>
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
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: '#2A3451',
    borderRadius: 0,
    height: 90,
    paddingHorizontal: 20,
  },
  tab: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  label: {
    color: '#fff',
    fontSize: 12,
    marginTop: 2,
  },
});
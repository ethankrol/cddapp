import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { Calendar } from 'react-native-calendars';

// --- TypeScript Definitions ---
interface JournalEntry {
  bp?: string;
  notes?: string;
}

const getBPStatus = (bpString?: string): 'high' | 'low' | 'normal' | 'none' => {
  if (!bpString || !bpString.includes('/')) return 'none';
  const [sys, dia] = bpString.split('/').map(num => parseInt(num.trim()));
  if (isNaN(sys) || isNaN(dia)) return 'none';
  if (sys >= 130 || dia > 80) return 'high';
  if (sys <= 90 || dia <= 60) return 'low';
  return 'normal';
};

function Header() {
  return (
    <View style={styles.header}>
      <View style={styles.headerSpacer} />
      <Text style={styles.headerTitle}>Journal</Text>
      <Pressable onPress={() => alert('Notifications')}>
        <Ionicons name="notifications-outline" size={28} color="black" style={styles.notificationIcon} />
      </Pressable>
    </View>
  );
}

export default function JournalPage() {
  const [selected, setSelected] = useState<string>('');
  const [journalEntries, setJournalEntries] = useState<Record<string, JournalEntry>>({});

  const updateEntry = (field: keyof JournalEntry, value: string) => {
    if (!selected) return;
    setJournalEntries(prev => ({
      ...prev,
      [selected]: { ...prev[selected], [field]: value }
    }));
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
      style={styles.container}
      // This offset ensures the keyboard doesn't hug the input too tightly
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
    >
      <Header />
      
      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Calendar is now inside the ScrollView so it moves up with the page */}
        <View style={styles.calendarWrapper}>
          <Calendar
            onDayPress={(day) => setSelected(day.dateString)}
            dayComponent={({ date, state }: any) => {
              const dateString = date.dateString;
              const entry = journalEntries[dateString];
              const status = getBPStatus(entry?.bp);
              const isSelected = selected === dateString;
              const isToday = state === 'today';
              const isDisabled = state === 'disabled';
              const isAlertStatus = status === 'high' || status === 'low';

              return (
                <Pressable 
                  onPress={() => setSelected(dateString)}
                  style={[styles.customDay, isSelected && styles.selectedDay]}
                >
                  <Text style={[
                    styles.dayText, 
                    isDisabled ? { color: '#d9e1e8' } : { color: isSelected ? 'white' : 'black' },
                    isToday && !isSelected && { color: '#567ae5', fontWeight: 'bold' },
                    isAlertStatus && !isSelected && { color: 'red', fontWeight: '700' }
                  ]}>
                    {date.day}
                  </Text>
                  <View style={styles.indicatorContainer}>
                    {status === 'high' && <Ionicons name="caret-up" size={10} color={isSelected ? 'white' : 'red'} />}
                    {status === 'low' && <Ionicons name="caret-down" size={10} color={isSelected ? 'white' : 'red'} />}
                    {(status === 'normal' || (entry?.notes && status === 'none')) && (
                      <View style={[styles.normalDot, isSelected && { backgroundColor: 'white' }]} />
                    )}
                  </View>
                </Pressable>
              );
            }}
            theme={{
              arrowColor: '#567ae5',
              textMonthFontWeight: '700',
            }}
          />
        </View>

        <View style={styles.formContainer}>
          {selected ? (
            <View style={styles.entryForm}>
              <View style={styles.dateRow}>
                <Text style={styles.dateLabel}>{selected}</Text>
                {getBPStatus(journalEntries[selected]?.bp) === 'high' && <Ionicons name="arrow-up" size={22} color="red" />}
                {getBPStatus(journalEntries[selected]?.bp) === 'low' && <Ionicons name="arrow-down" size={22} color="red" />}
              </View>
              
              <Text style={styles.inputLabel}>Average Blood Pressure (mmHg)</Text>
              <TextInput
                style={[
                  styles.bpInput,
                  (getBPStatus(journalEntries[selected]?.bp) === 'high' || getBPStatus(journalEntries[selected]?.bp) === 'low') && { borderColor: 'red' }
                ]}
                placeholder="120/80"
                keyboardType="numbers-and-punctuation"
                value={journalEntries[selected]?.bp || ''}
                onChangeText={(val) => updateEntry('bp', val)}
              />

              <Text style={styles.inputLabel}>Daily Notes</Text>
              <TextInput
                style={styles.notesInput}
                placeholder="How are you feeling today?"
                multiline
                scrollEnabled={false} // Important: keeps the page scrolling, not the box
                value={journalEntries[selected]?.notes || ''}
                onChangeText={(val) => updateEntry('notes', val)}
              />
              
              {/* This extra space at the bottom allows the user to scroll 
                  the input well above the keyboard */}
              <View style={{ height: 100 }} />
            </View>
          ) : (
            <View style={styles.centerHint}>
              <Text style={styles.selectionHint}>Select a date to view or add journal entries</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: '#fff' 
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 20, // Space at the very bottom of the page
  },
  header: { 
    height: 90, 
    paddingHorizontal: 20, 
    flexDirection: 'row', 
    alignItems: 'center', 
    borderBottomWidth: 1, 
    borderBottomColor: '#eee',
    backgroundColor: '#fff', // Keep header solid while scrolling
  },
  headerTitle: { 
    paddingTop: 35, 
    fontSize: 22, 
    fontWeight: '700', 
    flex: 1, 
    textAlign: 'center' 
  },
  notificationIcon: { marginTop: 35 },
  headerSpacer: { width: 28, marginTop: 35 },
  calendarWrapper: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f9f9f9',
  },
  formContainer: { 
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  customDay: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
    height: 40,
    borderRadius: 18,
  },
  selectedDay: {
    backgroundColor: '#2A3451',
  },
  dayText: {
    fontSize: 15,
  },
  indicatorContainer: {
    height: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  normalDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#567ae5',
    marginTop: 1,
  },
  entryForm: {
    flex: 1,
  },
  dateRow: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    marginBottom: 12 
  },
  dateLabel: { 
    fontSize: 18, 
    fontWeight: '600', 
    marginRight: 10,
    color: '#2A3451'
  },
  inputLabel: { 
    fontSize: 13, 
    fontWeight: '600', 
    color: '#888', 
    marginBottom: 6,
    textTransform: 'uppercase'
  },
  bpInput: { 
    backgroundColor: '#F5F7FA', 
    borderRadius: 10, 
    padding: 14, 
    fontSize: 16, 
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#eee'
  },
  notesInput: { 
    backgroundColor: '#F5F7FA', 
    borderRadius: 10, 
    padding: 14, 
    fontSize: 16, 
    minHeight: 112, // Slightly larger for better "Journal" feel
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: '#eee'
  },
  centerHint: {
    marginTop: 50,
    alignItems: 'center',
  },
  selectionHint: { 
    color: '#999', 
    fontSize: 16 
  },
});
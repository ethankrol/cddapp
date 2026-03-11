// components/skintone-picker.tsx
import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

const SKIN_TONES = [
  '#FFF5EB', // Pale
  '#FFDBAC', // Fair
  '#F1C27D', // Tan
  '#E0AC69', // Brown
  '#8D5524', // Dark Brown
  '#4F3120', // Deep
];

interface Props {
  selected: number;
  onSelect: (index: number) => void;
  isEditable: boolean;
}

// MAKE SURE "export default" IS HERE
export default function SkinTonePicker({ selected, onSelect, isEditable }: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.palette}>
        {SKIN_TONES.map((color, index) => (
          <TouchableOpacity
            key={index}
            disabled={!isEditable} 
            onPress={() => onSelect(index)}
            style={[
              styles.circle,
              { backgroundColor: color },
              selected === index && styles.selectedCircle,
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    marginTop: 15,
    marginBottom: 10 
  },
  label: { 
    fontSize: 16, 
    color: '#6B7280',
    marginRight: 15 
  },
  palette: { 
    flexDirection: 'row', 
    flex: 1, 
    justifyContent: 'space-between' 
  },
  circle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  selectedCircle: {
    borderWidth: 3,
    borderColor: '#3B82F6', 
  },
});
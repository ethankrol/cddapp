/**
 * Example usage of the BloodPressureModule
 * 
 * This file demonstrates how to integrate blood pressure prediction
 * into the app, including model initialization and making predictions.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { bloodPressureModel, BloodPressurePrediction } from '@/app/services/bloodPressureModel';

export default function BloodPressureExampleScreen() {
  const [prediction, setPrediction] = useState<BloodPressurePrediction | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    initializeAndPredict();
  }, []);

  const initializeAndPredict = async () => {
    try {
      setLoading(true);
      setError(null);

      // Step 1: Load the model
      console.log('Loading blood pressure model...');
      const loaded = await bloodPressureModel.loadModel();
      if (!loaded) {
        throw new Error('Failed to load model');
      }

      // Step 2: Warm up the model for better performance
      console.log('Warming up model...');
      await bloodPressureModel.warmUpModel();

      // Step 3: Get model info
      const modelInfo = await bloodPressureModel.getModelInfo();
      console.log('Model info:', modelInfo);

      // Step 4: Make a prediction with sample data
      // In a real app, this reading would come from BLE sensor data
      const sampleReading = {
        systolic: 135,
        diastolic: 88,
        heartRate: 75,
        age: 45,
        weight: 75,
        height: 178,
        timestamp: Date.now(),
      };

      console.log('Making prediction for:', sampleReading);
      const result = await bloodPressureModel.predictReading(sampleReading);
      
      console.log('Prediction result:', result);
      setPrediction(result);
    } catch (err) {
      console.error('Error during prediction:', err);
      setError(
        err instanceof Error 
          ? err.message 
          : 'An unknown error occurred'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Blood Pressure Prediction</Text>

      {loading && (
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Initializing model...</Text>
        </View>
      )}

      {error && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>Error</Text>
          <Text style={styles.errorText}>{error}</Text>
          <Text
            style={styles.retryButton}
            onPress={initializeAndPredict}
          >
            Retry
          </Text>
        </View>
      )}

      {prediction && !loading && (
        <View style={styles.resultContainer}>
          <ResultCard prediction={prediction} />
        </View>
      )}
    </View>
  );
}

function ResultCard({ prediction }: { prediction: BloodPressurePrediction }) {
  const getRiskColor = (level: string) => {
    switch (level) {
      case 'normal':
        return '#34C759';
      case 'elevated':
        return '#FF9500';
      case 'hypertension_stage1':
        return '#FF3B30';
      case 'hypertension_stage2':
        return '#8B0000';
      default:
        return '#999999';
    }
  };

  const getRiskLabel = (level: string) => {
    return level
      .replace(/_/g, ' ')
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  return (
    <View style={styles.card}>
      <View
        style={[
          styles.riskBadge,
          { backgroundColor: getRiskColor(prediction.riskLevel) },
        ]}
      >
        <Text style={styles.riskLabel}>
          {getRiskLabel(prediction.riskLevel)}
        </Text>
      </View>

      <View style={styles.readingContainer}>
        <View style={styles.reading}>
          <Text style={styles.readingLabel}>Systolic</Text>
          <Text style={styles.readingValue}>
            {prediction.systolicPrediction.toFixed(0)} mmHg
          </Text>
        </View>
        <View style={styles.reading}>
          <Text style={styles.readingLabel}>Diastolic</Text>
          <Text style={styles.readingValue}>
            {prediction.diastolicPrediction.toFixed(0)} mmHg
          </Text>
        </View>
      </View>

      <View style={styles.metadataContainer}>
        <View style={styles.metadata}>
          <Text style={styles.metadataLabel}>Confidence</Text>
          <Text style={styles.metadataValue}>
            {(prediction.confidence * 100).toFixed(0)}%
          </Text>
        </View>
        <View style={styles.metadata}>
          <Text style={styles.metadataLabel}>Processing Time</Text>
          <Text style={styles.metadataValue}>{prediction.timeMs}ms</Text>
        </View>
        <View style={styles.metadata}>
          <Text style={styles.metadataLabel}>Model Version</Text>
          <Text style={styles.metadataValue}>{prediction.modelVersion}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 16,
    color: '#333',
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#666',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff3cd',
    borderRadius: 12,
    padding: 16,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#856404',
    marginBottom: 8,
  },
  errorText: {
    fontSize: 14,
    color: '#856404',
    marginBottom: 16,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: '#007AFF',
    color: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    overflow: 'hidden',
  },
  resultContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  riskBadge: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginBottom: 16,
    alignItems: 'center',
  },
  riskLabel: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  readingContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 24,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#eee',
  },
  reading: {
    alignItems: 'center',
  },
  readingLabel: {
    fontSize: 12,
    color: '#999',
    marginBottom: 4,
  },
  readingValue: {
    fontSize: 20,
    fontWeight: '600',
    color: '#333',
  },
  metadataContainer: {
    gap: 12,
  },
  metadata: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  metadataLabel: {
    fontSize: 14,
    color: '#666',
  },
  metadataValue: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
  },
});

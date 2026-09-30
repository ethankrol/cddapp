import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Polyline, Text as SvgText } from 'react-native-svg';

interface BloodPressureData {
  current: { systolic: number; diastolic: number };
  daily: { systolic: number; diastolic: number };
  weekly: { systolic: number; diastolic: number };
  monthly: { systolic: number; diastolic: number };
}

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

function DefaultWeeklyChart() {
  const [chartWidth, setChartWidth] = useState(300);
  const chartHeight = 150;
  const paddingLeft = 30;
  const paddingRight = 10;
  const paddingTop = 14;
  const paddingBottom = 22;

  const days = ['Sep 24', '25', '26', '27', '28', '29', '30'];
  const systolicData = [118, 122, 120, 125, 121, 119, 120];
  const diastolicData = [78, 82, 80, 84, 79, 81, 80];

  const yLabels = [130, 110, 90, 70];
  const minY = 60;
  const maxY = 140;

  const graphW = Math.max(chartWidth - paddingLeft - paddingRight, 10);
  const graphH = chartHeight - paddingTop - paddingBottom;

  const getPoints = (data: number[]) => {
    return data
      .map((val, idx) => {
        const x = paddingLeft + (idx / (data.length - 1)) * graphW;
        const y = paddingTop + graphH - ((val - minY) / (maxY - minY)) * graphH;
        return `${x},${y}`;
      })
      .join(' ');
  };

  return (
    <View
      style={styles.chartWrapper}
      onLayout={(e) => setChartWidth(e.nativeEvent.layout.width)}
    >
      <Svg width={chartWidth} height={chartHeight}>
        {yLabels.map((val) => {
          const y = paddingTop + graphH - ((val - minY) / (maxY - minY)) * graphH;
          return (
            <React.Fragment key={val}>
              <SvgText
                x={paddingLeft - 6}
                y={y + 3}
                fill="#A0A0A0"
                fontSize="10"
                textAnchor="end"
              >
                {val}
              </SvgText>
              <Line
                x1={paddingLeft}
                y1={y}
                x2={chartWidth - paddingRight}
                y2={y}
                stroke="#EAEAEA"
                strokeWidth="1"
              />
            </React.Fragment>
          );
        })}

        <SvgText x={chartWidth * 0.45} y={32} fill="#EF5350" fontSize="10" fontWeight="600">
          Systolic
        </SvgText>
        <SvgText x={chartWidth * 0.45} y={88} fill="#2979FF" fontSize="10" fontWeight="600">
          Diastolic
        </SvgText>

        <Polyline
          points={getPoints(systolicData)}
          fill="none"
          stroke="#EF5350"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        <Polyline
          points={getPoints(diastolicData)}
          fill="none"
          stroke="#2979FF"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {days.map((day, idx) => {
          const x = paddingLeft + (idx / (days.length - 1)) * graphW;
          return (
            <SvgText
              key={day}
              x={x}
              y={chartHeight - 4}
              fill="#9E9E9E"
              fontSize="9"
              textAnchor="middle"
            >
              {day}
            </SvgText>
          );
        })}
      </Svg>
    </View>
  );
}

export default function HomePage() {
  // Backend state variables with default 120/80 values (ready to be updated via useEffect/API)
  const [bpData, setBpData] = useState<BloodPressureData>({
    current: { systolic: 120, diastolic: 80 },
    daily: { systolic: 120, diastolic: 80 },
    weekly: { systolic: 120, diastolic: 80 },
    monthly: { systolic: 120, diastolic: 80 },
  });

  return (
    <View style={styles.container}>
      <Header />

      <View style={styles.bodyWrapper}>
        <Text style={styles.readingSubtitle}>Current Blood Pressure Reading (mmHg)</Text>

        <LinearGradient
          colors={['#DDE8F6', '#EEF3F9', '#FFFFFF']}
          locations={[0, 0.6, 1]}
          style={styles.archBackdrop}
        >
          {/* Main Reading Dial */}
          <View style={styles.dialBadge}>
            <Text style={styles.dialValue}>{bpData.current.systolic}</Text>
            <View style={styles.dialDivider} />
            <Text style={styles.dialValue}>{bpData.current.diastolic}</Text>
          </View>

          {/* Daily, Weekly, Monthly Row */}
          <View style={styles.metricsRow}>
            <View style={styles.metricItem}>
              <Text style={styles.metricValue}>{bpData.daily.systolic}</Text>
              <View style={styles.metricDivider} />
              <Text style={styles.metricValue}>{bpData.daily.diastolic}</Text>
              <Text style={styles.metricLabel}>DAILY</Text>
            </View>

            <View style={styles.metricItem}>
              <Text style={styles.metricValue}>{bpData.weekly.systolic}</Text>
              <View style={styles.metricDivider} />
              <Text style={styles.metricValue}>{bpData.weekly.diastolic}</Text>
              <Text style={styles.metricLabel}>WEEKLY</Text>
            </View>

            <View style={styles.metricItem}>
              <Text style={styles.metricValue}>{bpData.monthly.systolic}</Text>
              <View style={styles.metricDivider} />
              <Text style={styles.metricValue}>{bpData.monthly.diastolic}</Text>
              <Text style={styles.metricLabel}>MONTHLY</Text>
            </View>
          </View>
        </LinearGradient>

        <View style={styles.chartCard}>
          <Text style={styles.chartTitle}>Blood Pressure Tracking (Last 7 Days)</Text>
          <DefaultWeeklyChart />
        </View>
      </View>
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
    width: 28,
    height: 28,
  },
  bodyWrapper: {
    flex: 1,
    paddingHorizontal: 20,
    paddingBottom: 95,
    justifyContent: 'flex-start',
  },
  readingSubtitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#111',
    textAlign: 'center',
    marginTop: 48,
    marginBottom: 20,
  },
  archBackdrop: {
    width: '100%',
    borderTopLeftRadius: 150,
    borderTopRightRadius: 150,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    alignItems: 'center',
    paddingTop: 20,
    paddingBottom: 12,
    overflow: 'hidden',
  },
  dialBadge: {
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#6B7C96',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  dialValue: {
    fontSize: 32,
    fontWeight: '700',
    color: '#000',
    textAlign: 'center',
  },
  dialDivider: {
    width: 90,
    height: 2.5,
    backgroundColor: '#000',
    marginVertical: 4,
    borderRadius: 2,
  },
  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    marginTop: 10,
    paddingHorizontal: 10,
  },
  metricItem: {
    alignItems: 'center',
    width: 65,
  },
  metricValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
    textAlign: 'center',
  },
  metricDivider: {
    width: 36,
    height: 1.5,
    backgroundColor: '#000',
    marginVertical: 2,
  },
  metricLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#222',
    marginTop: 4,
    letterSpacing: 0.5,
  },
  chartCard: {
    height: 195,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 10,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#E6E8EC',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  chartTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#000',
    marginBottom: 2,
  },
  chartWrapper: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
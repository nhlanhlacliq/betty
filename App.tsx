import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  Alert,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { createBettyEngine, BettyEngineConfig } from './src/BettyEngine';
import { RideSessionManager } from './src/core/RideSessionManager';
import { ExpoSTT } from './src/adapters/ExpoSTT';
import { useBettyStore } from './src/store/useBettyStore';
import { TriggerPriority } from './src/models/TriggerEvent';

// Load API keys from environment (configure in .env)
const ENGINE_CONFIG: BettyEngineConfig = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  openWeatherApiKey: process.env.OPENWEATHER_API_KEY ?? '',
  tomTomApiKey: process.env.TOMTOM_API_KEY ?? '',
};

export default function App() {
  const sessionRef = useRef<RideSessionManager | null>(null);
  const sttRef = useRef<ExpoSTT | null>(null);

  const {
    bikeState,
    rideActive,
    lastTrigger,
    memoryEntries,
    isSpeaking,
    isListening,
    error,
    setBikeState,
    setRideActive,
    setLastTrigger,
    addMemoryEntry,
    setIsSpeaking,
    setIsListening,
    setError,
    resetSession,
  } = useBettyStore();

  const [engineReady, setEngineReady] = useState(false);

  useEffect(() => {
    if (!ENGINE_CONFIG.anthropicApiKey) {
      setError('Missing ANTHROPIC_API_KEY — check your .env file');
      return;
    }
    const { session, stt } = createBettyEngine(ENGINE_CONFIG);
    sessionRef.current = session;
    sttRef.current = stt;
    setEngineReady(true);

    return () => {
      session.stop();
    };
  }, []);

  const startRide = async () => {
    if (!sessionRef.current) return;
    try {
      resetSession();
      await sessionRef.current.start();
      setRideActive(true);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  };

  const stopRide = () => {
    sessionRef.current?.stop();
    setRideActive(false);
  };

  const toggleVoice = async () => {
    const stt = sttRef.current;
    if (!stt) return;
    if (isListening) {
      stt.stopListening();
      setIsListening(false);
    } else {
      await stt.startListening();
      setIsListening(true);
    }
  };

  const priorityColor = (priority: TriggerPriority): string => {
    switch (priority) {
      case TriggerPriority.P1_CRITICAL: return '#ff3b30';
      case TriggerPriority.P2_ADVISORY: return '#ff9f0a';
      case TriggerPriority.P3_AMBIENT: return '#30d158';
      case TriggerPriority.P4_QUERY: return '#0a84ff';
      default: return '#8e8e93';
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Betty</Text>
        <Text style={styles.subtitle}>BMW G 310 GS · Edenvale</Text>
        <View style={[styles.statusDot, { backgroundColor: rideActive ? '#30d158' : '#8e8e93' }]} />
      </View>

      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Bike State Grid */}
      <View style={styles.stateGrid}>
        <StateCell label="Speed" value={`${bikeState.speed} km/h`} />
        <StateCell label="RPM" value={bikeState.rpm.toLocaleString()} />
        <StateCell label="Coolant" value={`${bikeState.coolantTemp}°C`} alert={bikeState.coolantTemp > 100} />
        <StateCell label="Battery" value={`${bikeState.batteryVoltage}V`} alert={bikeState.batteryVoltage < 12} />
        <StateCell label="Front PSI" value={`${bikeState.frontTyrePSI}`} alert={bikeState.frontTyrePSI < 32} />
        <StateCell label="Rear PSI" value={`${bikeState.rearTyrePSI}`} alert={bikeState.rearTyrePSI < 38} />
        <StateCell label="Lean" value={`${bikeState.leanAngle.toFixed(1)}°`} />
        <StateCell label="Weather" value={bikeState.weatherCondition} />
      </View>

      {/* Last Trigger */}
      {lastTrigger && (
        <View style={[styles.triggerBanner, { borderLeftColor: priorityColor(lastTrigger.priority) }]}>
          <Text style={[styles.triggerType, { color: priorityColor(lastTrigger.priority) }]}>
            {lastTrigger.type}
          </Text>
          <Text style={styles.triggerTime}>
            {new Date(lastTrigger.timestamp).toLocaleTimeString()}
          </Text>
        </View>
      )}

      {/* Memory Log */}
      <ScrollView style={styles.memoryScroll} contentContainerStyle={styles.memoryContent}>
        {memoryEntries.length === 0 ? (
          <Text style={styles.memoryEmpty}>No messages yet this ride.</Text>
        ) : (
          [...memoryEntries].reverse().map((entry, idx) => (
            <View key={idx} style={styles.memoryEntry}>
              <Text style={styles.memoryMeta}>
                {entry.triggerType} · {new Date(entry.timestamp).toLocaleTimeString()}
              </Text>
              <Text style={styles.memoryText}>"{entry.spokenText}"</Text>
            </View>
          ))
        )}
      </ScrollView>

      {/* Controls */}
      <View style={styles.controls}>
        <TouchableOpacity
          style={[styles.voiceBtn, isListening && styles.voiceBtnActive]}
          onPress={toggleVoice}
          disabled={!rideActive}
        >
          <Text style={styles.voiceBtnText}>{isListening ? 'Listening…' : 'Hold: Ask Betty'}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.rideBtn, rideActive ? styles.rideBtnStop : styles.rideBtnStart]}
          onPress={rideActive ? stopRide : startRide}
          disabled={!engineReady}
        >
          <Text style={styles.rideBtnText}>{rideActive ? 'End Ride' : 'Start Ride'}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function StateCell({
  label,
  value,
  alert = false,
}: {
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <View style={[styles.stateCell, alert && styles.stateCellAlert]}>
      <Text style={styles.stateCellLabel}>{label}</Text>
      <Text style={[styles.stateCellValue, alert && styles.stateCellValueAlert]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2c2c2e',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#ffffff',
    marginRight: 8,
  },
  subtitle: {
    fontSize: 13,
    color: '#8e8e93',
    flex: 1,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  errorBanner: {
    backgroundColor: '#3a1a1a',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ff3b30',
  },
  errorText: {
    color: '#ff3b30',
    fontSize: 12,
  },
  stateGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  stateCell: {
    width: '25%',
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  stateCellAlert: {
    backgroundColor: '#2a1a0a',
    borderRadius: 8,
  },
  stateCellLabel: {
    fontSize: 10,
    color: '#8e8e93',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  stateCellValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  stateCellValueAlert: {
    color: '#ff9f0a',
  },
  triggerBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderLeftWidth: 3,
    backgroundColor: '#1c1c1e',
    borderRadius: 6,
  },
  triggerType: {
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  triggerTime: {
    fontSize: 11,
    color: '#8e8e93',
  },
  memoryScroll: {
    flex: 1,
    marginTop: 8,
  },
  memoryContent: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  memoryEmpty: {
    color: '#3a3a3c',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 20,
  },
  memoryEntry: {
    marginBottom: 10,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2c2c2e',
  },
  memoryMeta: {
    fontSize: 10,
    color: '#636366',
    marginBottom: 3,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  memoryText: {
    fontSize: 14,
    color: '#ebebf5',
    lineHeight: 20,
  },
  controls: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#2c2c2e',
  },
  voiceBtn: {
    flex: 1,
    paddingVertical: 14,
    backgroundColor: '#1c1c1e',
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#3a3a3c',
  },
  voiceBtnActive: {
    backgroundColor: '#0a2a4a',
    borderColor: '#0a84ff',
  },
  voiceBtnText: {
    color: '#ebebf5',
    fontSize: 14,
    fontWeight: '500',
  },
  rideBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  rideBtnStart: {
    backgroundColor: '#1a3a1a',
    borderWidth: 1,
    borderColor: '#30d158',
  },
  rideBtnStop: {
    backgroundColor: '#3a1a1a',
    borderWidth: 1,
    borderColor: '#ff3b30',
  },
  rideBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
});

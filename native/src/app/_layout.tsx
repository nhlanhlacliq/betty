import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BettyProvider } from '../state/Betty';
import { C } from '../ui/theme';
import { Toast } from '../ui/Toast';

/**
 * The app (Expo Router: every file in src/app is a screen). The four tabs live in (tabs); the ride screen sits above
 * them full screen, without the tab bar (as on the web: map room, no small targets under gloves).
 */
export default function Root() {
  return (
    <SafeAreaProvider>
      <BettyProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg } }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="ride" options={{ animation: 'fade', gestureEnabled: false }} />
          <Stack.Screen name="story/[id]" />
          <Stack.Screen name="help" />
          <Stack.Screen name="log" />
          <Stack.Screen name="lab" />
          <Stack.Screen name="engine" />
        </Stack>
        <Toast />
      </BettyProvider>
    </SafeAreaProvider>
  );
}

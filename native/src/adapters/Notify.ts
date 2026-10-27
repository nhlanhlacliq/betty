import * as Notifications from 'expo-notifications';

/** Local notifications (no push server): only "your bike is on, tap to ride" for now (EngineWatch). */
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

export async function askNotifications(): Promise<boolean> {
  const now = await Notifications.getPermissionsAsync();
  if (now.granted) return true;
  return (await Notifications.requestPermissionsAsync()).granted;
}

export const RIDE_ACTION = 'ride';
export async function notifyBikeOn(name: string) {
  await Notifications.scheduleNotificationAsync({
    content: { title: 'Your bike is on', body: `${name} is awake. Tap to start a ride with Betty.`, data: { action: RIDE_ACTION } },
    trigger: null,
  });
}

/** Calls `f` once for each tap on a "tap to ride" notification, including the one that opened the app. */
export function onRideTap(f: () => void): () => void {
  const seen = new Set<string>();
  const handle = (r: Notifications.NotificationResponse | null) => {
    if (!r || r.notification.request.content.data?.action !== RIDE_ACTION) return;
    const id = r.notification.request.identifier;
    if (seen.has(id)) return;
    seen.add(id); f();
  };
  void Notifications.getLastNotificationResponseAsync().then(handle);
  const sub = Notifications.addNotificationResponseReceivedListener(handle);
  return () => sub.remove();
}

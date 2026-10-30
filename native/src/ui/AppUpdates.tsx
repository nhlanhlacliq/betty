import { useState } from 'react';
import { Alert, Text } from 'react-native';
import * as Application from 'expo-application';
import * as Updates from 'expo-updates';
import { Secondary } from './Buttons';
import { Setting } from './Card';

/**
 * Garage > This app: which build and which over-the-air update are running, and "Check for updates" (her own server,
 * native/scripts/publish-update.mjs). The app also checks by itself each time it opens and uses what it found the
 * next time. Never restarts during a ride: a found update is then used when Betty next opens.
 */
export function AppUpdates({ riding }: { riding: boolean }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const build = `Version ${Application.nativeApplicationVersion ?? '?'} (${Application.nativeBuildVersion ?? '?'})`;
  const running = Updates.isEmbeddedLaunch || !Updates.updateId
    ? 'as installed'
    : `update of ${Updates.createdAt ? Updates.createdAt.toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'unknown date'}`;

  const check = async () => {
    if (!Updates.isEnabled) { setNote('Updates are off in this build (a development build).'); return; }
    setBusy(true); setNote('Checking...');
    try {
      const found = await Updates.checkForUpdateAsync();
      if (!found.isAvailable) { setNote('Betty is up to date.'); return; }
      setNote('Downloading...');
      await Updates.fetchUpdateAsync();
      if (riding) { setNote('Downloaded. It is used the next time Betty opens (not during a ride).'); return; }
      setNote('Downloaded.');
      Alert.alert('Update ready', 'Restart Betty now to use it?', [
        { text: 'Later', style: 'cancel', onPress: () => setNote('Downloaded. It is used the next time Betty opens.') },
        { text: 'Restart', onPress: () => void Updates.reloadAsync() },
      ]);
    } catch (e) {
      setNote(`Could not check: ${(e as Error)?.message ?? e}`);
    } finally { setBusy(false); }
  };

  return (
    <Setting last label="This app" sub={`${build}, ${running}. New versions come from Betty's own server; she checks each time she opens.`} stack>
      <Secondary label={busy ? 'Checking...' : 'Check for updates'} onPress={() => void check()} disabled={busy} />
      {note ? <Text style={{ marginTop: 8, color: '#5d6a5a' }}>{note}</Text> : null}
    </Setting>
  );
}

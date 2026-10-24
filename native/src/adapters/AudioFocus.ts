import { setAudioModeAsync } from 'expo-audio';

/**
 * Who has the phone's sound, in one place (stage 6, 2026-10-24):
 * - idle: her audio MIXES with his music (nothing changes for it);
 * - a line playing: his music DUCKS (gets quieter) while she speaks, and comes back after (`lineStart`/`lineEnd`,
 *   counted, with a short tail so back-to-back lines do not pump the music);
 * - headset buttons on (`setExclusive`): the sound is Betty's alone (iPhone only gives the headset's buttons to the
 *   app that has it), which PAUSES his music: the rider chooses this per ride.
 * Always: plays with the silent switch on, and keeps playing in the background during a ride.
 * UNVERIFIED on the phone: how this sits with the voice server's call (Daily) while a conversation is open.
 */
let exclusive = false;
let speaking = 0;
let tail: ReturnType<typeof setTimeout> | undefined;
let applied = '';

const apply = () => {
  const mode = exclusive ? 'doNotMix' : speaking > 0 ? 'duckOthers' : 'mixWithOthers';
  if (mode === applied) return Promise.resolve();
  applied = mode;
  return setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: mode }).catch(() => {});
};

/** Once before her first line (ride start, the home orb). */
export const setUpAudio = () => { applied = ''; return apply(); };

export function lineStart() { clearTimeout(tail); speaking++; void apply(); }
export function lineEnd() {
  speaking = Math.max(0, speaking - 1);
  clearTimeout(tail);
  tail = setTimeout(() => void apply(), 600); // music back up shortly after her last word
}
export function setExclusive(on: boolean) { exclusive = on; return apply(); }

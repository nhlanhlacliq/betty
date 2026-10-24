import { setAudioModeAsync } from 'expo-audio';
import { audioRoute } from '../../modules/betty-audio-route';

/**
 * Who has the phone's sound, in one place (stage 6, 2026-10-24; helmet modes 2026-10-25):
 * - idle: her audio MIXES with his music (nothing changes for it);
 * - a line playing: his music DUCKS (gets quieter) while she speaks, and comes back after (`lineStart`/`lineEnd`,
 *   counted, with a short tail so back-to-back lines do not pump the music);
 * - headset buttons on (`setExclusive`): the sound is Betty's alone (iPhone only gives the headset's buttons to the
 *   app that has it), which PAUSES his music: the rider chooses this per ride.
 * Always: plays with the silent switch on, and keeps playing in the background during a ride.
 *
 * While the voice server's call is open (`setCall`), the sound must stay "play and record" or the call's mic goes
 * silent (first phone test, 2026-10-24). Both libraries would then hold the helmet in CALL MODE (hands-free) for the
 * whole call: music at call quality and the helmet's button sending call controls, which broke headset buttons. So
 * on iPhone our own module (modules/betty-audio-route) picks the link: hands-free only while he talks (`setTalking`;
 * open mic = always), stereo the rest of the time. UNVERIFIED on the phone (2026-10-25).
 */
let exclusive = false;
let call = false;
let talking = false;
let speaking = 0;
let tail: ReturnType<typeof setTimeout> | undefined;
let applied = '';
let log: (msg: string) => void = () => {};

/** Where the route changes are reported (the ride's log) */
export const setAudioLog = (fn: (msg: string) => void) => { log = fn; };

const apply = async () => {
  const mode = exclusive ? 'doNotMix' : speaking > 0 ? 'duckOthers' : 'mixWithOthers';
  if (call && audioRoute) {
    const route = talking ? 'call' : 'media';
    const key = `${route}:${mode}`;
    if (key === applied) return;
    const helmetChanged = !applied.startsWith(`${route}:`);
    applied = key;
    const t0 = Date.now();
    try {
      const where = await audioRoute.setRoute(route, exclusive ? 'solo' : speaking > 0 ? 'duck' : 'mix');
      if (helmetChanged) log(`helmet ${route === 'call' ? 'hands-free (mic on)' : 'stereo (mic off)'} in ${Date.now() - t0} ms; ${where}`);
    } catch (e) { applied = ''; log(`could not set the helmet mode: ${(e as Error).message}`); }
    return;
  }
  const key = `${mode}:${call}`;
  if (key === applied) return;
  applied = key;
  // allowsRecording false = the playback category, which SILENCES the mic the voice call uses. Without our module
  // (Android, or an older build) the call keeps recording allowed all the time, as before.
  await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: mode, allowsRecording: call }).catch(() => {});
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
/** The voice server's call opened or closed (VoiceSession). */
export function setCall(on: boolean) { if (call === on) return Promise.resolve(); call = on; if (!on) talking = false; applied = ''; return apply(); }
/** His turn (push-to-talk) or open mic: the helmet's mic is needed. Resolves once the helmet has switched. */
export function setTalking(on: boolean) { if (talking === on) return Promise.resolve(); talking = on; return apply(); }
/** Set it again, whatever we think it is (Daily set its own when it joined). */
export function reapply() { applied = ''; return apply(); }
/** True when the helmet can be switched per turn (iPhone with our module). */
export const perTurnHelmet = () => audioRoute != null;

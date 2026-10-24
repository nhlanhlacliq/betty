import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { loadConfig } from '../../../src/config/persist';
import { LineLogger, LogLine } from '../../../src/app/LineLogger';
import type { BikeState } from '../../../src/core/types';
import '../server'; // points the shared code's /api/ calls at Betty's server
import { openStore } from '../adapters/NativeStore';
import { ElmClassicTransport } from '../adapters/ElmClassicTransport';
import { ObdSource } from '../adapters/ObdSource';
import { ChirpSpeaker } from '../adapters/ChirpSpeaker';
import { ExpoSpeaker, setUpAudio } from '../adapters/ExpoSpeaker';
import { Ride, startRide } from '../rig';
import { HeadsetButtons } from '../adapters/HeadsetButtons';
import { CONFIG } from '../../../src/config/betty';
import { saveConfig } from '../../../src/config/persist';

export type VoiceState = 'off' | 'connecting' | 'ready' | 'listening';
export type RideMode = 'real' | 'sim';

/**
 * Everything the screens share: Betty's data being ready, the ride (if one runs), its state for painting, how he talks
 * to her, and the log. One provider at the root (src/app/_layout.tsx); screens read it with `useBetty()`.
 */
interface BettyCtx {
  ready: boolean;
  ride: Ride | null;
  /** Bumped when the ride screen should repaint (throttled) */
  tick: number;
  state: BikeState | null;
  voice: VoiceState;
  ending: boolean;
  mode: RideMode;
  setMode(m: RideMode): void;
  openMic: boolean;
  setOpenMic(on: boolean): void;
  /** Headset buttons for Betty this ride (pauses his music while she holds them) */
  buttons: boolean;
  setButtons(on: boolean): void;
  /** Android: the paired OBD2 reader to use (Bluetooth address), or none */
  reader: string | null;
  setReader(a: string | null): void;
  lines: LogLine[];
  logger: LineLogger;
  start(): Promise<void>;
  /** End the ride (the sign-off first). While it is signing off, calling it again stops at once. */
  end(): Promise<{ rideId: number; kept: boolean } | null>;
  /** The last ride that ended, for Home to say so */
  ended: { rideId: number; kept: boolean } | null;
  /** A line in her voice outside a ride (the home orb) */
  hello(text: string): void;
  helloSpeaking: boolean;
  /** Read something out outside a ride (Explore's Listen); `onEnd(true)` when heard to the end. Returns stop. */
  listen(text: string, onEnd: (heard: boolean) => void): () => void;
  /** A short message at the top of the screen (the web's toast) */
  toast(msg: string): void;
  toastMsg: string | null;
  /** Bumped when kept data changes (a ride ended, a ride deleted, a note, a reminder): screens read the stores again */
  data: number;
  touch(): void;
  /** Where to? text waiting for the Home sheet (Explore > Ride there) */
  pendingWhere: string | null;
  setPendingWhere(t: string | null): void;
}

const Ctx = createContext<BettyCtx | null>(null);
export const useBetty = () => { const c = useContext(Ctx); if (!c) throw new Error('useBetty outside BettyProvider'); return c; };

export function BettyProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const logRef = useRef<LineLogger | null>(null);
  logRef.current ??= new LineLogger(() => setLines(logRef.current!.lines.slice(0, 300)));
  const logger = logRef.current;
  const [ready, setReady] = useState(false);
  const [ride, setRide] = useState<Ride | null>(null);
  const rideRef = useRef<Ride | null>(null);
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<BikeState | null>(null);
  const [voice, setVoice] = useState<VoiceState>('off');
  const [ending, setEnding] = useState(false);
  const [mode, setMode] = useState<RideMode>('real');
  const [openMic, setOpenMicState] = useState(false);
  const [buttons, setButtonsState] = useState(false);
  const headset = useRef<HeadsetButtons | null>(null);
  const [reader, setReader] = useState<string | null>(null);
  const [ended, setEnded] = useState<{ rideId: number; kept: boolean } | null>(null);
  const [helloSpeaking, setHelloSpeaking] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), Math.max(2600, 1600 + msg.length * 45)); // longer text stays longer
  }, []);
  const [data, setData] = useState(0);
  const touch = useCallback(() => setData((n) => n + 1), []);
  const [pendingWhere, setPendingWhere] = useState<string | null>(null);
  const hurry = useRef(false);
  const busy = useRef(false);

  // Betty's data (rides, notes, reminders, settings...) is read into memory before anything uses it.
  useEffect(() => { void openStore((m) => logger.add('[store]', m)).then(() => { loadConfig(); setButtonsState(CONFIG.headsetButtons); setReady(true); }); }, [logger]);

  // Repaints at most every 250 ms: the ride says "changed" on every update and every line's fate.
  const pending = useRef(false);
  const changed = useCallback(() => {
    if (pending.current) return;
    pending.current = true;
    setTimeout(() => { pending.current = false; setTick((n) => n + 1); }, 250);
  }, []);

  const end = useCallback(async () => {
    const r = rideRef.current;
    if (!r) return null;
    if (busy.current) { hurry.current = true; return null; } // second tap during the sign-off: stop now
    busy.current = true; hurry.current = false;
    setEnding(true);
    try {
      const out = await r.end(() => hurry.current);
      setEnded(out);
      touch();
      if (!out.kept) toast('A short one: rides under 3 minutes and 1 km are not kept in My journeys.');
      return out;
    } finally {
      rideRef.current = null; setRide(null);
      void headset.current?.stop(); headset.current = null;
      deactivateKeepAwake();
      setVoice('off'); setEnding(false); busy.current = false;
    }
  }, [toast, touch]);

  /**
   * The helmet's buttons for the ride: play/pause talks (hold-to-talk mode: she listens until your sentence is heard,
   * 10 s at most, or the next press; open mic: mute/unmute), next track repeats her, previous gives the buttons back.
   */
  const startButtons = async (r: Ride) => {
    const hb = new HeadsetButtons((m) => logger.add('[voice]', m));
    let talking: ReturnType<typeof setTimeout> | undefined;
    const done = () => { clearTimeout(talking); talking = undefined; hb.quiet(3000); r.voice.release(); setTimeout(() => hb.resume(), 1200); };
    r.voice.onHeardRider = () => { if (talking) done(); };
    const ok = await hb.start({
      talk: () => {
        if (r.voice.mode === 'open') { hb.quiet(3000); void r.voice.toggleMic(); return; }
        if (talking) { done(); return; }
        hb.quiet(3000); // the helmet goes hands-free now: a pause of the silent track is that, not a press
        void r.voice.press().catch(() => {});
        talking = setTimeout(done, 10_000);
      },
      repeat: () => { if (!r.ride.repeat()) toast("She hasn't said anything yet."); },
      letGo: () => { void hb.stop(); headset.current = null; logger.add('[voice]', 'previous track: Betty let go of the headset buttons'); toast('Headset buttons are back with your music.'); },
    });
    if (ok) { headset.current = hb; logger.add('[voice]', 'headset buttons: play/pause talks, next track repeats her, previous track lets go'); }
    else toast('Headset buttons could not start.');
  };
  const setButtons = useCallback((on: boolean) => {
    setButtonsState(on); CONFIG.headsetButtons = on; saveConfig();
    const r = rideRef.current;
    if (r && on && !headset.current) void startButtons(r);
    if (!on && headset.current) { void headset.current.stop(); headset.current = null; }
  }, []);

  const start = useCallback(async () => {
    if (rideRef.current || busy.current) return;
    busy.current = true;
    try {
      logger.clearScreen();
      setEnded(null);
      let obd: ObdSource | undefined;
      if (reader && mode === 'real') {
        const t = new ElmClassicTransport();
        try { await t.connect(reader); obd = new ObdSource(t, (m) => logger.add('[obd]', m)); }
        catch (e) { logger.add('[obd]', `could not connect: ${(e as Error).message}`); }
      }
      await activateKeepAwakeAsync();
      const r = await startRide({ logger, changed, state: setState, endRequested: () => void end(), obd, real: mode === 'real', toast });
      r.voice.onState = setVoice;
      if (openMic) void r.voice.setMode('open');
      rideRef.current = r; setRide(r);
      if (buttons) void startButtons(r);
    } finally { busy.current = false; }
  }, [logger, changed, end, reader, mode, openMic, buttons, toast]);

  const setOpenMic = useCallback((on: boolean) => {
    setOpenMicState(on);
    void rideRef.current?.voice.setMode(on ? 'open' : 'ptt');
  }, []);

  // Her voice outside a ride (the home orb): Chirp, the phone voice as backup.
  const helloVoice = useRef<ChirpSpeaker | null>(null);
  const hello = useCallback((text: string) => {
    if (rideRef.current) return;
    void (async () => {
      await setUpAudio();
      helloVoice.current ??= new ChirpSpeaker(new ExpoSpeaker(), (m) => logger.add('[audio]', m));
      helloVoice.current.stop();
      setHelloSpeaking(true);
      helloVoice.current.speak(text, () => setHelloSpeaking(false), { priority: 4, id: 'voice' });
    })();
  }, [logger]);

  const listen = useCallback((text: string, onEnd: (heard: boolean) => void) => {
    let over = false;
    const end = (heard: boolean) => { if (over) return; over = true; onEnd(heard); };
    void (async () => {
      await setUpAudio();
      helloVoice.current ??= new ChirpSpeaker(new ExpoSpeaker(), (m) => logger.add('[audio]', m));
      helloVoice.current.stop();
      helloVoice.current.speak(text, () => end(true), { priority: 3, id: 'area_story' });
    })();
    return () => { if (!over) { helloVoice.current?.stop(); end(false); } };
  }, [logger]);

  return (
    <Ctx.Provider value={{ ready, ride, tick, state, voice, ending, mode, setMode, openMic, setOpenMic, buttons, setButtons, reader, setReader, lines, logger, start, end, ended, hello, helloSpeaking, listen, toast, toastMsg, data, touch, pendingWhere, setPendingWhere }}>
      {children}
    </Ctx.Provider>
  );
}

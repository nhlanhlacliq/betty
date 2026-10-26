import { CONFIG, FLAVOUR_PROMPTS, bettySystemPrompt } from '../../src/config/betty';
import { NO_OBD } from '../../src/core/StateAggregator';
import { ClaudeClient } from '../../src/core/ClaudeClient';
import type { BikeState, DataSource } from '../../src/core/types';
import { TomTomTrafficProvider } from '../../src/adapters/TomTomTraffic';
import { RideSession } from '../../src/app/RideSession';
import type { LineLogger } from '../../src/app/LineLogger';
import { ExpoGeoSource } from './adapters/ExpoGeoSource';
import { ExpoSpeaker, setUpAudio } from './adapters/ExpoSpeaker';
import { ChirpSpeaker } from './adapters/ChirpSpeaker';
import { lineEnd, lineStart, setAudioLog } from './adapters/AudioFocus';
import { SERVER_HEADERS, api } from './server';
import { VoiceSession, type VoiceSetup } from './voice/VoiceSession';
import { LinkSession, LinkSpeaker } from './voice/LinkSession';
import { phoneTools } from './voice/phoneTools';

/**
 * A ride in the native app: the shared RideSession (src/app/RideSession.ts, the same one the web app runs) with the
 * phone's adapters plugged in: GPS (expo-location), her Chirp voice (the phone's voice as backup), a real OBD2
 * reader when one is picked, and the voice server for talking to her (Pipecat, push-to-talk or open mic).
 * Wiring only: what Betty does lives in ../src.
 */
export interface RideHooks {
  logger: LineLogger;
  /** The ride screen may need repainting */
  changed: () => void;
  state: (s: BikeState) => void;
  /** He said "end ride": the screen runs its own end */
  endRequested: () => void;
  /** An OBD2 source to add (real reader), or none */
  obd?: DataSource;
  /** A short message on screen ("Dismissed for a week") */
  toast?: (msg: string) => void;
  /** False = a desk test: no phone sensors, simulated at the fallback location, never saved as a ride */
  real?: boolean;
}

export async function startRide(h: RideHooks) {
  const log = (head: string, text: string) => h.logger.add(head, text);
  await setUpAudio();
  CONFIG.cloudVoice = 'chirp'; // her voice here is Chirp on the voice server (no <laugh> tags: it would read them out)
  // Her own lines in her Chirp voice (as on the web), the phone's voice when Chirp is slow or fails.
  const chirp = new ChirpSpeaker(new ExpoSpeaker((m) => log('[audio]', m)), (m) => log('[audio]', m));
  // Talking to her: the voice server (~2 s answers, tools carried out on the phone). BETTY LINK (default since
  // 2026-10-25, Garage > Talking to Betty): our own connection, one voice for her answers AND her own lines
  // (LinkSpeaker), the native module owning all the sound. Off: the Daily call (VoiceSession), open mic and headset
  // buttons included. `ride` is filled in just below (the setup's closures only run once it exists).
  let ride!: RideSession;
  const setup: VoiceSetup = {
    system: `${bettySystemPrompt(2)}\n\n${(FLAVOUR_PROMPTS as Record<string, string>).rider_query ?? ''}`,
    situation: () => ({ text: ride.engine.voiceSituation(ride.agg.current), lat: ride.agg.current.lat, lon: ride.agg.current.lon }),
    tools: {},
    keyterms: () => {
      const s = ride.agg.current;
      const stops = ride.engine.routeNow()?.route.stops.filter((x) => x.named).map((x) => x.name) ?? [];
      return [s.area?.suburb, s.area?.town, ...s.nearbyPlaces.map((p) => p.name), ...stops, CONFIG.bikeName]
        .filter((x): x is string => !!x && x.length <= 40).slice(0, 40);
    },
    log: (m) => log('[voice]', m),
  };
  const link = CONFIG.voiceLink && LinkSession.available() ? new LinkSession(setup) : null;
  const speaker = link ? new LinkSpeaker(link, chirp) : chirp;
  ride = new RideSession({
    real: h.real ?? true, desk: false, server: true, logger: h.logger,
    claude: new ClaudeClient(undefined, 2500, 6000, api('/api/phrase'), SERVER_HEADERS),
    voice: { speaker, aloud: () => true, prefetch: (t) => speaker.prefetch(t), ready: (t) => speaker.ready(t), away: () => !!link?.onPhoneSpeaker() },
    sensors: [new ExpoGeoSource((m) => log('[gps]', m)), ...(h.obd ? [h.obd] : [])],
    traffic: new TomTomTrafficProvider(null), // through Betty's server (src/adapters/server)
    // A real reader is one of the sensors and stops with the ride; without one there is no engine data.
    setObd: (_mode, push) => { if (!h.obd) push(NO_OBD); },
    events: { changed: h.changed, state: (s) => { h.state(s); link?.speed(s.speedKmh); }, endRequested: h.endRequested, toast: h.toast },
  });
  setup.tools = phoneTools(ride);
  setup.onMicFailed = (why) => ride.sayNow(why === 'busy' ? CONFIG.phoneLines.micBusy : CONFIG.phoneLines.micFailed, true);
  const voice: VoiceSession | LinkSession = link ?? new VoiceSession(setup);
  if (link) log('[voice]', 'Betty Link: her answers and her own lines in one voice (hold to talk)');
  // Her answers in the conversation are her line on the ride screen too (the queue never sees them), and her orb
  // speaks while she does. A line she builds on (the conversation's sentences) joins the one before it.
  let said = { text: '', at: 0 };
  voice.onSaid = (t) => {
    const join = Date.now() - said.at < 4000;
    said = { text: join ? `${said.text} ${t}` : t, at: Date.now() };
    ride.lastSaid = { text: said.text, tag: 'rider_query', priority: 4, at: said.at };
    ride.lastLine = said.text;
    if (ride.speaking?.tag === 'rider_query') ride.speaking = { ...ride.speaking, text: said.text };
    h.changed();
  };
  // One voice at a time: while he talks to her or she answers through the call, her own lines (status updates,
  // stories) wait and one already playing stops. Each phase has an upper limit, so a lost event cannot mute her.
  let convo: ReturnType<typeof setTimeout> | undefined;
  const busyFor = (ms: number) => { clearTimeout(convo); ride.conversation(true); convo = setTimeout(() => ride.conversation(false), ms); };
  voice.onRiderTurn = (on) => busyFor(on ? 30_000 : 8_000); // released: her answer is on its way (or nothing came)
  setAudioLog((m) => log('[audio]', m));
  let answering = false; // his music ducks while she answers through the call too
  voice.onSpeaking = (on) => {
    // Betty Link handles his music itself (expo-audio must not touch the sound then).
    if (!link && on !== answering) { answering = on; if (on) lineStart(); else lineEnd(); }
    ride.speaking = on ? { text: '…', tag: 'rider_query', priority: 4, at: Date.now() } : null;
    busyFor(on ? 60_000 : 4_000); // a few seconds after her answer: a follow-up, or her next sentence
    h.changed();
  };
  await ride.start();

  return {
    ride,
    voice,
    ask: (text: string) => void ride.ask(text),
    /** Stop reacting, say the sign-off (up to 45 s), then shut down (as the web app does). */
    async end(hurry: () => boolean = () => false) {
      clearTimeout(convo);
      if (answering) { answering = false; lineEnd(); }
      if (!link) void voice.end(); // Betty Link stays up for the sign-off: it is her voice
      const out = ride.wrapUp();
      await ride.signOff(hurry);
      if (link) await link.end();
      ride.shutdown();
      return out;
    },
  };
}
export type Ride = Awaited<ReturnType<typeof startRide>>;

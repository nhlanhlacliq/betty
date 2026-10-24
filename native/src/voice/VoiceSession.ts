import { PipecatClient, type Transport } from '@pipecat-ai/client-js';
import { NativeModules } from 'react-native';
import { reapply, setCall, setTalking } from '../adapters/AudioFocus';
import { RNDailyTransport } from '@pipecat-ai/react-native-daily-transport';

/**
 * Talking to Betty through the voice server (voice/ in the repo; voice.forme.africa): Daily audio, streamed hearing,
 * Claude with tools, her streamed Chirp voice (~2 s from the end of his question). Push-to-talk: the mic is ON ONLY
 * while he holds the button, so a helmet is in call mode only for those seconds and his music is untouched otherwise;
 * opening the mic while she speaks interrupts her (the server stops at once when it hears him).
 *
 * The connection opens on the first press and stays up for the ride (the server ends it after a few idle minutes; the
 * next press reconnects). With each press the phone sends the ride situation; the server asks the phone to carry out
 * phone tools ({t: 'tool', id, name, args}) and gets the result back as a 'tool-result' message.
 *
 * OPEN MIC (owner, 2026-10-23, to test hands-free on the bike): mode 'open' keeps the mic on for the whole connection
 * and the server only answers a sentence with "Betty" in it (then follow-ups for a few seconds without the name; see
 * voice/bot.py). Costs: a helmet stays in CALL MODE (music at call quality, its button sends call controls) and hearing
 * is billed for every minute. The situation goes every SITUATION_EVERY_MS instead of per press. Switching mode
 * reconnects (the server picks its turn rules when the session starts).
 */
export type VoiceMode = 'ptt' | 'open';
export type PhoneTool = (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
export interface VoiceSetup {
  /** Betty's prompt with the rider's settings (bettySystemPrompt + the rider_query flavour) */
  system: string;
  situation: () => { text: string; lat: number | null; lon: number | null };
  tools: Record<string, PhoneTool>;
  log: (msg: string) => void;
}

const URL = process.env.EXPO_PUBLIC_VOICE_URL ?? 'https://voice.forme.africa';
const AUTH = `Basic ${btoa(`${process.env.EXPO_PUBLIC_VOICE_USER ?? 'app'}:${process.env.EXPO_PUBLIC_VOICE_TOKEN ?? ''}`)}`;
/** Keep the mic open this long after release, so the last word is not cut off. */
const RELEASE_TAIL_MS = 400;
/** Open mic: how often the ride situation is sent (there are no presses to carry it). */
const SITUATION_EVERY_MS = 15_000;

export class VoiceSession {
  private client: PipecatClient | null = null;
  private connecting: Promise<void> | null = null;
  private releaseTimer: ReturnType<typeof setTimeout> | null = null;
  private situationTimer: ReturnType<typeof setInterval> | null = null;
  private micOn = false;
  /** The talk button is down (a release during the helmet's switch must win) */
  private held = false;
  mode: VoiceMode = 'ptt';
  state: 'off' | 'connecting' | 'ready' | 'listening' = 'off';
  onState: (s: VoiceSession['state']) => void = () => {};
  /** Each sentence she says in the conversation (the ride screen shows it as her line) */
  onSaid: (text: string) => void = () => {};
  /** His words, once the server has the final transcript (the headset button ends his turn on it) */
  onHeardRider: (text: string) => void = () => {};
  /** She starts or stops talking in the conversation (the orb) */
  onSpeaking: (on: boolean) => void = () => {};
  /** His turn starts (talk pressed) or ends (released): her own lines wait meanwhile */
  onRiderTurn: (on: boolean) => void = () => {};
  /** The last sentence reported: the server sends each one twice (written, then spoken), shown once */
  private lastOut = { text: '', at: 0 };

  constructor(private setup: VoiceSetup) {}

  private set(s: VoiceSession['state']) { this.state = s; void setCall(s !== 'off'); this.onState(s); }

  /**
   * Daily sets the phone's sound up as a phone call (helmet hands-free) when it joins and whenever the sound restarts.
   * "idle" makes it leave the sound to us (AudioFocus picks hands-free only while he talks). iPhone only.
   */
  private leaveSoundToUs() {
    try { (NativeModules as { WebRTCModule?: { setDailyAudioMode?: (m: string) => void } }).WebRTCModule?.setDailyAudioMode?.('idle'); } catch { /* not there */ }
  }

  private connect(): Promise<void> {
    if (this.client && this.state !== 'off') return Promise.resolve();
    if (this.connecting) return this.connecting;
    this.set('connecting');
    const t0 = Date.now();
    const mode = this.mode;
    this.connecting = (async () => {
      const client = new PipecatClient({
        // Cast: RN's MediaDeviceInfo type differs from the DOM one the client is typed against; same at runtime.
        transport: new RNDailyTransport() as unknown as Transport,
        enableMic: this.mode === 'open', // push-to-talk: on only while the button is held
        enableCam: false,
        callbacks: {
          onDisconnected: () => { this.client = null; this.stopSituation(); this.set('off'); this.setup.log('voice: disconnected'); },
          onServerMessage: (data: unknown) => void this.onServerMessage(data),
          // The conversation on the phone's screen too (owner, 2026-10-23: only the old path's lines showed).
          onUserTranscript: (d) => { if (d.final && d.text.trim()) { this.setup.log(`you: ${d.text.trim()}`); this.onHeardRider(d.text.trim()); } },
          onBotOutput: (d) => {
            const kind = d.text_type ?? d.aggregated_by;
            const text = d.text.trim();
            if (kind !== 'sentence' || !text) return;
            if (text === this.lastOut.text && Date.now() - this.lastOut.at < 30_000) return; // the second copy
            this.lastOut = { text, at: Date.now() };
            this.setup.log(`betty: ${text}`); this.onSaid(text);
          },
          onBotStartedSpeaking: () => this.onSpeaking(true),
          onBotStoppedSpeaking: () => this.onSpeaking(false),
          onError: (e: unknown) => this.setup.log(`voice error: ${JSON.stringify(e).slice(0, 200)}`),
        },
      });
      await client.startBotAndConnect({
        endpoint: `${URL}/start`,
        headers: new Headers({ Authorization: AUTH }),
        requestData: { transport: 'daily', createDailyRoom: true, body: { system: this.setup.system, greet: false, ptt: this.mode === 'ptt', mode: this.mode, situation: this.setup.situation() } },
      });
      if (mode !== this.mode) { await client.disconnect().catch(() => {}); this.set('off'); return; } // switched meanwhile
      this.client = client;
      this.micOn = this.mode === 'open';
      this.leaveSoundToUs();
      await setTalking(this.micOn);
      await reapply();
      if (this.mode === 'open') this.startSituation();
      this.set(this.micOn ? 'listening' : 'ready');
      this.setup.log(`voice: connected in ${Date.now() - t0} ms (${this.mode === 'open' ? 'open mic, say "Betty"' : 'push-to-talk'})`);
    })().catch((e) => {
      this.client = null; this.set('off');
      this.setup.log(`voice: could not connect: ${(e as Error)?.message ?? e}`);
      throw e;
    }).finally(() => { this.connecting = null; });
    return this.connecting;
  }

  /** Pick push-to-talk or open mic. A live connection is closed and, for open mic, opened again in the new mode. */
  async setMode(mode: VoiceMode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.setup.log(`voice: ${mode === 'open' ? 'open mic on (say "Betty...")' : 'back to push-to-talk'}`);
    if (this.connecting) await this.connecting.catch(() => {}); // let a connect in flight finish (it notices the switch)
    await this.end();
    if (mode === 'open') await this.connect().catch(() => {});
  }

  /** Open mic: the button mutes and unmutes (a robot, a phone call). Connects if the connection had dropped. */
  async toggleMic() {
    if (this.mode !== 'open') return;
    if (!this.client) { await this.connect().catch(() => {}); return; }
    this.micOn = !this.micOn;
    if (this.micOn) await setTalking(true); // the helmet's mic first, then the call's
    this.client.enableMic(this.micOn);
    if (!this.micOn) void setTalking(false); // muted: the helmet goes back to stereo (music, buttons)
    if (this.micOn) this.client.sendClientMessage('situation', this.setup.situation());
    this.setup.log(`voice: mic ${this.micOn ? 'on' : 'muted'}`);
    this.set(this.micOn ? 'listening' : 'ready');
  }

  private startSituation() {
    this.stopSituation();
    this.situationTimer = setInterval(() => this.client?.sendClientMessage('situation', this.setup.situation()), SITUATION_EVERY_MS);
  }

  private stopSituation() {
    if (this.situationTimer) clearInterval(this.situationTimer);
    this.situationTimer = null;
  }

  /** Talk button pressed: connect if needed, send the situation, open the mic. */
  async press() {
    if (this.mode !== 'ptt') return;
    if (this.releaseTimer) { clearTimeout(this.releaseTimer); this.releaseTimer = null; }
    this.held = true;
    this.onRiderTurn(true);
    await this.connect();
    const c = this.client;
    if (!c) return;
    c.sendClientMessage('situation', this.setup.situation());
    this.leaveSoundToUs();
    await setTalking(true); // the helmet switches to hands-free (its mic), up to 1.5 s
    if (!this.held) return; // let go while the helmet was switching: release() closes it all again
    c.enableMic(true);
    c.sendClientMessage('ptt', { down: true }); // his turn starts: she stops talking
    this.set('listening');
  }

  /** Talk button released: close the mic a moment later (the end of the last word). */
  release() {
    if (this.mode !== 'ptt') return;
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    this.held = false;
    this.onRiderTurn(false);
    this.releaseTimer = setTimeout(() => {
      this.releaseTimer = null;
      this.client?.enableMic(false);
      void setTalking(false); // the helmet back to stereo: her answer and his music at full quality, buttons work
      // His turn ends on release, not on a guessed pause: she answers what he said, whole (no half sentences).
      this.client?.sendClientMessage('ptt', { down: false });
      if (this.client) this.set('ready');
    }, RELEASE_TAIL_MS);
  }

  /** A phone tool the server asks for: carry it out here and send the result back. */
  private async onServerMessage(data: unknown) {
    const msg = (data as { t?: string }).t ? (data as Record<string, unknown>) : ((data as { data?: Record<string, unknown> }).data ?? {});
    if (msg.t !== 'tool') return;
    const name = String(msg.name), id = String(msg.id);
    const tool = this.setup.tools[name];
    let result: Record<string, unknown>;
    try {
      result = tool ? await tool((msg.args as Record<string, unknown>) ?? {}) : { error: 'Not available on this phone yet.' };
    } catch (e) {
      result = { error: `That did not work on the phone: ${(e as Error)?.message ?? e}` };
    }
    this.setup.log(`voice tool ${name}(${JSON.stringify(msg.args ?? {})}) -> ${JSON.stringify(result).slice(0, 160)}`);
    this.client?.sendClientMessage('tool-result', { id, result });
  }

  async end() {
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    this.stopSituation();
    this.micOn = false;
    try { await this.client?.disconnect(); } catch { /* already gone */ }
    this.client = null;
    this.set('off');
  }
}

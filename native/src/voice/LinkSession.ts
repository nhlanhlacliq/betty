import { bettyLink } from '../../modules/betty-link';
import { CONFIG } from '../../../src/config/betty';
import type { SpeakTag, Speaker } from '../../../src/core/AudioQueue';
import { voiceTags } from '../../../src/core/ClaudeClient';
import type { VoiceMode, VoiceSetup } from './VoiceSession';

/**
 * A ride's conversation over BETTY LINK (2026-10-25, owner: "go ahead" after the voice lab passed on the V6): our own
 * WebSocket to the voice server instead of the Daily call (VoiceSession). The native module (modules/betty-link) owns
 * ALL of the phone's sound: stereo between turns, hands-free only while he holds the button (with the chime), his music
 * paused for his turn and back (dipped, paused or kept: Garage) after her answer.
 *
 * ONE VOICE: her own lines (briefing, alerts, stories) go to the server as text (`say`) and are spoken in the same
 * stream as her answers (LinkSpeaker, below), so two voices cannot play at once; the server keeps them in her context.
 * The phone's queue still decides WHEN she speaks. Without a connection, LinkSpeaker falls back to the phone's own voice.
 *
 * Same surface as VoiceSession, so the ride screen, lock cover and rig use either. Push-to-talk only: open mic and the
 * headset buttons still need the call (Garage > Talking to Betty > Betty Link off).
 */
const URL = (process.env.EXPO_PUBLIC_VOICE_URL ?? 'https://voice.forme.africa').replace(/^http/, 'ws') + '/ws-client';
const AUTH = `Basic ${btoa(`${process.env.EXPO_PUBLIC_VOICE_USER ?? 'app'}:${process.env.EXPO_PUBLIC_VOICE_TOKEN ?? ''}`)}`;
const TAIL_MS = 400; // the mic stays open a moment after release, for the last word
let msgId = 0;
const rtvi = (type: string, data: unknown) => JSON.stringify({ label: 'rtvi-ai', type, id: String(++msgId), data });
const clientMessage = (t: string, d: unknown) => rtvi('client-message', { t, d });

export class LinkSession {
  readonly kind = 'link' as const;
  mode: VoiceMode = 'ptt';
  state: 'off' | 'connecting' | 'ready' | 'listening' = 'off';
  onState: (s: LinkSession['state']) => void = () => {};
  onSaid: (text: string) => void = () => {};
  onHeardRider: (text: string) => void = () => {};
  /** She is answering him (from her first thought to her last word): the ride holds its own lines meanwhile */
  onSpeaking: (on: boolean) => void = () => {};
  onRiderTurn: (on: boolean) => void = () => {};
  /** One of her own lines (LinkSpeaker): its audio started / it is over */
  onLineStart: () => void = () => {};
  onLineEnd: () => void = () => {};

  private connecting: Promise<void> | null = null;
  private subs: Array<{ remove(): void }> = [];
  private held = false;
  private answering = false;
  private thinking = false;
  private lastOut = { text: '', at: 0 };
  /** Her own lines sent recently: their sentences come back as bot-output and are not her "answers" */
  private sent: Array<{ text: string; at: number }> = [];
  /** The ride is over (end() called): no reconnecting. */
  private ended = false;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private retries = 0;

  constructor(private setup: VoiceSetup) {}

  static available() { return bettyLink != null; }
  get connected() { return this.state !== 'off' && this.state !== 'connecting'; }

  private set(s: LinkSession['state']) { this.state = s; this.onState(s); }

  private connect(): Promise<void> {
    if (!bettyLink) return Promise.reject(new Error('This build has no Betty Link'));
    if (this.connected) return Promise.resolve();
    if (this.connecting) return this.connecting;
    const link = bettyLink;
    this.set('connecting');
    const t0 = Date.now();
    this.listen();
    this.connecting = (async () => {
      const body = { system: this.setup.system, greet: false, ptt: true, mode: 'ptt', situation: this.setup.situation(), keyterms: this.setup.keyterms?.() ?? [] };
      const where = await link.connect(URL, AUTH, JSON.stringify({ t: 'start', body }));
      link.setGain(CONFIG.voiceBoostDb);
      link.setMusic(CONFIG.musicWhileSpeaking);
      link.send(rtvi('client-ready', { version: '2.1.0', about: { library: 'betty-link' } }));
      this.set('ready');
      this.setup.log(`voice: Betty Link connected in ${Date.now() - t0} ms; ${where}`);
    })().catch((e) => {
      this.set('off');
      this.setup.log(`voice: Betty Link could not connect: ${(e as Error)?.message ?? e}`);
      throw e;
    }).finally(() => { this.connecting = null; });
    return this.connecting;
  }

  private listen() {
    if (!bettyLink || this.subs.length) return;
    this.subs = [
      bettyLink.addListener('onLog', (e) => this.setup.log(`link: ${e.msg}`)),
      bettyLink.addListener('onMessage', (e) => void this.onMessage(e.json)),
      bettyLink.addListener('onState', (e) => {
        if (e.state === 'closed') {
          this.setup.log(`voice: Betty Link closed${e.detail ? ` (${e.detail})` : ''}`);
          this.set('off');
          this.endAnswer();
          this.onLineEnd();
          this.reconnectLater(); // a signal drop on a ride (2026-10-25 11:59): back on as soon as it can
        } else if (e.state === 'speaking') {
          this.onLineStart();
        } else if (e.state === 'drained') {
          this.onLineEnd(); // her line has been heard to the end: the queue may go on (the music stays dipped)
        } else if (e.state === 'quiet') {
          this.onLineEnd();
          if (!this.thinking) this.endAnswer();
        }
      }),
    ];
  }

  /** After a drop: try again at 2, 5, 10, 20, then every 30 s, until the ride ends. Meanwhile her lines use the phone. */
  private reconnectLater() {
    if (this.ended || this.retry) return;
    const wait = [2, 5, 10, 20][this.retries] ?? 30;
    this.retries++;
    this.retry = setTimeout(() => {
      this.retry = undefined;
      if (this.ended || this.connected || this.connecting) return;
      this.setup.log(`voice: Betty Link reconnecting (try ${this.retries})`);
      this.connect().then(() => { this.retries = 0; }).catch(() => this.reconnectLater());
    }, wait * 1000);
  }

  private endAnswer() { if (this.answering) { this.answering = false; this.onSpeaking(false); } }

  /** Open the connection now (ride start), so the first press does not wait for it. */
  warm() { void this.connect().catch(() => {}); }

  /** Open mic is not on Betty Link yet: he keeps hold-to-talk. */
  async setMode(mode: VoiceMode) {
    if (mode === 'open') this.setup.log('voice: open mic is not on Betty Link yet, hold to talk (or turn Betty Link off in Garage > Talking to Betty)');
  }
  async toggleMic() { /* push-to-talk only */ }

  async press() {
    this.held = true;
    this.onRiderTurn(true);
    if (!this.connected) await this.connect();
    if (!bettyLink || !this.held) { if (!this.held) this.finishTurn(); return; }
    bettyLink.send(clientMessage('situation', this.setup.situation()));
    bettyLink.send(clientMessage('ptt', { down: true })); // his turn: she stops at once
    this.set('listening');
    this.setup.log(`link: ${await bettyLink.mic(true)}`);
    if (!this.held) void this.finishTurn(); // let go while the helmet was switching
  }

  release() {
    this.held = false;
    this.onRiderTurn(false);
    setTimeout(() => { if (!this.held) void this.finishTurn(); }, TAIL_MS);
  }

  private async finishTurn() {
    if (!bettyLink || this.state !== 'listening') return;
    this.set('ready');
    this.setup.log(`link: ${await bettyLink.mic(false)}`);
    bettyLink.send(clientMessage('ptt', { down: false }));
  }

  /** One of her own lines, spoken in the conversation. False when there is no connection (the caller uses the phone). */
  say(text: string): boolean {
    if (!bettyLink || !this.connected) return false;
    const now = Date.now();
    this.sent = [...this.sent.filter((s) => now - s.at < 120_000), { text, at: now }];
    bettyLink.send(clientMessage('say', { text }));
    return true;
  }

  /** Stop her own line now (an alert goes first, "be quiet"). */
  stopLine() {
    if (!bettyLink || !this.connected) return;
    bettyLink.send(clientMessage('stop', {}));
    bettyLink.flush();
  }

  private ownLine(sentence: string) { return this.sent.some((s) => s.text.includes(sentence)); }

  private async onMessage(json: string) {
    let m: { type?: string; data?: any };
    try { m = JSON.parse(json); } catch { return; }
    const d = m.data ?? {};
    switch (m.type) {
      case 'user-transcription':
        if (d.final && String(d.text ?? '').trim()) { const t = String(d.text).trim(); this.setup.log(`you: ${t}`); this.onHeardRider(t); }
        break;
      case 'bot-llm-started':
        this.thinking = true;
        if (!this.answering) { this.answering = true; this.onSpeaking(true); }
        break;
      case 'bot-llm-stopped':
        this.thinking = false;
        break;
      case 'bot-output': {
        const text = String(d.text ?? '').trim();
        if ((d.text_type ?? d.aggregated_by) !== 'sentence' || !text) break;
        if (text === this.lastOut.text && Date.now() - this.lastOut.at < 30_000) break; // sent twice: written, spoken
        this.lastOut = { text, at: Date.now() };
        if (this.ownLine(text)) break; // one of her own lines: the queue has it already
        this.setup.log(`betty: ${text}`);
        this.onSaid(text);
        break;
      }
      case 'server-message':
        if (d.t === 'tool') await this.runTool(String(d.id), String(d.name), (d.args as Record<string, unknown>) ?? {});
        break;
    }
  }

  private async runTool(id: string, name: string, args: Record<string, unknown>) {
    const tool = this.setup.tools[name];
    let result: Record<string, unknown>;
    try { result = tool ? await tool(args) : { error: 'Not available on this phone yet.' }; }
    catch (e) { result = { error: `That did not work on the phone: ${(e as Error)?.message ?? e}` }; }
    this.setup.log(`voice tool ${name}(${JSON.stringify(args)}) -> ${JSON.stringify(result).slice(0, 160)}`);
    bettyLink?.send(clientMessage('tool-result', { id, result }));
  }

  async end() {
    this.ended = true;
    clearTimeout(this.retry); this.retry = undefined;
    this.held = false;
    for (const s of this.subs) s.remove();
    this.subs = [];
    bettyLink?.disconnect();
    this.answering = false; this.thinking = false;
    this.set('off');
  }
}

/**
 * Her own lines through Betty Link (one voice with her answers). Calls onDone when the native side says her voice has
 * gone quiet, or after a deadline from the line's length (it ALWAYS calls onDone: the queue rule). A line that does not
 * start within 4 s, or any line while there is no connection, is said by the backup (Chirp on the phone, then the
 * phone's own voice).
 */
export class LinkSpeaker implements Speaker {
  private line: { heard: () => void; end: () => void } | null = null;

  constructor(private link: LinkSession, private backup: Speaker & { prefetch?(t: string): void; ready?(t: string): Promise<unknown> }) {
    link.onLineStart = () => this.line?.heard();
    link.onLineEnd = () => this.line?.end();
  }

  prefetch(text: string) { if (!this.link.connected) this.backup.prefetch?.(text); }
  ready(text: string) { return this.link.connected ? Promise.resolve(null) : (this.backup.ready?.(text) ?? Promise.resolve(null)); }

  speak(text: string, onDone: () => void, tag?: SpeakTag) {
    const spoken = voiceTags(text, false); // no <laugh>: Chirp would read it out
    if (!this.link.say(spoken)) { this.backup.speak(text, onDone, tag); return; }
    let over = false, started = false;
    const finish = () => { if (over) return; over = true; clearTimeout(deadline); clearTimeout(noStart); if (this.line === l) this.line = null; onDone(); };
    const l = { heard: () => { if (!started) { started = true; tag?.heard?.(); } }, end: () => { if (started) finish(); } };
    this.line = l;
    const deadline = setTimeout(finish, 6000 + text.length * 90);
    const noStart = setTimeout(() => { // nothing came back: the phone says it instead
      if (started || over) return;
      over = true; clearTimeout(deadline); if (this.line === l) this.line = null;
      this.link.stopLine();
      this.backup.speak(text, onDone, tag);
    }, 4000);
  }

  stop() {
    if (this.line) { this.line = null; this.link.stopLine(); }
    this.backup.stop();
  }
}

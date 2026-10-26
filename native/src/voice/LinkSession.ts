import { bettyLink } from '../../modules/betty-link';
import { CONFIG } from '../../../src/config/betty';
import type { SpeakTag, Speaker } from '../../../src/core/AudioQueue';
import { voiceTags } from '../../../src/core/ClaudeClient';
import { SpeedVoice, type SpeedVoiceOut } from '../../../src/core/Loudness';
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
 * Same surface as VoiceSession, so the ride screen, lock cover and rig use either. Three ways to talk (2026-10-25, one at
 * a time): hold to talk; open mic (`setMode('open')`: the mic open all ride with echo cancelling, "Betty..." to talk,
 * the session restarts in the server's wake-word mode); headset buttons (`setButtons`: Betty is Now Playing, play/pause
 * = talk via `onButton`, his music off while she holds them).
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
  /** Headset buttons (Betty holds them): play/pause = talk, next = repeat, previous = let go */
  onButton: (kind: 'talk' | 'next' | 'previous') => void = () => {};
  private buttonsOn = false;
  private muted = false;
  /** Her loudness follows his speed (core/Loudness); the last values sent to the module. */
  private speedVoice = new SpeedVoice();
  private atSpeedNoted = false;
  private loud: SpeedVoiceOut = { gainDb: CONFIG.voiceBoostDb, share: 0, pauseMusic: false };
  private situationTimer: ReturnType<typeof setInterval> | undefined;

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

  /** His speed (each GPS update): louder, brighter and the music paused at speed; his own setting in town. */
  speed(kmh: number) {
    // Never let this break the ride: it runs inside every GPS update (ride of 2026-10-26: nothing from it in the log
    // at 140 km/h, so a failure here is reported once instead of passing silently).
    try {
      const next = this.speedVoice.update(kmh, { baseDb: CONFIG.voiceBoostDb, extraDb: CONFIG.voiceAtSpeedDb, pauseMusic: CONFIG.pauseMusicAtSpeed });
      const was = this.loud;
      if (next.gainDb === was.gainDb && next.share === was.share && next.pauseMusic === was.pauseMusic) return;
      this.loud = next;
      if (next.pauseMusic !== was.pauseMusic) this.setup.log(`voice: ${next.pauseMusic ? `at speed (${Math.round(kmh)} km/h, +${next.gainDb} dB): her lines pause your music` : `slower (+${next.gainDb} dB): her lines dip your music again`}`);
      if (bettyLink && this.connected) this.applyLoudness(bettyLink);
    } catch (e) { this.speedFailed(e); }
  }
  private speedFailedOnce = false;
  private speedFailed(e: unknown) {
    if (this.speedFailedOnce) return;
    this.speedFailedOnce = true;
    this.setup.log(`voice: her loudness at speed failed (${e instanceof Error ? e.message : String(e)})`);
  }

  private applyLoudness(link: NonNullable<typeof bettyLink>) {
    try {
      link.setGain(this.loud.gainDb);
      link.setSpeedVoice?.(this.loud.share); // (a build from before 2026-10-25 has no voice chain)
      link.setMusic(this.loud.pauseMusic ? 'pause' : CONFIG.musicWhileSpeaking);
    } catch (e) { this.speedFailed(e); }
  }

  /** Her sound is on the phone's own speaker (no helmet, or it dropped): her own remarks may wait (CONFIG.onPhoneSpeaker). */
  onPhoneSpeaker(): boolean {
    let out = '';
    try { out = bettyLink?.route().split('out:')[1] ?? ''; } catch { return false; }
    const phone = /\((Speaker|Receiver)\)/.test(out) && !/Bluetooth|Headphones|CarAudio/.test(out);
    if (phone !== this.wasPhone) {
      this.wasPhone = phone;
      this.setup.log(phone ? `voice: her sound is on the phone speaker (${out.trim()})${CONFIG.onPhoneSpeaker === 'alerts' ? ': only alerts and answers until the helmet is back' : ''}` : `voice: her sound is back on ${out.trim()}`);
    }
    return phone;
  }
  private wasPhone = false;
  get connected() { return this.state !== 'off' && this.state !== 'connecting'; }

  private set(s: LinkSession['state']) { this.state = s; this.onState(s); }

  private connect(force = false): Promise<void> {
    if (!bettyLink) return Promise.reject(new Error('This build has no Betty Link'));
    if (this.connected && !force) return Promise.resolve();
    if (this.connecting) return this.connecting;
    const link = bettyLink;
    this.set('connecting');
    const t0 = Date.now();
    this.listen();
    this.connecting = (async () => {
      const open = this.mode === 'open';
      const body = { system: this.setup.system, greet: false, ptt: !open, mode: open ? 'open' : 'ptt', situation: this.setup.situation(), keyterms: this.setup.keyterms?.() ?? [] };
      const where = await link.connect(URL, AUTH, JSON.stringify({ t: 'start', body }));
      this.applyLoudness(link);
      if (!this.atSpeedNoted) { // once a ride, so the log says this build has it and how it is set
        this.atSpeedNoted = true;
        const c = CONFIG.voiceAtSpeed;
        this.setup.log(`voice: louder at speed ${CONFIG.voiceAtSpeedDb ? `+${CONFIG.voiceAtSpeedDb} dB from ${c.fromKmh} to ${c.fullKmh} km/h` : 'off'}, music ${CONFIG.pauseMusicAtSpeed ? `paused from ${c.pauseOnKmh} km/h` : 'never paused at speed'}${link.setSpeedVoice ? '' : ' (no voice chain in this build)'}`);
      }
      link.send(rtvi('client-ready', { version: '2.1.0', about: { library: 'betty-link' } }));
      this.set('ready');
      this.setup.log(`voice: Betty Link connected in ${Date.now() - t0} ms (${open ? 'open mic, say "Betty"' : 'hold to talk'}); ${where}`);
      if (open) {
        this.setup.log(`link: ${await link.openMic(true)}`);
        this.muted = false;
        this.set('listening');
        clearInterval(this.situationTimer); // no presses to carry the ride situation: send it every 15 s
        this.situationTimer = setInterval(() => { if (this.connected) link.send(clientMessage('situation', this.setup.situation())); }, 15_000);
      } else {
        clearInterval(this.situationTimer);
        if (this.buttonsOn) link.buttons(true);
      }
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
      bettyLink.addListener('onButton', (e) => this.onButton(e.kind)),
      bettyLink.addListener('onMessage', (e) => void this.onMessage(e.json)),
      bettyLink.addListener('onState', (e) => {
        if (e.state === 'closed') {
          this.setup.log(`voice: Betty Link closed${e.detail ? ` (${e.detail})` : ''}`);
          if (this.connecting) return; // our own reconnect (a new mode) closed the old one
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

  /** Hold to talk or open mic. The server picks its turn rules when a session starts, so a change mid-ride reconnects
   *  (well under a second on Betty Link). Before the first connection it only notes the mode. */
  async setMode(mode: VoiceMode) {
    if (mode === this.mode) return;
    const was = this.mode;
    this.mode = mode;
    this.setup.log(`voice: ${mode === 'open' ? 'open mic on (say "Betty...")' : 'back to hold to talk'}`);
    if (this.state === 'off' && !this.connecting) return;
    if (this.connecting) await this.connecting.catch(() => {});
    if (was === 'open') await bettyLink?.openMic(false);
    await this.connect(true).catch(() => this.reconnectLater());
  }

  /** Open mic: the app's mic button mutes and unmutes (the mic stays open; nothing is sent while muted). */
  async toggleMic() {
    if (this.mode !== 'open' || !bettyLink) return;
    if (!this.connected) { await this.connect().catch(() => {}); return; }
    this.muted = !this.muted;
    bettyLink.mute(this.muted);
    if (!this.muted) bettyLink.send(clientMessage('situation', this.setup.situation()));
    this.setup.log(`voice: mic ${this.muted ? 'muted' : 'on'}`);
    this.set(this.muted ? 'ready' : 'listening');
  }

  /** Headset buttons for Betty (his music off while she holds them), or back to his music. */
  setButtons(on: boolean) {
    this.buttonsOn = on;
    if (this.connected && this.mode !== 'open') bettyLink?.buttons(on);
    else if (!on) bettyLink?.buttons(false);
  }

  async press() {
    if (this.mode === 'open') return; // open mic: just talk ("Betty...")
    this.held = true;
    this.onRiderTurn(true);
    if (!this.connected) await this.connect();
    if (!bettyLink || !this.held) { if (!this.held) this.finishTurn(); return; }
    bettyLink.send(clientMessage('situation', this.setup.situation()));
    bettyLink.send(clientMessage('ptt', { down: true })); // his turn: she stops at once
    this.set('listening');
    const opened = await bettyLink.mic(true);
    this.setup.log(`link: ${opened}`);
    if (opened.startsWith('mic failed')) { // end the turn now, and say so, instead of a silent wait for an answer
      this.held = false;
      this.set('ready');
      bettyLink.send(clientMessage('ptt', { down: false }));
      this.onRiderTurn(false);
      this.setup.onMicFailed?.(opened.replace('mic failed: ', ''));
      return;
    }
    if (!this.held) void this.finishTurn(); // let go while the helmet was switching
  }

  release() {
    if (this.mode === 'open') return;
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
        // Open mic: the moment "Betty" is heard it is his turn: her own line stops, the rest wait.
        if (this.mode === 'open' && /\bbett(y|ie)\b/i.test(String(d.text ?? ''))) { this.onRiderTurn(true); this.onRiderTurn(false); }
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
    clearInterval(this.situationTimer);
    if (this.buttonsOn) bettyLink?.buttons(false); // his music and the buttons back
    if (this.mode === 'open') await bettyLink?.openMic(false);
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

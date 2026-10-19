import { PipecatClient, type Transport } from '@pipecat-ai/client-js';
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
 */
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

export class VoiceSession {
  private client: PipecatClient | null = null;
  private connecting: Promise<void> | null = null;
  private releaseTimer: ReturnType<typeof setTimeout> | null = null;
  state: 'off' | 'connecting' | 'ready' | 'listening' = 'off';
  onState: (s: VoiceSession['state']) => void = () => {};

  constructor(private setup: VoiceSetup) {}

  private set(s: VoiceSession['state']) { this.state = s; this.onState(s); }

  private connect(): Promise<void> {
    if (this.client && this.state !== 'off') return Promise.resolve();
    if (this.connecting) return this.connecting;
    this.set('connecting');
    const t0 = Date.now();
    this.connecting = (async () => {
      const client = new PipecatClient({
        // Cast: RN's MediaDeviceInfo type differs from the DOM one the client is typed against; same at runtime.
        transport: new RNDailyTransport() as unknown as Transport,
        enableMic: false, // push-to-talk: on only while the button is held
        enableCam: false,
        callbacks: {
          onDisconnected: () => { this.client = null; this.set('off'); this.setup.log('voice: disconnected'); },
          onServerMessage: (data: unknown) => void this.onServerMessage(data),
          onError: (e: unknown) => this.setup.log(`voice error: ${JSON.stringify(e).slice(0, 200)}`),
        },
      });
      await client.startBotAndConnect({
        endpoint: `${URL}/start`,
        headers: new Headers({ Authorization: AUTH }),
        requestData: { transport: 'daily', createDailyRoom: true, body: { system: this.setup.system, greet: false, ptt: true, situation: this.setup.situation() } },
      });
      this.client = client;
      this.set('ready');
      this.setup.log(`voice: connected in ${Date.now() - t0} ms`);
    })().catch((e) => {
      this.client = null; this.set('off');
      this.setup.log(`voice: could not connect: ${(e as Error)?.message ?? e}`);
      throw e;
    }).finally(() => { this.connecting = null; });
    return this.connecting;
  }

  /** Talk button pressed: connect if needed, send the situation, open the mic. */
  async press() {
    if (this.releaseTimer) { clearTimeout(this.releaseTimer); this.releaseTimer = null; }
    await this.connect();
    const c = this.client;
    if (!c) return;
    c.sendClientMessage('situation', this.setup.situation());
    c.enableMic(true);
    c.sendClientMessage('ptt', { down: true }); // his turn starts: she stops talking
    this.set('listening');
  }

  /** Talk button released: close the mic a moment later (the end of the last word). */
  release() {
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    this.releaseTimer = setTimeout(() => {
      this.releaseTimer = null;
      this.client?.enableMic(false);
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
    try { await this.client?.disconnect(); } catch { /* already gone */ }
    this.client = null;
    this.set('off');
  }
}

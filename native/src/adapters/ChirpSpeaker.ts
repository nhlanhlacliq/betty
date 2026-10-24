import { createAudioPlayer, AudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { CONFIG, chirpVoice } from '../../../src/config/betty';
import type { SpeakTag, Speaker } from '../../../src/core/AudioQueue';
import { voiceTags } from '../../../src/core/ClaudeClient';
import { serverFetch } from '../../../src/adapters/server';
import { lineEnd, lineStart } from './AudioFocus';

/** Clips kept on the phone (repeats, "Hang on", a queued line are instant); the oldest go past this. */
const KEEP = 40;

/**
 * Her own lines (briefing, alerts, banter, stories, sign-off) in her Chirp voice, as on the web: `/api/speak` (Chirp 3 HD,
 * MP3) through Betty's server, saved to the phone's cache and played with expo-audio. Fetched the moment a line is
 * written (`prefetch`), so it is usually in before its turn. A clip that is not in within its wait (2 s + 15 ms a
 * character, at least 3.5 s: the web's numbers), fails, or will not play is said by the phone voice instead (`backup`).
 * Like every speaker it ALWAYS calls onDone (a deadline from its length), so a lost callback cannot jam the queue.
 * (His answers in a conversation come from the voice server, not from here.)
 */
export class ChirpSpeaker implements Speaker {
  private clips = new Map<string, Promise<string | null>>();
  private player: AudioPlayer | null = null;
  private gen = 0;
  /** Lets the music back up when a line is cut off (stop) before it finished */
  private endLine: (() => void) | null = null;
  private seq = 0;

  constructor(private backup: Speaker, private log: (msg: string) => void = () => {}) {}

  private body(text: string) {
    const v = chirpVoice();
    return { text: voiceTags(text, false), engine: 'chirp', voice: v.name, locale: v.locale, ...(CONFIG.voiceBoostDb > 0 ? { gainDb: CONFIG.voiceBoostDb } : {}) };
  }

  /** The clip's file on the phone, or null when Chirp could not make it. */
  private clip(text: string): Promise<string | null> {
    const key = JSON.stringify(this.body(text));
    const have = this.clips.get(key);
    if (have) return have;
    const p = (async () => {
      try {
        const res = await serverFetch('/api/speak', { method: 'POST', headers: { 'content-type': 'application/json' }, body: key });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const file = new File(Paths.cache, `betty-${Date.now()}-${++this.seq}.mp3`);
        await file.write(await res.arrayBuffer());
        return file.uri;
      } catch (e) {
        this.clips.delete(key); // try again next time
        this.log(`Chirp: ${(e as Error).message}; the phone voice says it`);
        return null;
      }
    })();
    this.clips.set(key, p);
    while (this.clips.size > KEEP) {
      const [old, uri] = this.clips.entries().next().value!;
      this.clips.delete(old);
      void uri.then((u) => { if (u) try { new File(u).delete(); } catch { /* already gone */ } });
    }
    return p;
  }

  prefetch(text: string, _tag?: SpeakTag) { void this.clip(text); }
  ready(text: string, _tag?: SpeakTag) { return this.clip(text); }

  speak(text: string, onDone: () => void, tag?: SpeakTag) {
    const my = ++this.gen;
    let done = false;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let ducked = false;
    const unduck = () => { if (ducked) { ducked = false; lineEnd(); } };
    this.endLine = unduck;
    const finish = () => { if (done) return; done = true; clearTimeout(deadline); this.release(); unduck(); onDone(); };
    const phone = () => { if (my === this.gen && !done) { done = true; clearTimeout(deadline); this.backup.speak(text, onDone, tag); } };
    const wait = Math.max(3500, 2000 + text.length * 15);
    const late = setTimeout(phone, wait);
    void this.clip(text).then((uri) => {
      clearTimeout(late);
      if (my !== this.gen || done) return;
      if (!uri) { phone(); return; }
      try {
        lineStart(); ducked = true; // his music ducks while she speaks
        const player = createAudioPlayer({ uri });
        this.release();
        this.player = player;
        let started = false;
        player.addListener('playbackStatusUpdate', (st) => {
          if (my !== this.gen) return;
          if (st.playing && !started) { started = true; tag?.heard?.(); }
          if (st.didJustFinish) finish();
        });
        player.play();
        // Written off after a deadline from its length (about 12 characters a second plus 5 s).
        deadline = setTimeout(() => { if (my === this.gen) this.log(`Chirp: no end after ${text.length} chars, moving on`); finish(); }, 5000 + text.length * 85);
      } catch (e) {
        this.log(`Chirp: would not play (${(e as Error).message}); the phone voice says it`);
        unduck(); phone();
      }
    });
  }

  private release() { try { this.player?.remove(); } catch { /* gone */ } this.player = null; }

  stop() { this.gen++; this.endLine?.(); this.endLine = null; this.release(); this.backup.stop(); }
}

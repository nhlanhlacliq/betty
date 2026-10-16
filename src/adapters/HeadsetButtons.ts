import { quietWav, toneWav } from './audio';

/**
 * Takes the headset's media buttons for Betty for the length of a ride. iPhone sends those buttons to whichever
 * app last started playing sound, so Betty plays a near-silent loop. That pauses music from other apps: on the
 * bike test (2026-10-14) starting it paused his music and the presses then reached Betty. Hence it is a per-ride
 * switch on the start screen, off by default.
 */
export class HeadsetButtons {
  private audio: HTMLAudioElement | null = null;
  private held = false;
  private quietUrl = '';
  /** Until when a tone is swapping the track: its pause/emptied events are expected, not news */
  private toneUntil = 0;
  private tones = new Map<number, string>();
  private log: (msg: string) => void = () => {};

  /** Must run inside the START RIDE tap: the phone only lets a page start sound from a tap. */
  prime() {
    try {
      this.quietUrl = URL.createObjectURL(quietWav());
      this.audio = new Audio(this.quietUrl);
      // What the phone does to the track, for the log: the buttons stop arriving when it stops playing.
      for (const t of ['pause', 'play', 'stalled', 'emptied'] as const) {
        this.audio.addEventListener(t, () => { if (this.held && t !== 'play' && Date.now() > this.toneUntil) this.log(`silent track: ${t}`); });
      }
      this.audio.loop = true;
      void this.audio.play().catch(() => {});
    } catch { this.audio = null; }
  }

  /** Route play/pause to talk() and next track to repeat(). Returns false if this browser cannot do it. */
  start(on: { talk(): void; repeat(): void }, log: (msg: string) => void = () => {}): boolean {
    this.log = log;
    const ms = 'mediaSession' in navigator ? navigator.mediaSession : undefined;
    if (!ms || !this.audio) return false;
    const keepPlaying = () => this.resume();
    // Opening the mic pauses the loop on iPhone, and a page that is not playing stops getting the buttons: only
    // the first press got through until the test was restarted (2026-10-14). Start it again whenever it stops.
    this.audio.addEventListener('pause', () => { if (this.held) setTimeout(() => this.resume(), 300); });
    try {
      const MM = (window as any).MediaMetadata;
      if (MM) ms.metadata = new MM({ title: 'Betty is listening for your buttons', artist: 'Betty' });
    } catch { /* cosmetic */ }
    const set = (a: MediaSessionAction, f: (() => void) | null) => { try { ms.setActionHandler(a, f); } catch { /* unsupported */ } };
    // A press shows up as play or pause depending on what the phone thinks is happening: both mean "talk".
    set('play', () => { this.log('button: play'); keepPlaying(); on.talk(); });
    set('pause', () => { this.log('button: pause'); keepPlaying(); on.talk(); });
    set('nexttrack', () => { this.log('button: next track'); keepPlaying(); on.repeat(); });
    // Owner: previous track does nothing. Registered anyway (as the VOICE TEST did, the setup that kept working),
    // so no press falls through to the phone.
    for (const a of ['previoustrack', 'seekbackward', 'seekforward', 'stop'] as MediaSessionAction[]) {
      set(a, () => { this.log(`button: ${a} (does nothing)`); keepPlaying(); });
    }
    this.held = true;
    try { ms.playbackState = 'playing'; } catch { /* older browsers */ }
    return true;
  }

  /**
   * Plays a tone on the silent track itself and goes back to the loop. The tones used to come from a separate Web
   * Audio context, which on iPhone is likely what took the buttons away after the first press (2026-10-16: the
   * VOICE TEST, which has no tones, got five presses in a row; talking to Betty got one). False if not holding.
   */
  tone(freq: number): boolean {
    const a = this.audio;
    if (!this.held || !a) return false;
    let url = this.tones.get(freq);
    if (!url) { url = URL.createObjectURL(toneWav(freq)); this.tones.set(freq, url); }
    const back = () => { a.removeEventListener('ended', back); a.loop = true; a.src = this.quietUrl; this.resume(); };
    this.toneUntil = Date.now() + 1500;
    a.loop = false; a.src = url;
    a.addEventListener('ended', back);
    void a.play().catch((e) => { this.log(`tone did not play: ${(e as Error).name}`); back(); });
    return true;
  }

  /** Make sure the loop is playing, so the next press still reaches Betty. Call it after the mic closes. */
  resume() {
    if (!this.held || !this.audio) return;
    if (this.audio.paused) void this.audio.play().catch((e) => this.log(`could not restart the silent track: ${(e as Error).name}`));
    try { navigator.mediaSession.playbackState = 'playing'; } catch { /* older browsers */ }
  }

  get holding() { return this.held; }

  stop() {
    if (this.held && 'mediaSession' in navigator) {
      for (const a of ['play', 'pause', 'nexttrack', 'previoustrack', 'seekbackward', 'seekforward', 'stop'] as MediaSessionAction[]) {
        try { navigator.mediaSession.setActionHandler(a, null); } catch { /* unsupported */ }
      }
    }
    this.held = false; // before pause(), so the pause listener leaves it stopped
    this.audio?.pause();
    this.audio = null;
  }
}

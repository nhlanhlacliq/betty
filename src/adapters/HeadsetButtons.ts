import { quietWav } from './audio';

/**
 * Takes the headset's media buttons for Betty for the length of a ride. iPhone sends those buttons to whichever
 * app last started playing sound, so Betty plays a near-silent loop. That pauses music from other apps: on the
 * bike test (2026-10-14) starting it paused his music and the presses then reached Betty. Hence it is a per-ride
 * switch on the start screen, off by default.
 */
export class HeadsetButtons {
  private audio: HTMLAudioElement | null = null;
  private held = false;

  /** Must run inside the START RIDE tap: the phone only lets a page start sound from a tap. */
  prime() {
    try {
      this.audio = new Audio(URL.createObjectURL(quietWav()));
      this.audio.loop = true;
      void this.audio.play().catch(() => {});
    } catch { this.audio = null; }
  }

  /** Route play/pause to talk() and next track to repeat(). Returns false if this browser cannot do it. */
  start(on: { talk(): void; repeat(): void }): boolean {
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
    set('play', () => { keepPlaying(); on.talk(); });
    set('pause', () => { keepPlaying(); on.talk(); });
    set('nexttrack', () => { keepPlaying(); on.repeat(); });
    this.held = true;
    try { ms.playbackState = 'playing'; } catch { /* older browsers */ }
    return true;
  }

  /** Make sure the loop is playing, so the next press still reaches Betty. Call it after the mic closes. */
  resume() {
    if (!this.held || !this.audio) return;
    if (this.audio.paused) void this.audio.play().catch(() => {});
    try { navigator.mediaSession.playbackState = 'playing'; } catch { /* older browsers */ }
  }

  stop() {
    if (this.held && 'mediaSession' in navigator) {
      for (const a of ['play', 'pause', 'nexttrack'] as MediaSessionAction[]) {
        try { navigator.mediaSession.setActionHandler(a, null); } catch { /* unsupported */ }
      }
    }
    this.held = false; // before pause(), so the pause listener leaves it stopped
    this.audio?.pause();
    this.audio = null;
  }
}

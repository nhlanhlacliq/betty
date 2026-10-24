import { AudioPlaylist, createAudioPlaylist } from 'expo-audio';
import { setExclusive } from './AudioFocus';

/**
 * The helmet's buttons for Betty (stage 6, 2026-10-24; the web's HeadsetButtons, native): iPhone sends the headset's
 * play/pause and next/previous to the app that is "Now Playing", so Betty plays a near-silent playlist on the lock
 * screen (three copies of a minute of silence, looping). Play/pause arrives as the playlist pausing, next/previous as
 * a track change. Holding the sound like this PAUSES his music (doNotMix): it is a per-ride switch, as on the web.
 *   play/pause -> talk (open mic: mute/unmute)   next track -> repeat her last line   previous -> let go (music back)
 * UNVERIFIED on the phone: whether the buttons still arrive after the voice server's mic has been open (call mode).
 */
const SILENCE = require('../../assets/silence.wav');
const MIDDLE = 1;
/** A pause right after we started talking or changed track is ours (or the mic's), not a press. */
const QUIET_MS = 1500;

export interface ButtonHooks { talk(): void; repeat(): void; letGo(): void }

export class HeadsetButtons {
  private pl: AudioPlaylist | null = null;
  private subs: Array<{ remove(): void }> = [];
  private ignoreUntil = 0;
  private lastSkip = 0;
  holding = false;

  constructor(private log: (msg: string) => void = () => {}) {}

  async start(h: ButtonHooks): Promise<boolean> {
    if (this.pl) return true;
    try {
      await setExclusive(true);
      const pl = createAudioPlaylist({ sources: [SILENCE, SILENCE, SILENCE], loop: 'all', updateInterval: 300 });
      this.pl = pl;
      this.quiet();
      pl.skipTo(MIDDLE);
      pl.play();
      pl.setActiveForLockScreen(true, { title: 'Betty', artist: 'Riding with you' }, { showNextTrack: true, showPreviousTrack: true, isLiveStream: true });
      this.lastSkip = Date.now();
      this.subs.push(pl.addListener('trackChanged', ({ previousIndex, currentIndex }) => {
        if (Date.now() < this.ignoreUntil) return;
        // The minute ran out on its own (not a press): carry on.
        if (Date.now() - this.lastSkip > 55_000 && currentIndex === (previousIndex + 1) % 3) { this.lastSkip = Date.now(); return; }
        const forward = currentIndex === (previousIndex + 1) % 3;
        this.log(`button: ${forward ? 'next track' : 'previous track'}`);
        this.quiet(); pl.skipTo(MIDDLE); this.lastSkip = Date.now();
        if (forward) h.repeat(); else h.letGo();
      }));
      this.subs.push(pl.addListener('playlistStatusUpdate', (st) => {
        if (st.playing || !this.pl || Date.now() < this.ignoreUntil) return;
        // Paused, and not by us: the play/pause button. Keep the silence going so the next press arrives too.
        this.log('button: play/pause');
        this.quiet(); pl.play();
        h.talk();
      }));
      this.holding = true;
      return true;
    } catch (e) {
      this.log(`headset buttons: could not start (${(e as Error).message})`);
      await this.stop();
      return false;
    }
  }

  /** After talking (the mic stops the silence on some phones): play again, and do not read that as a press. */
  resume() { if (!this.pl) return; this.quiet(); try { this.pl.play(); } catch { /* gone */ } }

  /** Horizon's top card as the lock screen's "Now Playing" title. */
  setNowPlaying(title: string) { try { this.pl?.updateLockScreenMetadata({ title: title || 'Betty', artist: 'Riding with you' }); } catch { /* gone */ } }

  async stop() {
    for (const s of this.subs) s.remove();
    this.subs = [];
    const pl = this.pl;
    this.pl = null; this.holding = false;
    if (pl) { try { pl.clearLockScreenControls(); pl.pause(); pl.release(); } catch { /* gone */ } }
    await setExclusive(false);
  }

  private quiet() { this.ignoreUntil = Date.now() + QUIET_MS; }
}

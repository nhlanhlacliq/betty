export type WakeStatus = 'on' | 'off' | 'unsupported';

/**
 * Keeps the screen on so the browser doesn't throttle GPS/timers. The system drops the lock whenever the tab is
 * hidden or the phone is locked, so it is re-acquired each time the tab returns. Reports its state so the rider
 * can see at a glance whether the screen will stay on.
 */
export class WakeLock {
  private lock: WakeLockSentinel | null = null;
  private active = false;
  private onVis = () => { if (this.active && document.visibilityState === 'visible') void this.acquire(); };

  constructor(private onStatus: (s: WakeStatus) => void = () => {}) {}

  async enable() {
    this.active = true;
    document.addEventListener('visibilitychange', this.onVis);
    await this.acquire();
  }
  async disable() {
    this.active = false;
    document.removeEventListener('visibilitychange', this.onVis);
    try { await this.lock?.release(); } catch { /* ignore */ }
    this.lock = null;
  }
  private async acquire() {
    if (!('wakeLock' in navigator)) { this.onStatus('unsupported'); return; }
    try {
      const lock = await navigator.wakeLock.request('screen');
      this.lock = lock;
      lock.addEventListener('release', () => { if (this.lock === lock) { this.lock = null; if (this.active) this.onStatus('off'); } });
      this.onStatus('on');
    } catch {
      this.onStatus('off'); // denied, low battery mode, or the page is not visible
    }
  }
}

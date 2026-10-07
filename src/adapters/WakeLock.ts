/** Keeps the screen on so the browser doesn't throttle GPS/timers. Re-acquired when the tab returns. */
export class WakeLock {
  private lock: WakeLockSentinel | null = null;
  private active = false;
  private onVis = () => { if (this.active && document.visibilityState === 'visible') this.acquire(); };

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
    try { this.lock = await navigator.wakeLock?.request('screen') ?? null; } catch { /* unsupported or denied */ }
  }
}

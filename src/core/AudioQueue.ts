import { CONFIG } from '../config/betty';
import { Priority } from './types';

export interface Speaker {
  speak(text: string, onDone: () => void): void;
  stop(): void;
}
export interface QueueItem { text: string; priority: Priority; queuedAt: number }

/**
 * P1 interrupts immediately. P4 (rider-initiated) always speaks next.
 * P2/P3 wait for a safe window. P3 is rate-limited and dropped if it ages past ambientMaxAgeMs.
 * A generation counter makes callbacks from interrupted speech harmless (cancelled utterances still fire onend).
 */
export class AudioQueue {
  private items: QueueItem[] = [];
  private speaking: Priority | null = null;
  private lastAmbientAt = -Infinity;
  private gen = 0;

  constructor(
    private speaker: Speaker,
    private isSafe: () => boolean,
    private now: () => number = Date.now,
  ) {}

  enqueue(text: string, priority: Priority) {
    if (!text.trim()) return; // silence is a valid output (ambient flavours)
    if (priority === 1) {
      this.items = this.items.filter((i) => i.priority === 1);
      if (this.speaking !== null) this.speaker.stop();
      this.speaking = null;
      this.gen++;
    }
    if (priority === 3 && this.now() - this.lastAmbientAt < CONFIG.ambientCooldownMs) return;
    this.items.push({ text, priority, queuedAt: this.now() });
    this.items.sort((a, b) => a.priority - b.priority || a.queuedAt - b.queuedAt);
    this.pump();
  }

  /** Call periodically (e.g. each state tick) so deferred items get their safe window. */
  pump() {
    if (this.speaking !== null) return;
    this.items = this.items.filter((i) => !(i.priority === 3 && this.now() - i.queuedAt > CONFIG.ambientMaxAgeMs));
    const idx = this.items.findIndex((i) => i.priority <= 1 || i.priority === 4 || this.isSafe());
    if (idx === -1) return;
    const [item] = this.items.splice(idx, 1);
    this.speaking = item.priority;
    if (item.priority === 3) this.lastAmbientAt = this.now();
    const gen = ++this.gen;
    this.speaker.speak(item.text, () => {
      if (gen !== this.gen) return; // stale: this speech was interrupted or cleared
      this.speaking = null;
      this.pump();
    });
  }

  clear() {
    this.items = [];
    this.gen++;
    if (this.speaking !== null) this.speaker.stop();
    this.speaking = null;
  }

  get pending() { return this.items.length; }
  get speakingPriority() { return this.speaking; }
}

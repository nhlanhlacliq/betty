import { CONFIG } from '../config/betty';
import { Priority } from './types';

export interface Speaker {
  speak(text: string, onDone: () => void): void;
  stop(): void;
}
export interface QueueItem { text: string; priority: Priority; queuedAt: number; fate: Fate }
/** What became of a line: waiting its turn, being spoken, finished, or why it was never (fully) heard. */
export type Fate = 'queued' | 'speaking' | 'spoken' | 'expired' | 'interrupted' | 'cleared';

/**
 * One line at a time, never overlapping: a line that arrives while another is playing waits and is spoken after it.
 * P1 is the exception: it interrupts immediately and clears whatever else is waiting. P4 (rider-initiated) goes
 * ahead of P2/P3. P2/P3 wait for a safe window. A P3 that has waited longer than ambientMaxAgeMs is dropped as stale.
 * How often ambient lines are created is the TriggerEngine's job; the queue speaks everything it is given.
 * A generation counter makes callbacks from interrupted speech harmless (cancelled utterances still fire onend).
 */
export class AudioQueue {
  private items: QueueItem[] = [];
  private speaking: QueueItem | null = null;
  private gen = 0;

  constructor(
    private speaker: Speaker,
    private isSafe: () => boolean,
    private now: () => number = Date.now,
    private report: (item: QueueItem, fate: Fate) => void = () => {},
  ) {}

  private onFate(item: QueueItem, fate: Fate) { item.fate = fate; this.report(item, fate); }

  /** Returns the queued item (to follow its fate), or null when there is nothing to say. */
  enqueue(text: string, priority: Priority): QueueItem | null {
    if (!text.trim()) return null; // silence is a valid output (ambient flavours)
    if (priority === 1) {
      this.items.filter((i) => i.priority !== 1).forEach((i) => this.onFate(i, 'interrupted'));
      this.items = this.items.filter((i) => i.priority === 1);
      if (this.speaking) { this.speaker.stop(); this.onFate(this.speaking, 'interrupted'); }
      this.speaking = null;
      this.gen++;
    }
    const item: QueueItem = { text, priority, queuedAt: this.now(), fate: 'queued' };
    this.items.push(item);
    this.items.sort((a, b) => a.priority - b.priority || a.queuedAt - b.queuedAt);
    this.onFate(item, 'queued');
    this.pump();
    return item;
  }

  /** Call periodically (e.g. each state tick) so deferred items get their safe window. */
  pump() {
    if (this.speaking !== null) return;
    const stale = (i: QueueItem) => i.priority === 3 && this.now() - i.queuedAt > CONFIG.ambientMaxAgeMs;
    this.items.filter(stale).forEach((i) => this.onFate(i, 'expired'));
    this.items = this.items.filter((i) => !stale(i));
    const idx = this.items.findIndex((i) => i.priority <= 1 || i.priority === 4 || this.isSafe());
    if (idx === -1) return;
    const [item] = this.items.splice(idx, 1);
    this.speaking = item;
    const gen = ++this.gen;
    this.onFate(item, 'speaking');
    this.speaker.speak(item.text, () => {
      if (gen !== this.gen) return; // stale: this speech was interrupted or cleared
      this.speaking = null;
      this.onFate(item, 'spoken');
      this.pump();
    });
  }

  clear() {
    this.items.forEach((i) => this.onFate(i, 'cleared'));
    this.items = [];
    this.gen++;
    if (this.speaking) { this.speaker.stop(); this.onFate(this.speaking, 'cleared'); }
    this.speaking = null;
  }

  get pending() { return this.items.length; }
  get speakingPriority(): Priority | null { return this.speaking?.priority ?? null; }
}

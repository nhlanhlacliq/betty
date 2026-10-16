import { CONFIG } from '../config/betty';
import { Priority } from './types';

export interface Speaker {
  speak(text: string, onDone: () => void): void;
  stop(): void;
}
const RANK: Record<Priority, number> = { 1: 0, 4: 1, 2: 2, 3: 3 };

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
  private held = false;
  private riderThrough = false;

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
    // Order: critical, then his own question or request, then advisories, then ambient. Sorting by the raw number
    // put a rider answer behind waiting banter, contradicting "P4 always speaks next".
    this.items.sort((a, b) => RANK[a.priority] - RANK[b.priority] || a.queuedAt - b.queuedAt);
    this.onFate(item, 'queued');
    this.pump();
    return item;
  }

  /**
   * While he is talking to her (push-to-talk), she must not start a line over him. Held lines wait; a critical
   * alert still goes. Releasing lets the waiting lines play in the usual order.
   */
  /** Hold her lines while he talks. riderThrough: he has finished, so his answer (P4) may go, nothing else. */
  hold(on: boolean, riderThrough = false) { this.held = on; this.riderThrough = on && riderThrough; this.pump(); }
  get isHeld() { return this.held; }

  /** Call periodically (e.g. each state tick) so deferred items get their safe window. */
  pump() {
    if (this.speaking !== null) return;
    const stale = (i: QueueItem) => i.priority === 3 && this.now() - i.queuedAt > CONFIG.ambientMaxAgeMs;
    this.items.filter(stale).forEach((i) => this.onFate(i, 'expired'));
    this.items = this.items.filter((i) => !stale(i));
    const idx = this.items.findIndex((i) => i.priority <= 1 || (i.priority === 4 && this.riderThrough) || (!this.held && (i.priority === 4 || this.isSafe())));
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

  /** He asked for quiet: drop waiting ambient lines (alerts and answers stay). */
  dropAmbient() {
    this.items.filter((i) => i.priority === 3).forEach((i) => this.onFate(i, 'cleared'));
    this.items = this.items.filter((i) => i.priority !== 3);
  }

  get pending() { return this.items.length; }
  get speakingPriority(): Priority | null { return this.speaking?.priority ?? null; }
}

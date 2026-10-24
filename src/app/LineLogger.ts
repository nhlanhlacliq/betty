import type { Fate, QueueItem } from '../core/AudioQueue';
import type { LogEntry } from '../core/LineLog';
import { LineLogStore } from '../adapters/LineLogStore';

/** One line in the log: something she said (with its queue item, so its fate shows), or a note like `[voice] ...`. */
export interface LogLine { id: string; at: number; rideId: number; head: string; text: string; item: QueueItem | null }

export const FATE_LABELS: Record<Fate, string> = {
  queued: 'waiting to speak', speaking: 'speaking now', spoken: 'spoken', expired: 'not spoken: waited too long',
  interrupted: 'cut off', cleared: 'cleared',
};
const SETTLED: Fate[] = ['spoken', 'expired', 'interrupted', 'cleared'];
export const settled = (f: Fate) => SETTLED.includes(f);

const toEntry = (l: LogLine): LogEntry => ({
  id: l.id, at: l.at, rideId: l.rideId, head: l.head, text: l.text, fate: l.item ? FATE_LABELS[l.item.fate] : '',
});

/**
 * Everything she said and every note, saved on the phone (LineLogStore) shortly after a change. Lines still waiting
 * or playing stay unsaved so their final fate is written too. Shared by both apps; `rideId` ties a line to its ride.
 */
export class LineLogger {
  /** The current session's lines, newest first (what a screen shows). */
  readonly lines: LogLine[] = [];
  private unsaved: LogLine[] = [];
  private seq = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** The ride a new line belongs to (0 = none: the line's own time is used). */
  rideId = 0;

  constructor(public onChange: () => void = () => {}) {}

  add(head: string, text: string): LogLine {
    const at = Date.now();
    const line: LogLine = { id: `${at}-${++this.seq}`, at, rideId: this.rideId || at, head, text, item: null };
    this.lines.unshift(line);
    if (this.lines.length > 500) this.lines.length = 500;
    this.unsaved.push(line);
    this.saveSoon();
    this.onChange();
    return line;
  }

  /** Write to the phone now. */
  save() {
    LineLogStore.save(this.unsaved.map(toEntry));
    this.unsaved = this.unsaved.filter((l) => l.item && !settled(l.item.fate));
  }

  saveSoon() {
    if (this.timer !== undefined) return;
    this.timer = setTimeout(() => { this.timer = undefined; this.save(); }, 2000);
  }

  /** A ride was deleted: its lines must not be written back by the next save. */
  forgetRide(rideId: number) { this.unsaved = this.unsaved.filter((l) => l.rideId !== rideId); }
  /** The saved log was cleared. */
  forgetUnsaved() { this.unsaved = []; }
  /** The screen starts clean (the saved log keeps the earlier lines). */
  clearScreen() { this.lines.length = 0; this.onChange(); }
}

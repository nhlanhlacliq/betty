import { BikeState } from './BikeState';
import { TriggerPriority, TriggerType } from './TriggerEvent';

/**
 * One entry in Betty's session memory — what she said and when.
 */
export interface MemoryEntry {
  timestamp: number;
  triggerType: TriggerType;
  spokenText: string;
  bikeStateSnapshot: BikeState;
  priority: TriggerPriority;
}

const MAX_ENTRIES = 50;

/**
 * Circular buffer keeping the last 50 interactions for context injection.
 */
export class SessionMemory {
  private entries: MemoryEntry[] = [];

  add(entry: MemoryEntry): void {
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.shift();
    }
  }

  /** Returns the last N entries, newest last. */
  getLast(n: number): MemoryEntry[] {
    return this.entries.slice(-n);
  }

  /** Returns all entries. */
  getAll(): MemoryEntry[] {
    return [...this.entries];
  }

  /** Resets memory at the start of a new ride session. */
  clear(): void {
    this.entries = [];
  }

  get size(): number {
    return this.entries.length;
  }
}

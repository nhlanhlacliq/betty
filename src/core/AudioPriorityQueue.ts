import { TriggerEvent, TriggerPriority } from '../models/TriggerEvent';
import { BikeState } from '../models/BikeState';
import { SafeWindowEvaluator } from './SafeWindowEvaluator';
import { TTSEngine } from '../adapters/interfaces';

const QUEUE_MAX = 5;
const RETRY_INTERVAL_MS = 2000;

type DeliveredCallback = (event: TriggerEvent, spokenText: string) => void;

/**
 * L6 — AudioPriorityQueue
 *
 * Manages the queue of pending TriggerEvents and delivers them via TTS.
 *
 * P1 Critical — interrupt anything, speak immediately.
 * P4 Query    — respond immediately after any P1 clears.
 * P2 Advisory — queue (max 5), drain when safe window is open.
 * P3 Ambient  — queue (max 5), drain when safe window is open.
 */
export class AudioPriorityQueue {
  private p2Queue: TriggerEvent[] = [];
  private p3Queue: TriggerEvent[] = [];
  private retryTimer: ReturnType<typeof setInterval> | null = null;
  private callbacks: Set<DeliveredCallback> = new Set();
  private safeWindow: SafeWindowEvaluator;
  private latestState: BikeState | null = null;

  constructor(private tts: TTSEngine) {
    this.safeWindow = new SafeWindowEvaluator();
  }

  setLatestState(state: BikeState): void {
    this.latestState = state;
  }

  enqueue(event: TriggerEvent, spokenText: string): void {
    switch (event.priority) {
      case TriggerPriority.P1_CRITICAL:
        this.deliverNow(event, spokenText);
        break;

      case TriggerPriority.P4_QUERY:
        this.deliverNow(event, spokenText);
        break;

      case TriggerPriority.P2_ADVISORY:
        if (this.p2Queue.length < QUEUE_MAX) {
          this.p2Queue.push({ ...event, context: { ...event.context, _text: spokenText } });
          this.ensureRetryLoop();
        }
        break;

      case TriggerPriority.P3_AMBIENT:
        if (this.p3Queue.length < QUEUE_MAX) {
          this.p3Queue.push({ ...event, context: { ...event.context, _text: spokenText } });
          this.ensureRetryLoop();
        }
        break;
    }
  }

  onDelivered(callback: DeliveredCallback): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  stop(): void {
    if (this.retryTimer) clearInterval(this.retryTimer);
    this.tts.stop();
  }

  private deliverNow(event: TriggerEvent, text: string): void {
    this.tts.speak(text).then(() => {
      this.callbacks.forEach((cb) => cb(event, text));
    });
  }

  private ensureRetryLoop(): void {
    if (this.retryTimer) return;
    this.retryTimer = setInterval(() => this.tryDrain(), RETRY_INTERVAL_MS);
  }

  private tryDrain(): void {
    if (!this.latestState) return;
    if (!this.safeWindow.isSafe(this.latestState, this.tts.isSpeaking())) return;

    // Drain P2 before P3
    const event = this.p2Queue.shift() ?? this.p3Queue.shift();
    if (!event) {
      // Nothing left — stop the loop
      if (this.retryTimer) {
        clearInterval(this.retryTimer);
        this.retryTimer = null;
      }
      return;
    }

    const text = String(event.context._text ?? '');
    this.deliverNow(event, text);
  }
}

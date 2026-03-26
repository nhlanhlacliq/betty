import { BikeState } from '../models/BikeState';
import { SessionMemory, MemoryEntry } from '../models/SessionMemory';
import { TriggerEvent, TriggerPriority } from '../models/TriggerEvent';
import { StateAggregator } from './StateAggregator';
import { TriggerEngine } from './TriggerEngine';
import { ClaudeAPIClient } from './ClaudeAPIClient';
import { AudioPriorityQueue } from './AudioPriorityQueue';
import { STTEngine } from '../adapters/interfaces';
import { createTriggerEvent, TriggerType } from '../models/TriggerEvent';

/**
 * L3 — RideSessionManager
 *
 * Orchestrates a complete ride session:
 * - Starts / stops all layers
 * - Routes TriggerEvents through Claude and into the AudioPriorityQueue
 * - Records delivered responses in SessionMemory
 * - Handles voice query passthrough
 */
export class RideSessionManager {
  private memory = new SessionMemory();
  private active = false;
  private unsubscribers: Array<() => void> = [];

  constructor(
    private aggregator: StateAggregator,
    private triggerEngine: TriggerEngine,
    private claude: ClaudeAPIClient,
    private audioQueue: AudioPriorityQueue,
    private stt: STTEngine,
  ) {}

  async start(): Promise<void> {
    if (this.active) return;
    this.active = true;
    this.memory.clear();
    this.triggerEngine.resetSession();

    // Start the data pipeline
    await this.aggregator.start();

    // Wire state changes into the trigger engine and audio queue
    this.unsubscribers.push(
      this.aggregator.subscribe((state) => {
        this.audioQueue.setLatestState(state);
        this.triggerEngine.evaluate(state);
      }),
    );

    // Handle trigger events
    this.unsubscribers.push(
      this.triggerEngine.onTrigger((event) => {
        this.handleTrigger(event);
      }),
    );

    // Handle voice queries from STT
    this.unsubscribers.push(
      this.stt.onResult((text) => {
        this.handleVoiceQuery(text);
      }),
    );

    // Record delivered audio in memory
    this.unsubscribers.push(
      this.audioQueue.onDelivered((event, spokenText) => {
        const entry: MemoryEntry = {
          timestamp: Date.now(),
          triggerType: event.type,
          spokenText,
          bikeStateSnapshot: event.bikeState,
          priority: event.priority,
        };
        this.memory.add(entry);
      }),
    );

    console.log('[RideSession] Started');
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.unsubscribers.forEach((fn) => fn());
    this.unsubscribers = [];
    this.aggregator.stop();
    this.audioQueue.stop();
    console.log('[RideSession] Stopped');
  }

  getMemory(): SessionMemory {
    return this.memory;
  }

  isActive(): boolean {
    return this.active;
  }

  private async handleTrigger(event: TriggerEvent): Promise<void> {
    const state = this.aggregator.getState();

    // Safety gate: never speak mid-corner or at high RPM (except P1 critical)
    if (event.priority !== TriggerPriority.P1_CRITICAL) {
      if (state.leanAngle >= 20 || state.rpm >= 6000) {
        // Drop non-critical trigger if conditions are unsafe for any speech
        console.log(
          `[RideSession] Dropped ${event.type} — unsafe riding conditions`,
        );
        return;
      }
    }

    const recentMemory = this.memory.getLast(10);
    const spokenText = await this.claude.generateResponse(
      event,
      state,
      recentMemory,
    );

    this.audioQueue.enqueue(event, spokenText);
  }

  private handleVoiceQuery(text: string): void {
    const state = this.aggregator.getState();
    const event = createTriggerEvent(
      TriggerPriority.P4_QUERY,
      TriggerType.VOICE_QUERY,
      { query: text },
      state,
    );
    this.handleTrigger(event);
  }
}

import Anthropic from '@anthropic-ai/sdk';
import { BikeState } from '../models/BikeState';
import { TriggerEvent } from '../models/TriggerEvent';
import { MemoryEntry } from '../models/SessionMemory';
import personalityConfig from '../config/personality.json';

const MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 80;
const TEMPERATURE = 0.7;
const MEMORY_CONTEXT_ENTRIES = 10;

/**
 * L5 — ClaudeAPIClient
 *
 * Builds requests to Claude and returns Betty's spoken response.
 * Injects: Betty's identity, current BikeState, session memory, trigger context.
 */
export class ClaudeAPIClient {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async generateResponse(
    trigger: TriggerEvent,
    state: BikeState,
    memory: MemoryEntry[],
  ): Promise<string> {
    const systemPrompt = buildSystemPrompt(state, memory);
    const userMessage = buildUserMessage(trigger);

    try {
      const response = await this.client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });

      const text = response.content
        .filter((block) => block.type === 'text')
        .map((block) => (block as { type: 'text'; text: string }).text)
        .join('');

      return text.trim();
    } catch (err) {
      console.error('[ClaudeAPI] Request failed:', err);
      // Graceful degradation: return a safe fallback message
      return getFallbackMessage(trigger);
    }
  }
}

function buildSystemPrompt(state: BikeState, memory: MemoryEntry[]): string {
  const { identity, rules } = personalityConfig;
  const recentMemory = memory
    .slice(-MEMORY_CONTEXT_ENTRIES)
    .map(
      (m, i) =>
        `${i + 1}. [${m.triggerType}] "${m.spokenText}"`,
    )
    .join('\n');

  return `${identity}

PERSONALITY RULES:
${rules.map((r: string) => `- ${r}`).join('\n')}

CURRENT BIKE STATE:
${JSON.stringify(
  {
    speed: `${state.speed} km/h`,
    rpm: state.rpm,
    coolantTemp: `${state.coolantTemp}°C`,
    throttlePos: `${state.throttlePos}%`,
    engineLoad: `${state.engineLoad}%`,
    batteryVoltage: `${state.batteryVoltage}V`,
    frontTyrePSI: state.frontTyrePSI,
    rearTyrePSI: state.rearTyrePSI,
    leanAngle: `${state.leanAngle}°`,
    braking: state.braking,
    weatherCondition: state.weatherCondition,
    weatherTemp: `${state.weatherTemp}°C`,
    dtcCodes: state.dtcCodes,
    trafficIncidents: state.trafficIncidents.length,
  },
  null,
  2,
)}

RECENT CONVERSATION (do not repeat):
${recentMemory || 'None yet.'}`;
}

function buildUserMessage(trigger: TriggerEvent): string {
  return `Trigger: ${trigger.type}
Context: ${JSON.stringify(trigger.context)}
Priority: P${trigger.priority}

Respond as Betty. One or two sentences maximum. Voice only — no visual references.`;
}

function getFallbackMessage(trigger: TriggerEvent): string {
  const fallbacks: Record<string, string> = {
    OVERTEMP: "Heads up — engine temperature is high. Keep an eye on it.",
    DTC_FAULT: "There's a fault code showing. Worth checking when you stop.",
    TYRE_PRESSURE_CRITICAL: "Tyre pressure is critically low. Pull over safely.",
    LOW_FUEL: "Fuel's getting low. Start thinking about your next stop.",
    WEATHER_RAIN: "Rain ahead. Slippery roads — take it easy.",
    TRAFFIC_INCIDENT: "There's an incident nearby. Stay alert.",
  };
  return fallbacks[trigger.type] ?? "Something needs your attention when you can safely stop.";
}

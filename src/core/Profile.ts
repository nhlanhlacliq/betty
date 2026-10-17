/**
 * His rider profile (owner, 2026-10-17: "rider context ... like a bit of salt in an already good meal"): a short
 * description distilled from what ChatGPT or Claude know about him (api/profile.ts), kept on the phone, editable.
 * The dose is decided here, per line, not left to the model (which overused "sir" when merely told to go easy):
 * - answers to him, the briefing and the sign-off: always available ("answer")
 * - banter: about one line in four may draw on it ("remark")
 * - tour guide and area stories: only to choose which story fits his interests ("interests")
 * - alerts and time checks: never
 */
import type { TriggerEvent, TriggerId } from './types';

/** How often a banter line may draw on him. The one number to tune if it feels too salty or too bland. */
export const PROFILE_BANTER_SHARE = 0.25;

export function profileUse(id: TriggerId, rng: () => number): NonNullable<TriggerEvent['profile']>['use'] | null {
  if (id === 'rider_query' || id === 'startup' || id === 'ride_debrief') return 'answer';
  if (id === 'ambient_banter') return rng() < PROFILE_BANTER_SHARE ? 'remark' : null;
  if (id === 'local_fact' || id === 'area_story') return 'interests';
  return null;
}

/** The block added to what Claude is told for one line. */
export function profileNote(p: NonNullable<TriggerEvent['profile']>): string {
  const how = p.use === 'interests'
    ? 'Use it ONLY to choose which part of the notes he would find most interesting; do not talk about him.'
    : p.use === 'remark'
      ? 'You may connect this remark to something about him, but only if it fits naturally; a light touch, never forced, and not something you already brought up this ride.'
      : 'Let it shape your answer where it genuinely helps; most of the time it stays in the background.';
  return `What you know about him (from what he chose to share): ${p.text}\n${how} Never say you were told this, never quote it, never list it.`;
}

/**
 * Every word the app shell shows (not Betty's spoken lines: those come from Claude and the canned fallbacks).
 * The design will keep changing: edit wording here, not in the screen modules.
 */
import type { TriggerId } from '../core/types';
import type { IconName } from './icons';

export interface MomentCopy { kicker: string; headline: string }

/** Ride screen while she is saying something (or just said it), by trigger id. `voice` = command replies, "hang on". */
export const MOMENTS: Record<TriggerId | 'voice', MomentCopy> = {
  startup: { kicker: 'Briefing', headline: 'Systems online.' },
  engine_overtemp: { kicker: 'Heads up', headline: 'Engine running hot.' },
  dtc_detected: { kicker: 'Heads up', headline: 'Fault code on the bike.' },
  low_fuel: { kicker: 'Heads up', headline: 'Fuel is low.' },
  fuel_range: { kicker: 'Heads up', headline: 'Range getting short.' },
  rain_soon: { kicker: 'Heads up', headline: 'Rain about.' },
  sunset_soon: { kicker: 'Heads up', headline: 'The light is going.' },
  traffic_incident: { kicker: 'Heads up', headline: 'Traffic on your way.' },
  ride_milestone: { kicker: 'Time check', headline: 'Still rolling.' },
  rider_query: { kicker: 'You asked', headline: "Here's what I know." },
  ambient_banter: { kicker: 'Betty has a thought', headline: 'Just saying.' },
  local_fact: { kicker: 'Betty has something', headline: 'Worth knowing.' },
  area_story: { kicker: 'A local story', headline: 'About this place.' },
  ride_debrief: { kicker: "That's a wrap", headline: 'Good ride.' },
  voice: { kicker: 'Betty', headline: 'On it.' },
};

/** Ride screen states that are not a line. */
export const RIDE_STATES = {
  idle: { kicker: 'Good company, no chatter', headline: 'The road has the floor.', sub: 'Betty is here, not interrupting.' },
  parked: { kicker: 'Take your time', headline: 'Taking a breather.', sub: "I'll be here when you're rolling." },
  quiet: { kicker: 'Betty is quiet', headline: 'Taking the hint.' },
  quietFor: (min: number) => `Alerts still come through. Back in ${min} minute${min === 1 ? '' : 's'}.`,
  quietUntilTold: 'Alerts still come through. Tap the speaker to have her back.',
  listening: { kicker: "I'm listening", headline: 'Go ahead.', sub: 'Tap Ask Betty again when you are done.' },
  thinking: { kicker: 'One moment', headline: 'Thinking it over.', sub: '' },
  ending: { kicker: 'Signing off', headline: 'Bringing it home.', sub: 'Tap End ride again to stop now.' },
} as const;

/** How long a finished line stays on the ride screen before it settles back to idle. */
export const LINE_LINGER_MS = 30_000;

export interface GlanceCopy { icon: IconName; label: string }
export const GLANCE: Record<'range' | 'rain' | 'traffic' | 'sunset' | 'area' | 'place' | 'riding', GlanceCopy> = {
  range: { icon: 'fuel', label: 'Fuel range · estimate' },
  rain: { icon: 'rain', label: 'On the road ahead' },
  traffic: { icon: 'traffic', label: 'Traffic on your way' },
  sunset: { icon: 'sunset', label: 'Daylight' },
  area: { icon: 'pin', label: "You're in" },
  place: { icon: 'compass', label: 'Nearby' },
  riding: { icon: 'route', label: 'Free ride' },
};

export const HOME = {
  eyebrow: 'Your open road',
  headline: ['Go on.', 'Take the', 'long way.'],
  lead: "I'll keep you company.",
  orbCaption: 'Tap to hear me',
  hello: (name: string) => `Ready when you are, ${name}. Shall we take the long way?`,
  modes: {
    real: { title: 'Free ride', sub: 'Phone GPS and sensors.' },
    sim: { title: 'Desk test', sub: 'Simulated, no sensors.' },
  },
};

export const SETTINGS_TALK: Record<'minimal' | 'balanced' | 'stories', string> = {
  minimal: 'Minimal', balanced: 'Balanced', stories: 'Stories',
};

/** The Settings "Hear a sample" line, by humour. */
export const sampleLine = (humour: number) => humour > 60
  ? 'Another coffee stop? I admire your dedication to research.'
  : "A good road ahead. I'll speak up when there's something worth knowing.";

export const END_BUTTON = { idle: 'End ride', ending: 'Ending… tap to stop now' };

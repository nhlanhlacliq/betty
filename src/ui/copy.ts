/**
 * Every word the app shell shows (not Betty's spoken lines: those come from Claude and the canned fallbacks).
 * The design will keep changing: edit wording here, not in the screen modules.
 */
import type { TriggerId } from '../core/types';
import type { IconName } from './icons';

export const BRAND = {
  tagline: 'A little more journey.',
  footer: ['A quieter mind. A better ride.', 'Made for the moments in between.'],
  profileSub: 'Just you and the road.',
  connection: 'A little more present.',
  region: 'Gauteng, South Africa',
};

export interface MomentCopy { kicker: string; headline: string }

/** Ride screen while she is saying something (or just said it), by trigger id. `voice` = command replies, "hang on". */
export const MOMENTS: Record<TriggerId | 'voice', MomentCopy> = {
  startup: { kicker: 'Before we go', headline: 'Systems online.' },
  engine_overtemp: { kicker: 'Heads up', headline: 'Engine running hot.' },
  dtc_detected: { kicker: 'Heads up', headline: 'Fault code on the bike.' },
  low_fuel: { kicker: 'Heads up', headline: 'Fuel is low.' },
  fuel_range: { kicker: 'Heads up', headline: 'Range getting short.' },
  rain_soon: { kicker: 'Heads up', headline: 'Rain about.' },
  sunset_soon: { kicker: 'Heads up', headline: 'The light is going.' },
  ride_parked: { kicker: 'Parked?', headline: "I'll keep quiet." },
  ride_record: { kicker: 'A first', headline: 'A new record.' },
  route_weather: { kicker: 'Up ahead', headline: 'Rain on the way.' },
  fatigue: { kicker: 'Take five', headline: 'Time for a break.' },
  new_road: { kicker: 'A first', headline: 'A new road.' },
  rough_patch: { kicker: 'Heads up', headline: 'Rough patch ahead.' },
  wind_cold: { kicker: 'Heads up', headline: 'Wind and cold.' },
  traffic_incident: { kicker: 'Heads up', headline: 'Traffic on your way.' },
  ride_milestone: { kicker: 'Time check', headline: 'Still rolling.' },
  rider_query: { kicker: 'You asked', headline: "Here's what I know." },
  ambient_banter: { kicker: 'A passing thought', headline: 'Just saying.' },
  local_fact: { kicker: 'A sense of place', headline: 'Worth knowing.' },
  area_story: { kicker: 'A local story', headline: 'About this place.' },
  marked_spot: { kicker: 'Heads up', headline: 'Your marked spot.' },
  off_route: { kicker: 'Heads up', headline: 'Off your route.' },
  route_stop: { kicker: 'Coming up', headline: 'Your next stop.' },
  route_arrived: { kicker: "You're here", headline: 'Destination reached.' },
  ride_debrief: { kicker: "That's a wrap", headline: 'Good ride.' },
  voice: { kicker: 'Betty', headline: 'On it.' },
};

/** Ride screen states that are not a line. */
export const RIDE_STATES = {
  idle: { kicker: 'The moment around you', headline: 'A little space to breathe.', sub: 'Betty is keeping an eye on the journey. For now, enjoy the road.' },
  parked: { kicker: 'Taking a moment', headline: 'Taking a breather.', sub: "I'll be here when you're rolling." },
  quiet: { kicker: 'A little quiet', headline: 'Taking the hint.' },
  quietFor: (min: number) => `Alerts still come through. Back in ${min} minute${min === 1 ? '' : 's'}.`,
  quietUntilTold: 'Alerts still come through. Tap Quiet again to have her back.',
  listening: { kicker: "I'm listening", headline: 'Go ahead.', sub: 'Tap the microphone again when you are done.' },
  thinking: { kicker: 'One moment', headline: 'Thinking it over.', sub: 'Let me think about that.' },
  ending: { kicker: 'Signing off', headline: 'Bringing it home.', sub: 'Tap End ride again to stop now.' },
} as const;

/** The little status beside "Your riding companion". */
export const COMPANION_STATE = {
  ready: 'Ready when you are', idle: 'Along for the ride', speaking: 'Speaking', listening: 'Listening',
  thinking: 'Thinking', quiet: 'Quiet', ending: 'Signing off',
} as const;

/** How long a finished line stays on the ride screen before it settles back to idle. */
export const LINE_LINGER_MS = 30_000;

export interface GlanceCopy { icon: IconName; label: string }
export const GLANCE: Record<'range' | 'rain' | 'traffic' | 'route' | 'offroute' | 'sunset' | 'service' | 'area' | 'place' | 'riding', GlanceCopy> = {
  service: { icon: 'wrench', label: 'Maintenance' },
  route: { icon: 'pin', label: 'Your route' },
  offroute: { icon: 'compass', label: 'Off your route' },
  range: { icon: 'fuel', label: 'Fuel range · estimate' },
  rain: { icon: 'rain', label: 'On the road ahead' },
  traffic: { icon: 'traffic', label: 'Traffic on your way' },
  sunset: { icon: 'sunset', label: 'Daylight' },
  area: { icon: 'pin', label: "You're in" },
  place: { icon: 'compass', label: 'Nearby' },
  riding: { icon: 'ride', label: 'Free ride' },
};

export const HOME = {
  eyebrow: 'A little more journey',
  headline: 'The road is yours.',
  companion: 'Ready when you are.',
  companionCaption: 'Tap me to hear my voice. Or just ride.',
  hello: (name: string) => `Ready when you are, ${name}. Shall we take the long way?`,
  pickerLabel: 'How are we riding?',
  modes: {
    real: { title: 'Free ride', sub: 'Phone GPS and sensors. Betty rides wherever you go.' },
    sim: { title: 'Desk test', sub: 'Simulated: no GPS, no sensors. For trying her out.' },
  },
  conditionLast: (km: number, when: string) => `Last ride ${km} km · ${when}`,
  conditionFirst: 'Your first ride starts here',
};

export const ASK_CHIPS = ["What's around me?", "How's the weather?", 'How far have we gone?', 'Tell me a story', 'A little quiet, please'];

export const TALK_LABELS: Record<'minimal' | 'balanced' | 'stories', string> = {
  minimal: 'Minimal', balanced: 'Balanced', stories: 'Storyteller',
};

/** The Settings "Hear Betty's voice" line, by humour. */
export const sampleLine = (humour: number) => humour > 60
  ? 'Another coffee stop? I admire your dedication to research.'
  : "A good road ahead. I'll speak up when there's something worth knowing.";

export const END_BUTTON = { idle: 'End ride', ending: 'Ending… tap to stop now' };

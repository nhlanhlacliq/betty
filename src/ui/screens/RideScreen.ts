import { icon } from '../icons';
import type { RideView } from '../rideView';

export interface RideActions {
  /** Ask Betty: start talking, or finish if already listening. */
  talk(): void;
  /** Tap on the orb: hear her last line again. */
  repeat(): void;
  /** The speaker button: ask her to be quiet, or have her back. */
  toggleQuiet(): void;
}

export interface RideExtras { status: string; wakeOk: boolean; quiet: boolean; listening: boolean }

export interface RideScreen { paint(v: RideView, x: RideExtras): void }

/**
 * Ride: Betty's orb and what she is doing, one glanceable cue, and three big controls. What to show is decided by
 * rideView (pure, tested); this only paints it, touching the DOM only where something changed.
 */
export function mountRideScreen(doc: Document, actions: RideActions): RideScreen {
  const $ = (id: string) => doc.getElementById(id)!;
  $('ask').addEventListener('click', () => actions.talk());
  $('rideorb').addEventListener('click', () => actions.repeat());
  $('mute').addEventListener('click', () => actions.toggleQuiet());

  const last = new Map<string, string>();
  const text = (id: string, value: string) => { if (last.get(id) !== value) { last.set(id, value); $(id).textContent = value; } };
  const html = (id: string, value: string) => { if (last.get(id) !== value) { last.set(id, value); $(id).innerHTML = value; } };

  return {
    paint(v, x) {
      const orb = $('rideorb');
      orb.className = `sound-orb ${v.orb}`;
      text('ridestatus', x.status);
      text('rideplace', v.place);
      text('ridedist', v.distance);
      text('ridetemp', v.temp);
      $('wakewarn').hidden = x.wakeOk;
      text('ridekicker', v.kicker);
      text('rideheadline', v.headline);
      text('ridesub', v.sub);
      const g = $('glance');
      g.parentElement!.hidden = !v.glance;
      if (v.glance) {
        html('glanceicon', icon(v.glance.icon));
        text('glancelabel', v.glance.label);
        text('glancetitle', v.glance.title);
        text('glancevalue', v.glance.value);
      }
      text('asktext', x.listening ? 'Listening… tap when done' : 'Ask Betty');
      $('ask').classList.toggle('listening', x.listening);
      const mute = $('mute');
      mute.classList.toggle('on', x.quiet);
      mute.setAttribute('aria-label', x.quiet ? 'Have Betty talk again' : 'Ask Betty to be quiet');
      html('muteicon', icon(x.quiet ? 'mute' : 'volume'));
    },
  };
}

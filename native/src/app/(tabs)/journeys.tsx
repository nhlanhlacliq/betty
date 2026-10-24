import { Text } from 'react-native';
import { RideLog } from '../../../../src/adapters/RideLog';
import { useBetty } from '../../state/Betty';
import { Soon } from '../../ui/Soon';
import { T } from '../../ui/theme';

export default function Journeys() {
  const { ready } = useBetty();
  const n = ready ? RideLog.load().length : 0;
  return (
    <Soon eyebrow="My journeys" title="Every ride, kept." text="Your rides with their stories, maps, records and month cards come to the app in the next stage.">
      <Text style={T.body}>{n ? `${n} ride${n === 1 ? '' : 's'} kept on this phone so far.` : 'No rides kept on this phone yet: rides of 3 minutes or 1 km and up are kept.'}</Text>
    </Soon>
  );
}

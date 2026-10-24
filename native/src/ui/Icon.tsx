import { memo } from 'react';
import { SvgXml } from 'react-native-svg';
import { IconName, PATHS } from '../../../src/ui/icons';
import { C } from './theme';

/** The web app's line icons (src/ui/icons.ts, 24x24, stroked), drawn by react-native-svg. */
export const Icon = memo(function Icon({ name, size = 20, color = C.ink, width = 1.5 }: { name: IconName; size?: number; color?: string; width?: number }) {
  const xml = `<svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${PATHS[name] ?? PATHS.spark}</svg>`;
  return <SvgXml xml={xml} width={size} height={size} />;
});

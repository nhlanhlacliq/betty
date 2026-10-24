import { StyleSheet } from 'react-native';

/**
 * Design v3, as the web app's tokens (src/ui/styles/tokens.css): warm paper, deep green ink, butter yellow for Betty.
 * Change the look here first; the screens only use these names.
 */
export const C = {
  bg: '#f7f6f0',
  card: '#fffef9',
  cardLine: '#e4e7dc',
  ink: '#273f39',
  inkDeep: '#2c4540',
  muted: '#7e8980',
  line: '#e3e6dc',
  yellow: '#f4dc85',
  sage: '#819b77',
  sageSoft: '#e8ede2',
  sageText: '#657960',
  chip: '#edf0e6',
  map: '#e7eadf',
  dot: '#8a9c75',
  warn: '#c99a45',
  end: '#f2e7dc',
  endText: '#946b57',
  danger: '#a07161',
  accent: '#e8c95c',
  onDark: '#fffdf1',
  onDarkMuted: '#d4ded2',
  live: '#7fd18a',
};

/** Shared text styles (the web's h1/h2/.eyebrow/.sub). */
export const T = StyleSheet.create({
  h1: { fontSize: 37, lineHeight: 40, letterSpacing: -1.5, fontWeight: '500', color: C.ink },
  h2: { fontSize: 23, letterSpacing: -0.7, fontWeight: '600', color: C.ink },
  sheetTitle: { fontSize: 26, letterSpacing: -0.8, fontWeight: '600', color: C.ink, marginTop: 10, marginBottom: 16 },
  eyebrow: { fontSize: 9, fontWeight: '700', letterSpacing: 1.5, color: C.muted, textTransform: 'uppercase' },
  sub: { fontSize: 12, color: C.muted, lineHeight: 18 },
  body: { fontSize: 13, color: C.ink, lineHeight: 20 },
});

/** The web's soft shadow (0 3px 12px #25392b12). */
export const shadow = { shadowColor: '#25392b', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 3 }, elevation: 2 };

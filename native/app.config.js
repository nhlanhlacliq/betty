// app.json plus what must not be committed: the app's login for Betty's update server (the same `app` user and
// token as the voice server, from native/.env). expo-updates sends it on every manifest and file request.
module.exports = ({ config }) => {
  const user = process.env.EXPO_PUBLIC_VOICE_USER ?? 'app';
  const token = process.env.EXPO_PUBLIC_VOICE_TOKEN ?? '';
  if (!token) console.warn('app.config.js: no EXPO_PUBLIC_VOICE_TOKEN in native/.env: over-the-air updates will be refused (401)');
  const auth = `Basic ${Buffer.from(`${user}:${token}`).toString('base64')}`;
  return { ...config, updates: { ...config.updates, requestHeaders: { Authorization: auth } } };
};

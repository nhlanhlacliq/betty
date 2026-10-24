// Daily (voice) needs crypto.getRandomValues before anything else loads.
import 'react-native-get-random-values';
// The background GPS task must be defined before the app starts (expo-task-manager).
import './src/adapters/ExpoGeoSource';
// The screens are routes in src/app (Expo Router); this registers the app.
import 'expo-router/entry';

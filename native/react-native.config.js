// Betty: react-native-bluetooth-classic is Android only. On iPhone it crashed the app at launch (its init asserts,
// 2026-10-18 crash report: RNBluetoothClassic.init -> _assertionFailure), and iPhones cannot use classic-Bluetooth
// OBD readers anyway. So it is not linked into the iOS build at all.
module.exports = {
  dependencies: {
    'react-native-bluetooth-classic': { platforms: { ios: null } },
  },
};

// Betty only shows notifications made on the phone (bike on: tap to ride, reminders), which need no push service.
// expo-notifications still adds the push entitlement (aps-environment), and a free Apple ID cannot sign an app that
// has it ("Provisioning Profile does not support the Push Notifications capability"). Remove this plugin only once
// there is a paid developer account AND a real need for push.
const { withEntitlementsPlist } = require('expo/config-plugins');

module.exports = function withoutPushEntitlement(config) {
  return withEntitlementsPlist(config, (cfg) => {
    delete cfg.modResults['aps-environment'];
    return cfg;
  });
};

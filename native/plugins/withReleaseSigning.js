// Release builds signed with Betty's OWN key (native/credentials, git-ignored), not the template's shared debug key.
// Android only installs an update over the app when it is signed with the same key, so this key must never change:
// keep a backup of native/credentials. Without credentials/keystore.properties a release build stops with an error
// (better than quietly signing with a different key, which would refuse to install over the app on the phone).
const { withAppBuildGradle } = require('expo/config-plugins');

const MARK = '// betty: release signing';

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let g = cfg.modResults.contents;
    if (g.includes(MARK)) return cfg;
    const load = `
${MARK}
def bettyKeyProps = new Properties()
def bettyKeyFile = rootProject.file('../credentials/keystore.properties')
if (bettyKeyFile.exists()) bettyKeyFile.withInputStream { bettyKeyProps.load(it) }
`;
    g = g.replace(/\nandroid \{/, `${load}\nandroid {`);
    g = g.replace(/signingConfigs \{\n/, `signingConfigs {
        release {
            if (bettyKeyFile.exists()) {
                storeFile rootProject.file('../credentials/' + bettyKeyProps['storeFile'])
                storePassword bettyKeyProps['storePassword']
                keyAlias bettyKeyProps['keyAlias']
                keyPassword bettyKeyProps['keyPassword']
            }
        }
`);
    g = g.replace(/(release \{\n(?:\s*\/\/.*\n)*)\s*signingConfig signingConfigs\.debug/, (m, head) => `${head}            if (!bettyKeyFile.exists() && gradle.startParameter.taskNames.any { it.toLowerCase().contains('release') }) {
                throw new GradleException("No native/credentials/keystore.properties: release builds must use Betty's own key (see native/README.md)")
            }
            signingConfig signingConfigs.release`);
    if (!g.includes('signingConfig signingConfigs.release')) throw new Error('withReleaseSigning: build.gradle layout changed, update the plugin');
    cfg.modResults.contents = g;
    return cfg;
  });
};

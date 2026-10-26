// Android Gradle Plugin 8+ stopped generating BuildConfig for libraries (and AGP 9 removed the global switch).
// react-native-bluetooth-classic still imports its BuildConfig, so the release build fails without this.
// Libraries that need it are listed in app.json: ["./plugins/withLibraryBuildConfig", ["react-native-bluetooth-classic"]].
const { withProjectBuildGradle } = require('expo/config-plugins');

const MARK = '// betty: library BuildConfig';

module.exports = function withLibraryBuildConfig(config, libraries = []) {
  return withProjectBuildGradle(config, (cfg) => {
    if (cfg.modResults.contents.includes(MARK)) return cfg;
    const names = libraries.map((n) => `'${n}'`).join(', ');
    cfg.modResults.contents += `
${MARK}
subprojects { p ->
  if ([${names}].contains(p.name)) {
    p.plugins.withId('com.android.library') { p.android.buildFeatures.buildConfig = true }
  }
}
`;
    return cfg;
  });
};

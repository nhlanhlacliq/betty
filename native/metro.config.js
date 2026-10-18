// Betty's native app shares the web app's pure logic (../src/core, ../src/config) instead of copying it.
// Metro only watches the project folder by default, so the repo's src/ is added here.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, '../src')];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')];

module.exports = config;

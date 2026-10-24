import { requireOptionalNativeModule } from 'expo-modules-core';

/** iPhone only (null elsewhere, and in a build made before this module): see ios/BettyAudioRouteModule.swift. */
const M = requireOptionalNativeModule<{
  setRoute(route: 'call' | 'media', mix: 'mix' | 'duck' | 'solo'): Promise<string>;
  currentRoute(): string;
}>('BettyAudioRoute');

export const audioRoute = M;

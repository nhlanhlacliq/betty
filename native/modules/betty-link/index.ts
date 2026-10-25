import { requireOptionalNativeModule } from 'expo-modules-core';

/** Betty Link (iPhone only; null elsewhere and in a build made before it): see ios/BettyLinkModule.swift. */
type Sub = { remove(): void };
export interface BettyLinkNative {
  connect(url: string, auth: string, start: string): Promise<string>;
  send(json: string): void;
  mic(on: boolean): Promise<string>;
  flush(): void;
  route(): string;
  setGain(db: number): void;
  disconnect(): void;
  addListener(event: 'onMessage', fn: (e: { json: string }) => void): Sub;
  addListener(event: 'onState', fn: (e: { state: string; detail: string }) => void): Sub;
  addListener(event: 'onLog', fn: (e: { msg: string }) => void): Sub;
}

export const bettyLink = requireOptionalNativeModule<BettyLinkNative>('BettyLink');

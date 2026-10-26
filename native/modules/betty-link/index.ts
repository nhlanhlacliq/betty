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
  /** 0 (town) to 1 (120 km/h): more presence and compression in her voice */
  setSpeedVoice?(share: number): void;
  setMusic(mode: 'pause' | 'dip' | 'mix'): void;
  openMic(on: boolean): Promise<string>;
  mute(on: boolean): void;
  buttons(on: boolean): void;
  disconnect(): void;
  /** A phone call is on (CallKit; a build before 2026-10-26 has none) */
  inCall?(): boolean;
  addListener(event: 'onMessage', fn: (e: { json: string }) => void): Sub;
  addListener(event: 'onState', fn: (e: { state: string; detail: string }) => void): Sub;
  addListener(event: 'onLog', fn: (e: { msg: string }) => void): Sub;
  addListener(event: 'onButton', fn: (e: { kind: 'talk' | 'next' | 'previous' }) => void): Sub;
  addListener(event: 'onCall', fn: (e: { active: boolean }) => void): Sub;
}

export const bettyLink = requireOptionalNativeModule<BettyLinkNative>('BettyLink');

import { create } from 'zustand';
import { BikeState, createDefaultBikeState } from '../models/BikeState';
import { TriggerEvent } from '../models/TriggerEvent';
import { MemoryEntry } from '../models/SessionMemory';

interface BettyStore {
  // Current aggregated bike state
  bikeState: BikeState;

  // Ride session status
  rideActive: boolean;

  // Latest trigger for UI display
  lastTrigger: TriggerEvent | null;

  // Session memory entries (last 50)
  memoryEntries: MemoryEntry[];

  // Whether Betty is currently speaking
  isSpeaking: boolean;

  // Whether STT is active
  isListening: boolean;

  // Error state
  error: string | null;

  // Actions
  setBikeState: (state: BikeState) => void;
  setRideActive: (active: boolean) => void;
  setLastTrigger: (trigger: TriggerEvent | null) => void;
  addMemoryEntry: (entry: MemoryEntry) => void;
  setIsSpeaking: (speaking: boolean) => void;
  setIsListening: (listening: boolean) => void;
  setError: (error: string | null) => void;
  resetSession: () => void;
}

export const useBettyStore = create<BettyStore>((set) => ({
  bikeState: createDefaultBikeState(),
  rideActive: false,
  lastTrigger: null,
  memoryEntries: [],
  isSpeaking: false,
  isListening: false,
  error: null,

  setBikeState: (state) => set({ bikeState: state }),
  setRideActive: (active) => set({ rideActive: active }),
  setLastTrigger: (trigger) => set({ lastTrigger: trigger }),
  addMemoryEntry: (entry) =>
    set((s) => ({
      memoryEntries: [...s.memoryEntries.slice(-49), entry],
    })),
  setIsSpeaking: (speaking) => set({ isSpeaking: speaking }),
  setIsListening: (listening) => set({ isListening: listening }),
  setError: (error) => set({ error }),
  resetSession: () =>
    set({
      bikeState: createDefaultBikeState(),
      lastTrigger: null,
      memoryEntries: [],
      isSpeaking: false,
      isListening: false,
      error: null,
    }),
}));

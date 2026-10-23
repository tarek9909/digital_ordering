import { create } from 'zustand';

interface DisplayState {
  /** null until the first connection attempt finishes. */
  connected: boolean | null;
  /** True between a (re)connect and the fresh snapshot (shows "Reconnecting"). */
  resyncing: boolean;
  /** A snapshot reload failed and none has succeeded since: the list may be out of date (CSD04). */
  stale: boolean;
  soundEnabled: boolean;
  missingVoices: string[];
  highlightId: string | null;
  setConnected(v: boolean): void;
  setResyncing(v: boolean): void;
  setStale(v: boolean): void;
  setSoundEnabled(v: boolean): void;
  setMissingVoices(v: string[]): void;
  addMissingVoice(lang: string): void;
  highlight(id: string | null): void;
}

export const useDisplay = create<DisplayState>((set) => ({
  connected: null,
  resyncing: false,
  stale: false,
  soundEnabled: false,
  missingVoices: [],
  highlightId: null,
  setConnected: (connected) => set({ connected }),
  setResyncing: (resyncing) => set({ resyncing }),
  setStale: (stale) => set((s) => (s.stale === stale ? s : { stale })),
  setSoundEnabled: (soundEnabled) => set({ soundEnabled }),
  setMissingVoices: (missingVoices) => set({ missingVoices }),
  addMissingVoice: (lang) => set((s) => (s.missingVoices.includes(lang) ? s : { missingVoices: [...s.missingVoices, lang] })),
  highlight: (highlightId) => set({ highlightId }),
}));

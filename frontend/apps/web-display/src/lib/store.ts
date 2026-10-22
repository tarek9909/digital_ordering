import { create } from 'zustand';

interface DisplayState {
  /** null until the first connection attempt finishes. */
  connected: boolean | null;
  /** True between a (re)connect and the fresh snapshot (shows "Reconnecting"). */
  resyncing: boolean;
  soundEnabled: boolean;
  missingVoices: string[];
  highlightId: string | null;
  setConnected(v: boolean): void;
  setResyncing(v: boolean): void;
  setSoundEnabled(v: boolean): void;
  setMissingVoices(v: string[]): void;
  addMissingVoice(lang: string): void;
  highlight(id: string | null): void;
}

export const useDisplay = create<DisplayState>((set) => ({
  connected: null,
  resyncing: false,
  soundEnabled: false,
  missingVoices: [],
  highlightId: null,
  setConnected: (connected) => set({ connected }),
  setResyncing: (resyncing) => set({ resyncing }),
  setSoundEnabled: (soundEnabled) => set({ soundEnabled }),
  setMissingVoices: (missingVoices) => set({ missingVoices }),
  addMissingVoice: (lang) => set((s) => (s.missingVoices.includes(lang) ? s : { missingVoices: [...s.missingVoices, lang] })),
  highlight: (highlightId) => set({ highlightId }),
}));

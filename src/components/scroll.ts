// How far the current page has scrolled, for the parts outside it: the top bar turns solid once content passes
// under it. Screens report; nothing else writes here.
import { create } from "zustand";

export const useScrolled = create<{ scrolled: boolean; set: (scrolled: boolean) => void }>((set) => ({
  scrolled: false,
  set: (scrolled) => set((s) => (s.scrolled === scrolled ? s : { scrolled })),
}));

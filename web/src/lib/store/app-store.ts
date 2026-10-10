import { create } from "zustand";

export type SiteView = "detecting" | "onsite" | "remote";

interface AppState {
  /** On-site desk (edge reachable, video allowed) or remote link (skeletons only). */
  view: SiteView;
  /** True once any API call fell back to mock because the API failed. */
  apiDown: boolean;
  setView: (v: SiteView) => void;
  setApiDown: (down: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  view: "detecting",
  apiDown: false,
  setView: (view) => set({ view }),
  setApiDown: (apiDown) => set({ apiDown }),
}));

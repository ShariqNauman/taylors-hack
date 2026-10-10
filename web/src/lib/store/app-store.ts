import { create } from "zustand";

export type SiteView = "detecting" | "onsite" | "remote";

interface AppState {
  /** On-site desk (edge reachable, video allowed) or remote link (skeletons only). */
  view: SiteView;
  /** True once any API call fell back to mock because the API failed. */
  apiDown: boolean;
  setView: (v: SiteView) => void;
  setApiDown: (down: boolean) => void;
  /** Demo: the guard whose phone screen shows beside the desk (call sign), or null. */
  phone: string | null;
  openPhone: (call: string) => void;
  closePhone: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  view: "detecting",
  apiDown: false,
  setView: (view) => set({ view }),
  setApiDown: (apiDown) => set({ apiDown }),
  phone: null,
  openPhone: (phone) => set({ phone }),
  closePhone: () => set({ phone: null }),
}));

/** On a desk-sized screen, show that guard's phone beside the desk (a push just went to them). */
/** Opens the guard's phone beside the desk; returns false where it can't fit (then the caller toasts). */
export function showPhoneBeside(call: string | null | undefined): boolean {
  if (!call || typeof window === "undefined" || window.innerWidth < 1100) return false;
  if (window.location.pathname.startsWith("/guard")) return false;
  useAppStore.getState().openPhone(call);
  return true;
}

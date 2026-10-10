import { create } from "zustand";
import type { Level } from "@/lib/types";
import { LEVEL_ORDER } from "@/lib/format";

export type Decision = "confirmed" | "dismissed";

/** One alarming incident (fight_likely or fight) that is still open. */
export interface AlarmEntry {
  incident_id: string;
  camera_id: string;
  location: string;
  level: Level;
  priority: number;
  pushed_to?: string | null;
  pushed_at?: string | null;
  /** Silence stops sound and pulse for this incident; the banner stays. */
  silenced: boolean;
  /** Confirm keeps a quiet banner ("on the way"); Dismiss removes it. */
  decision: Decision | null;
}

type Incoming = Omit<AlarmEntry, "silenced" | "decision"> & {
  /** For a brand-new entry only: start silenced (history, not a transition). */
  startSilenced?: boolean;
};

interface AlarmState {
  /** The operator armed the audio with one click (autoplay rule). */
  armed: boolean;
  alarms: Record<string, AlarmEntry>;
  setArmed: (armed: boolean) => void;
  /** Insert or update an alarming incident. Keeps silenced and decision. */
  upsert: (e: Incoming) => void;
  silence: (incident_id: string) => void;
  decide: (incident_id: string, d: Decision | null) => void;
  clear: (incident_id: string) => void;
  /** Remove every entry whose id is not in `keep`. */
  retain: (keep: Set<string>) => void;
  clearAll: () => void;
}

export const useAlarmStore = create<AlarmState>((set) => ({
  armed: false,
  alarms: {},
  setArmed: (armed) => set({ armed }),
  upsert: ({ startSilenced, ...e }) =>
    set((s) => {
      const prev = s.alarms[e.incident_id];
      const next: AlarmEntry = {
        ...e,
        silenced: prev ? prev.silenced : !!startSilenced,
        decision: prev?.decision ?? null,
      };
      if (
        prev &&
        prev.level === next.level &&
        prev.priority === next.priority &&
        prev.pushed_to === next.pushed_to &&
        prev.pushed_at === next.pushed_at &&
        prev.location === next.location
      )
        return {};
      return { alarms: { ...s.alarms, [e.incident_id]: next } };
    }),
  silence: (id) =>
    set((s) =>
      s.alarms[id]
        ? { alarms: { ...s.alarms, [id]: { ...s.alarms[id], silenced: true } } }
        : {},
    ),
  decide: (id, d) =>
    set((s) =>
      s.alarms[id]
        ? {
            alarms: {
              ...s.alarms,
              [id]: {
                ...s.alarms[id],
                decision: d,
                silenced: d ? true : s.alarms[id].silenced,
              },
            },
          }
        : {},
    ),
  clear: (id) =>
    set((s) => {
      if (!s.alarms[id]) return {};
      const alarms = { ...s.alarms };
      delete alarms[id];
      return { alarms };
    }),
  retain: (keep) =>
    set((s) => {
      const ids = Object.keys(s.alarms);
      if (ids.every((id) => keep.has(id))) return {};
      const alarms: Record<string, AlarmEntry> = {};
      for (const id of ids) if (keep.has(id)) alarms[id] = s.alarms[id];
      return { alarms };
    }),
  clearAll: () => set({ alarms: {} }),
}));

/** The highest-level, then highest-priority, alarm that is not dismissed drives the banner. */
export function selectBanner(s: AlarmState): AlarmEntry | null {
  let best: AlarmEntry | null = null;
  for (const a of Object.values(s.alarms)) {
    if (a.decision === "dismissed") continue;
    if (
      !best ||
      LEVEL_ORDER[a.level] > LEVEL_ORDER[best.level] ||
      (LEVEL_ORDER[a.level] === LEVEL_ORDER[best.level] &&
        a.priority > best.priority)
    )
      best = a;
  }
  return best;
}

/** Sound and pulse run while some alarm is neither silenced nor decided. */
export function selectSounding(s: AlarmState): boolean {
  return Object.values(s.alarms).some((a) => !a.silenced && !a.decision);
}

/** Camera ids whose tile / card / pin should pulse. Returns a stable string for cheap equality. */
export function selectPulsingCameras(s: AlarmState): string {
  return Object.values(s.alarms)
    .filter((a) => !a.silenced && !a.decision)
    .map((a) => a.camera_id)
    .sort()
    .join(",");
}

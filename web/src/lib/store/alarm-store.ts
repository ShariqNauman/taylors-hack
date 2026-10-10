import { create } from "zustand";
import type { Level } from "@/lib/types";
import { LEVEL_ORDER } from "@/lib/format";

/** One alarming incident (fight_likely or fight). */
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
  /** Confirm / Dismiss stops everything; the banner clears when the incident is labelled or drops. */
  labelled: boolean;
}

interface AlarmState {
  /** The operator armed the audio with one click (autoplay rule). */
  armed: boolean;
  alarms: Record<string, AlarmEntry>;
  setArmed: (armed: boolean) => void;
  /** Insert or update an alarming incident. Keeps silenced / labelled flags. */
  upsert: (e: Omit<AlarmEntry, "silenced" | "labelled">) => void;
  silence: (incident_id: string) => void;
  label: (incident_id: string) => void;
  clear: (incident_id: string) => void;
  clearAll: () => void;
}

export const useAlarmStore = create<AlarmState>((set) => ({
  armed: false,
  alarms: {},
  setArmed: (armed) => set({ armed }),
  upsert: (e) =>
    set((s) => {
      const prev = s.alarms[e.incident_id];
      return {
        alarms: {
          ...s.alarms,
          [e.incident_id]: {
            ...e,
            silenced: prev?.silenced ?? false,
            labelled: prev?.labelled ?? false,
          },
        },
      };
    }),
  silence: (id) =>
    set((s) =>
      s.alarms[id]
        ? { alarms: { ...s.alarms, [id]: { ...s.alarms[id], silenced: true } } }
        : {},
    ),
  label: (id) =>
    set((s) =>
      s.alarms[id]
        ? {
            alarms: {
              ...s.alarms,
              [id]: { ...s.alarms[id], labelled: true, silenced: true },
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
  clearAll: () => set({ alarms: {} }),
}));

/** The highest-level, then highest-priority, unlabelled alarm drives the banner. */
export function selectBanner(s: AlarmState): AlarmEntry | null {
  const list = Object.values(s.alarms).filter((a) => !a.labelled);
  if (!list.length) return null;
  list.sort(
    (a, b) =>
      LEVEL_ORDER[b.level] - LEVEL_ORDER[a.level] || b.priority - a.priority,
  );
  return list[0];
}

/** Sound and pulse run while some banner alarm is neither silenced nor labelled. */
export function selectSounding(s: AlarmState): boolean {
  return Object.values(s.alarms).some((a) => !a.silenced && !a.labelled);
}

/** Incident ids whose camera tile / card should pulse. */
export function selectPulsingIds(s: AlarmState): Set<string> {
  return new Set(
    Object.values(s.alarms)
      .filter((a) => !a.silenced && !a.labelled)
      .map((a) => a.incident_id),
  );
}

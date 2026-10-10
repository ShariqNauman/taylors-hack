"use client";

import { useEffect, useRef } from "react";
import { useAlarmStore, selectSounding } from "@/lib/store/alarm-store";

/**
 * Mounted once in layout.tsx: the looping alarm audio and the red screen edge.
 * Sound plays only after the operator armed it (autoplay rule). The banner
 * lives under the header (AlarmBanner) and the toast is raised by Live.
 */
export function AlarmLayer() {
  const sounding = useAlarmStore(selectSounding);
  const armed = useAlarmStore((s) => s.armed);
  const ref = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const a = ref.current;
    if (!a) return;
    if (sounding && armed) {
      a.loop = true;
      a.play().catch(() => {});
    } else {
      a.pause();
      a.currentTime = 0;
    }
  }, [sounding, armed]);

  return (
    <>
      <audio ref={ref} id="ee-alarm-audio" src="/alarm.mp3" preload="auto" />
      {sounding && (
        <div
          aria-hidden="true"
          className="ee-edge pointer-events-none fixed inset-0 z-30"
          style={{
            boxShadow:
              "inset 0 0 0 8px #C8241B, inset 0 0 90px rgb(200 36 27 / 0.55)",
          }}
        />
      )}
    </>
  );
}

/** Play-and-pause the alarm once from a user gesture so later plays are allowed. */
export async function armAlarmAudio(): Promise<boolean> {
  const a = document.getElementById(
    "ee-alarm-audio",
  ) as HTMLAudioElement | null;
  if (!a) return false;
  try {
    await a.play();
    a.pause();
    a.currentTime = 0;
    useAlarmStore.getState().setArmed(true);
    return true;
  } catch {
    return false;
  }
}

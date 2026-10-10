"use client";

import { useEffect, useRef } from "react";
import useSWR from "swr";
import { getReplay } from "@/lib/api";
import { useReplay } from "@/hooks/use-replay";
import { useClock } from "@/hooks/use-clock";
import { useAlarmStore } from "@/lib/store/alarm-store";
import { etaText, fmtTime, isAlarmLevel } from "@/lib/format";
import { PageShell } from "@/components/chrome/page-shell";
import { LevelPill } from "@/components/chrome/level-pill";
import { TypeChip } from "@/components/chrome/type-chip";
import { ArmSoundButton } from "@/components/alarm/arm-sound-button";
import { pushToast } from "@/components/alarm/push-toast";
import { CameraFrame, SkeletonView } from "@/components/skeleton/skeleton-view";

/**
 * Interim home for web/shell-v3: exercises the header, alarm layer, timestamp
 * replay and SkeletonView. web/live-v3 replaces it with the full Live screen.
 */
export function ShellPreview() {
  const { data: replay } = useSWR("replay", getReplay, {
    revalidateOnFocus: false,
  });
  const r = useReplay(replay, true);
  const now = useClock(250);
  const upsert = useAlarmStore((s) => s.upsert);
  const clearAll = useAlarmStore((s) => s.clearAll);
  const pushedRef = useRef(false);

  const ev = replay && r.index >= 0 ? replay[r.index] : null;
  const base = replay?.length ? Date.parse(replay[0].start_time) : 0;
  const receivedMs = ev
    ? Date.parse(r.startedAt) + (Date.parse(ev.start_time) - base)
    : 0;
  const eta =
    ev?.eta_seconds != null
      ? ev.eta_seconds - (now.getTime() - receivedMs) / 1000
      : null;

  useEffect(() => {
    if (!ev) return;
    if (r.index === 0) {
      clearAll();
      pushedRef.current = false;
    }
    if (isAlarmLevel(ev.level)) {
      const pushedAt = new Date().toISOString();
      if (!pushedRef.current) {
        pushedRef.current = true;
        pushToast(ev.nearest_staff ?? "person on duty", pushedAt, ev.location);
      }
      upsert({
        incident_id: ev.incident_id,
        camera_id: ev.camera_id,
        location: ev.location,
        level: ev.level,
        priority: ev.priority,
        pushed_to: ev.nearest_staff,
        pushed_at: pushedAt,
      });
    }
  }, [ev, r.index, upsert, clearAll]);

  return (
    <PageShell
      kicker="Shell preview · web/shell-v3"
      title="Live screen lands next"
      subtitle="This page checks the shell: header, fonts, tokens, alarm layer, timestamp replay and the skeleton view."
      headerRight={<ArmSoundButton />}
    >
      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <section className="flex flex-col gap-3 rounded-[2px] border border-line bg-white p-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[13px] font-bold">
              {ev
                ? `${ev.camera_id} · ${ev.incident_id}`
                : "Waiting for replay"}
            </span>
            <span className="ml-auto inline-flex min-h-7 items-center rounded-[1px] border border-dashed border-line-strong px-2 font-mono text-[11px] font-bold">
              SYNTHETIC POSES
            </span>
          </div>
          <CameraFrame>
            <SkeletonView
              frame={ev?.snapshot}
              level={ev?.level ?? "calm"}
              score={ev?.peak_score}
              background="remote"
              showDistance
              hud={{
                topLeft: ev
                  ? `${ev.camera_id} · ${ev.location.toUpperCase()}`
                  : undefined,
                topRight: `SKELETONS ${fmtTime(now)}`,
                topRightDot: "#7FE0FF",
                bottomLeft:
                  "NO PIXELS LEAVE THE SITE · 12 BODY KEYPOINTS PER PERSON",
              }}
            />
          </CameraFrame>
          <div className="font-mono text-[12px] text-ink-2">
            REPLAY BY TIMESTAMP · T+{r.elapsed.toFixed(1)} S · EVENT{" "}
            {String(r.index + 1).padStart(2, "0")}/{replay?.length ?? 0}
          </div>
        </section>
        <section
          className="flex flex-col gap-3 rounded-[2px] border-2 bg-white p-5"
          style={{ borderColor: "#DCDFE4" }}
        >
          {ev && (
            <>
              <div className="flex flex-wrap items-center gap-2.5">
                <LevelPill level={ev.level} size="xl" />
                {ev.level !== "calm" && <TypeChip type={ev.type} size="lg" />}
              </div>
              <div className="ee-display text-[44px]">
                {etaText(ev.level, eta)}
              </div>
              <h2 className="text-[30px] font-extrabold leading-tight">
                {ev.location}
              </h2>
              <p className="text-[22px] font-medium leading-snug">
                {ev.reason}
              </p>
            </>
          )}
        </section>
      </div>
    </PageShell>
  );
}

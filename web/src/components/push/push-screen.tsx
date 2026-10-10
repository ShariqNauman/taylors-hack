"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import {
  getCameras,
  getEvents,
  getPatrolPlan,
  getSite,
  mergeEvents,
  patchEvent,
  PatchError,
} from "@/lib/api";
import {
  daysInclude,
  fmtTime,
  mytWeekday,
  normaliseStatus,
} from "@/lib/format";
import { fmtDistance, staffDistance } from "@/lib/geo";
import { cameraKind } from "@/lib/camera-meta";
import { staticFrame } from "@/lib/mock-poses";
import type { Event } from "@/lib/types";
import { TypeChip } from "@/components/chrome/type-chip";
import { SkeletonView } from "@/components/skeleton/skeleton-view";

type View = "offduty" | "idle" | "pushed" | "acked" | "timeout";
const ANSWER_S = 10;
const BACK_TO_IDLE_MS = 5000;
const SHIFT_MS = 8 * 3_600_000;
export const PUSH_CHANNEL = "earlyeye-push";

interface WakeLockLike {
  release: () => Promise<void>;
}

export function PushScreen() {
  const params = useSearchParams();
  const staff = params.get("staff") ?? "Guard B";
  const deepIncident = params.get("incident");
  const demo = params.get("demo") === "1";

  const [view, setView] = useState<View>(deepIncident ? "pushed" : "offduty");
  const [incident, setIncident] = useState<Event | null>(null);
  const [left, setLeft] = useState(ANSWER_S);
  const [took, setTook] = useState(0);
  const [localOnly, setLocalOnly] = useState(false);
  const handled = useRef(new Set<string>());
  const audio = useRef<HTMLAudioElement>(null);
  const wake = useRef<WakeLockLike | null>(null);
  const receivedAt = useRef(0);

  const on = view !== "offduty";
  const recent = useSWR(
    on ? ["push-events", "since"] : null,
    () => getEvents(new Date(Date.now() - 30 * 60_000).toISOString()),
    { refreshInterval: 2000 },
  );
  const full = useSWR(
    on || deepIncident ? ["push-events", "full"] : null,
    () => getEvents(),
    { refreshInterval: 10_000 },
  );
  const { data: site } = useSWR("site", getSite, { revalidateOnFocus: false });
  const { data: cameras } = useSWR("cameras", getCameras, {
    refreshInterval: 30_000,
  });
  const { data: plan } = useSWR("plan", getPatrolPlan, {
    revalidateOnFocus: false,
  });
  const events = useMemo(
    () =>
      mergeEvents(full.data ?? [], recent.data ?? []).map((e) => ({
        ...e,
        status: normaliseStatus(e.status),
      })),
    [full.data, recent.data],
  );

  const stopAlarm = useCallback(() => {
    const a = audio.current;
    if (a) {
      a.pause();
      a.currentTime = 0;
    }
    navigator.vibrate?.(0);
  }, []);

  const startPush = useCallback((e: Event) => {
    handled.current.add(e.incident_id);
    receivedAt.current = Date.now();
    setIncident(e);
    setLeft(ANSWER_S);
    setLocalOnly(false);
    setView("pushed");
    const a = audio.current;
    if (a) {
      a.loop = true;
      a.play().catch(() => {});
    }
    navigator.vibrate?.([500, 200, 500, 200, 800]);
  }, []);

  // Poll: an event pushed to me, still pushed, not acknowledged.
  useEffect(() => {
    if (view !== "idle") return;
    const mine = events
      .filter(
        (e) =>
          // The API sets pushed_to; an operator's early push (PATCH status only) leaves it
          // empty, so the named nearest person counts too.
          (e.pushed_to === staff ||
            (!e.pushed_to && e.nearest_staff === staff)) &&
          e.status === "pushed" &&
          !e.acked_at &&
          e.end_time == null &&
          !handled.current.has(e.incident_id),
      )
      .sort(
        (a, b) =>
          Date.parse(b.pushed_at ?? b.start_time) -
          Date.parse(a.pushed_at ?? a.start_time),
      )[0];
    if (mine) startPush(mine);
  }, [events, view, staff, startPush]);

  // Same-browser demo: the Live tab's ?replay=1 broadcasts its simulated push.
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(PUSH_CHANNEL);
    ch.onmessage = (m: MessageEvent<{ type: string; event: Event }>) => {
      if (m.data?.type !== "push" || m.data.event.pushed_to !== staff) return;
      if (handled.current.has(m.data.event.incident_id)) return;
      if (view === "idle") startPush(m.data.event);
    };
    return () => ch.close();
  }, [staff, view, startPush]);

  // Deep link (?incident=): open straight in the pushed state once the event is known.
  useEffect(() => {
    if (!deepIncident || incident) return;
    const e = events.find((x) => x.incident_id === deepIncident);
    if (e) {
      handled.current.add(e.incident_id);
      receivedAt.current = Date.now();
      setIncident(e);
    }
  }, [deepIncident, events, incident]);

  // 10 s countdown.
  useEffect(() => {
    if (view !== "pushed") return;
    const t = setInterval(() => {
      const l = Math.max(
        0,
        ANSWER_S - Math.floor((Date.now() - receivedAt.current) / 1000),
      );
      setLeft(l);
      if (l <= 0) {
        stopAlarm();
        setView("timeout");
      }
    }, 250);
    return () => clearInterval(t);
  }, [view, stopAlarm]);

  // Acknowledged / timeout → back to on duty.
  useEffect(() => {
    if (view !== "acked" && view !== "timeout") return;
    const t = setTimeout(
      () => setView("idle"),
      view === "acked" ? BACK_TO_IDLE_MS : BACK_TO_IDLE_MS * 2,
    );
    return () => clearTimeout(t);
  }, [view]);

  // Keep the wake lock after the tab comes back.
  useEffect(() => {
    const again = async () => {
      if (document.visibilityState === "visible" && on && !wake.current)
        await requestWake();
    };
    document.addEventListener("visibilitychange", again);
    return () => document.removeEventListener("visibilitychange", again);
  }, [on]);

  async function requestWake() {
    try {
      const wl = (
        navigator as Navigator & {
          wakeLock?: { request: (t: "screen") => Promise<WakeLockLike> };
        }
      ).wakeLock;
      if (wl) {
        wake.current = await wl.request("screen");
        (
          wake.current as unknown as {
            addEventListener?: (n: string, f: () => void) => void;
          }
        ).addEventListener?.("release", () => {
          wake.current = null;
        });
      }
    } catch {
      wake.current = null;
    }
  }

  const goOnDuty = async () => {
    const a = audio.current;
    if (a) {
      try {
        await a.play();
        a.pause();
        a.currentTime = 0;
      } catch {
        // iOS may still block; the push will try again
      }
    }
    await requestWake();
    try {
      await document.documentElement.requestFullscreen?.();
    } catch {
      // not allowed here; fine
    }
    setView(deepIncident && incident ? "pushed" : "idle");
    if (deepIncident && incident) receivedAt.current = Date.now();
  };

  const ack = async () => {
    if (!incident) return;
    stopAlarm();
    const t = Math.max(1, Math.round((Date.now() - receivedAt.current) / 1000));
    setTook(t);
    setView("acked");
    try {
      await patchEvent(incident.incident_id, {
        status: "pushed",
        acked_at: new Date().toISOString(),
      });
    } catch (err) {
      if (err instanceof PatchError) setLocalOnly(true);
    }
  };

  const testPush = () => {
    const cam =
      cameras?.find(
        (c) =>
          c.zone_type === site?.staff?.find((s) => s.name === staff)?.zone_type,
      ) ?? cameras?.[0];
    const now = new Date().toISOString();
    startPush({
      incident_id: `TEST-${Date.now()}`,
      camera_id: cam?.camera_id ?? "CAM-TEST",
      location: cam?.location ?? "Test location",
      zone_type: cam?.zone_type ?? "test",
      start_time: now,
      end_time: null,
      type: "fight",
      level: "fight_likely",
      peak_score: 0.71,
      eta_seconds: 6,
      priority: 0.36,
      reason: "Test push from this phone. Not a real alert.",
      people_count: 2,
      action: `Send ${staff} now`,
      nearest_staff: staff,
      pushed_to: staff,
      pushed_at: now,
      status: "pushed",
      staff_note: null,
      peak_snapshot: staticFrame("pair", now),
    });
  };

  const pushedCount = events.filter(
    (e) => e.pushed_at && Date.parse(e.pushed_at) >= Date.now() - SHIFT_MS,
  ).length;
  const camsLive = cameras?.filter((c) => cameraKind(c) !== "black").length;
  const me = site?.staff?.find((s) => s.name === staff);
  const wd = mytWeekday();
  const mySlot =
    plan?.slots.find(
      (s) =>
        daysInclude(s.days, wd) &&
        cameras?.some(
          (c) => c.location === s.location && c.zone_type === me?.zone_type,
        ),
    ) ?? plan?.slots.find((s) => daysInclude(s.days, wd));

  const pushed = view === "pushed";
  const bg = pushed ? "#C8241B" : view === "acked" ? "#E4F3EA" : "#F1F2F4";
  const fg = pushed ? "#FFFFFF" : "#0B0D10";
  const cam = incident
    ? cameras?.find((c) => c.camera_id === incident.camera_id)
    : undefined;
  const dist = fmtDistance(staffDistance(site, staff, cam));
  const etaLeft =
    incident?.eta_seconds != null
      ? incident.eta_seconds - (Date.now() - receivedAt.current) / 1000
      : null;
  const snap = incident?.peak_snapshot ?? incident?.snapshot;

  return (
    <div
      className="mx-auto flex min-h-dvh max-w-[430px] flex-col"
      style={{ background: bg, color: fg }}
    >
      <audio ref={audio} src="/alarm.mp3" preload="auto" />
      <div
        className="flex items-center justify-between px-[18px] py-3.5"
        style={{
          borderBottom: `1px solid ${pushed ? "rgb(255 255 255 / 0.35)" : "#DCDFE4"}`,
        }}
      >
        <div className="flex items-center gap-2">
          <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
            <path
              d="M3 16c3.5-6 8-9 13-9s9.5 3 13 9c-3.5 6-8 9-13 9s-9.5-3-13-9z"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinejoin="round"
            />
            <circle cx="16" cy="16" r="4.5" fill="currentColor" />
          </svg>
          <span className="ee-display text-[20px] tracking-[0.04em]">
            EarlyEye
          </span>
        </div>
        <span className="font-mono text-[12px] font-bold uppercase">
          {staff}
        </span>
      </div>

      {view === "offduty" && (
        <div className="flex flex-1 flex-col justify-center gap-[18px] px-[22px] py-7">
          <h1 className="ee-display text-[46px]">Start your shift</h1>
          <p className="text-[17px] leading-[1.45] text-ink-2">
            One tap turns on sound, keeps the screen awake and goes full screen.
            This phone only rings at fight likely.
          </p>
          <button
            type="button"
            onClick={goOnDuty}
            className="ee-display min-h-[84px] rounded-[2px] bg-ink text-[36px] text-white"
          >
            I&apos;m on duty
          </button>
          <span className="font-mono text-[12px] text-muted-ink">
            OPENED FROM /push?staff={encodeURIComponent(staff)}
          </span>
        </div>
      )}

      {view === "idle" && (
        <div className="flex flex-1 flex-col gap-4 px-[22px] py-6">
          <div className="flex items-center gap-2.5">
            <span className="size-3.5 rounded-full bg-[#2E8B57]" aria-hidden />
            <span className="font-mono text-[13px] font-bold">
              ON DUTY · SCREEN STAYS AWAKE
            </span>
          </div>
          <h1 className="ee-display text-[50px] leading-[0.92]">
            No alerts.
            <br />
            All quiet.
          </h1>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-0.5 rounded-[2px] border border-line bg-white p-3">
              <span className="font-mono text-[24px] font-bold">
                {pushedCount}/3
              </span>
              <span className="text-[12px] text-ink-2">pushes this shift</span>
            </div>
            <div className="flex flex-col gap-0.5 rounded-[2px] border border-line bg-white p-3">
              <span className="font-mono text-[24px] font-bold">
                {camsLive ?? "—"}/{cameras?.length ?? "—"}
              </span>
              <span className="text-[12px] text-ink-2">cameras live</span>
            </div>
          </div>
          {mySlot && (
            <div className="flex flex-col gap-1 rounded-[2px] border border-line bg-white p-3">
              <span className="ee-label">Your patrol slot today</span>
              <span className="text-[18px] font-extrabold">
                {mySlot.location} · {mySlot.hours}
              </span>
              <span className="text-[13px] text-ink-2">
                From this week&apos;s patrol plan.
              </span>
            </div>
          )}
          <p className="text-[14px] leading-[1.45] text-ink-2">
            Tense alerts stay on the desk screen. You are pushed only when a
            fight is likely, and only you.
          </p>
        </div>
      )}

      {pushed && incident && (
        <div className="flex flex-1 flex-col gap-3 p-4" role="alert">
          <div className="flex items-center justify-between gap-2">
            <span className="ee-display inline-flex items-center gap-2.5 text-[40px] leading-none">
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  d={
                    incident.level === "fight"
                      ? "M8 2h8l6 6v8l-6 6H8l-6-6V8z"
                      : "M12 2 22 12 12 22 2 12z"
                  }
                  fill="#FFFFFF"
                />
              </svg>
              {incident.level === "fight" ? "Fight" : "Fight likely"}
            </span>
            <span className="font-mono text-[13px] font-bold">
              {fmtTime(incident.pushed_at ?? incident.start_time)}
            </span>
          </div>
          <div className="flex flex-col gap-2.5 rounded-[2px] bg-white p-3.5 text-ink">
            <div className="ee-display text-[38px]">{incident.location}</div>
            <div className="flex flex-wrap items-center gap-1.5">
              <TypeChip type={incident.type} size="md" className="border-2" />
              <span className="text-[15px] font-bold">
                {[
                  etaLeft != null && etaLeft > 0
                    ? `in ~${Math.round(etaLeft)} s`
                    : incident.level === "fight"
                      ? "in progress"
                      : null,
                  dist,
                  `${incident.people_count} people`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </div>
            {snap ? (
              <SkeletonView
                frame={snap}
                level={incident.level}
                background="remote"
                stroke={6}
                hud={{ topLeft: "SKELETON SNAPSHOT · NO VIDEO" }}
                ariaLabel="Skeleton snapshot, no video"
              />
            ) : (
              <div className="rounded-[2px] bg-frame-remote p-3 font-mono text-[12px] text-[#ECEFF3]">
                SKELETON SNAPSHOT · NOT SENT
              </div>
            )}
            <p className="text-[18px] font-medium leading-[1.35]">
              {incident.reason}
            </p>
          </div>
          <div className="mt-auto flex items-center gap-3.5">
            <svg
              width="72"
              height="72"
              viewBox="0 0 80 80"
              role="img"
              aria-label={`${left} seconds left to answer`}
            >
              <circle
                cx="40"
                cy="40"
                r="34"
                fill="none"
                stroke="rgb(255 255 255 / 0.3)"
                strokeWidth="8"
              />
              <circle
                cx="40"
                cy="40"
                r="34"
                fill="none"
                stroke="#FFFFFF"
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray="213.6"
                strokeDashoffset={213.6 * (1 - left / ANSWER_S)}
                transform="rotate(-90 40 40)"
              />
              <text
                x="40"
                y="47"
                textAnchor="middle"
                fontFamily="var(--font-atkinson-mono), monospace"
                fontSize="22"
                fontWeight="700"
                fill="#FFFFFF"
              >
                {left}
              </text>
            </svg>
            <span className="text-[15px] leading-[1.4]">
              seconds to answer. Only you were pushed.
            </span>
          </div>
          <button
            type="button"
            onClick={ack}
            className="ee-display min-h-20 rounded-[2px] bg-white text-[36px] text-ink"
          >
            On my way
          </button>
        </div>
      )}

      {(view === "acked" || view === "timeout") && (
        <div className="flex flex-1 flex-col justify-center gap-4 px-[22px] py-7">
          <div
            className="flex size-20 items-center justify-center rounded-full border-[3px] bg-white"
            style={{ borderColor: view === "acked" ? "#17663D" : "#0B0D10" }}
          >
            <svg width="40" height="40" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d={view === "acked" ? "M4 12.5l5 5L20 6.5" : "M12 6v8M12 18v.5"}
                fill="none"
                stroke={view === "acked" ? "#17663D" : "#0B0D10"}
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <h1
            className="ee-display text-[46px]"
            style={{ color: view === "acked" ? "#17663D" : "#0B0D10" }}
          >
            {view === "acked"
              ? `Acknowledged in ${took} s`
              : "No answer in 10 s"}
          </h1>
          <p className="text-[17px] leading-[1.45] text-ink-2">
            {view === "acked"
              ? "The desk can see you are on the way. Back to on-duty in 5 s."
              : "The desk can see you did not answer and will call you by radio."}
          </p>
          {localOnly && (
            <p className="text-[14px] font-bold text-ink">
              Saved on this phone only. The desk did not get the tap.
            </p>
          )}
          {incident && (
            <div className="border-t border-line pt-3 font-mono text-[12px] uppercase text-muted-ink">
              {incident.location} · {incident.incident_id}
            </div>
          )}
        </div>
      )}

      {demo && (
        <div className="flex items-center justify-between gap-2 border-t border-line bg-white px-4 pb-3.5 pt-2.5 text-ink">
          <span className="font-mono text-[11px] text-muted-ink">
            DEMO CONTROL
          </span>
          <button
            type="button"
            onClick={testPush}
            disabled={view === "offduty"}
            className="min-h-10 rounded-[2px] border border-dashed border-muted-ink bg-white px-3 text-[13px] font-bold disabled:opacity-50"
          >
            Send a test push
          </button>
        </div>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { getCameras, getEvents, getPatrolPlan, getSite } from "@/lib/api";
import type { Camera, Event, Level } from "@/lib/types";
import {
  fmtBlackFor,
  fmtDateTime,
  fmtTime,
  LEVEL_LABEL,
  LEVEL_THEME,
  normaliseStatus,
  zoneLabel,
  zoneRisk,
} from "@/lib/format";
import {
  cameraKind,
  kindSuffix,
  recordingLine,
  sourceLabel,
  tileTimeLine,
  type CameraKind,
} from "@/lib/camera-meta";
import { useAlarmStore, selectPulsingCameras } from "@/lib/store/alarm-store";
import { useClock } from "@/hooks/use-clock";
import { cn } from "@/lib/utils";
import { PageShell } from "@/components/chrome/page-shell";
import { CameraFrame } from "@/components/skeleton/skeleton-view";
import { CameraFeed } from "@/components/camera/camera-feed";
import { Campus3D } from "@/components/campus3d";

type Filter = "all" | "live" | "rec" | "black" | "active";
const DAY = 86_400_000;

function isOpen(e: Event) {
  return (
    e.end_time == null &&
    e.level !== "calm" &&
    e.status !== "dismissed" &&
    e.status !== "resolved"
  );
}

function mytDay(iso: string | Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
  }).format(typeof iso === "string" ? new Date(iso) : iso);
}

export function CamerasScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const now = useClock(1000);
  const { data: site } = useSWR("site", getSite, { revalidateOnFocus: false });
  const { data: cameras } = useSWR("cameras", getCameras, {
    refreshInterval: 10_000,
  });
  const { data: events } = useSWR(["events", "full"], () => getEvents(), {
    refreshInterval: 10_000,
  });
  const { data: plan } = useSWR("plan", getPatrolPlan, {
    revalidateOnFocus: false,
  });
  const pulsingStr = useAlarmStore(selectPulsingCameras);
  const pulsing = useMemo(
    () => new Set(pulsingStr ? pulsingStr.split(",") : []),
    [pulsingStr],
  );

  const [filter, setFilter] = useState<Filter>("all");
  const [reported, setReported] = useState<Record<string, string>>({});
  const camParam = params.get("cam");
  const list = cameras ?? [];
  const evs = useMemo(
    () =>
      (events ?? []).map((e) => ({ ...e, status: normaliseStatus(e.status) })),
    [events],
  );
  const openByCam = useMemo(() => {
    const m = new Map<string, Event>();
    for (const e of evs.filter(isOpen).sort((a, b) => b.priority - a.priority))
      if (!m.has(e.camera_id)) m.set(e.camera_id, e);
    return m;
  }, [evs]);

  const kinds = new Map<string, CameraKind>(
    list.map((c) => [c.camera_id, cameraKind(c)]),
  );
  const counts: Record<Filter, number> = {
    all: list.length,
    live: list.filter((c) => kinds.get(c.camera_id) === "live").length,
    rec: list.filter((c) => kinds.get(c.camera_id) === "recorded").length,
    black: list.filter((c) => kinds.get(c.camera_id) === "black").length,
    active: list.filter((c) => openByCam.has(c.camera_id)).length,
  };
  const shown = list.filter((c) => {
    const k = kinds.get(c.camera_id);
    if (filter === "live") return k === "live";
    if (filter === "rec") return k === "recorded";
    if (filter === "black") return k === "black";
    if (filter === "active") return openByCam.has(c.camera_id);
    return true;
  });

  const selected: Camera | undefined =
    list.find((c) => c.camera_id === camParam) ??
    list.find((c) => kinds.get(c.camera_id) === "live") ??
    list[0];
  const select = (id: string) =>
    router.replace(`/cameras?cam=${encodeURIComponent(id)}`, { scroll: false });

  const levelOf = (c: Camera): Level | null =>
    kinds.get(c.camera_id) === "black"
      ? null
      : (openByCam.get(c.camera_id)?.level ?? "calm");

  return (
    <PageShell>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="ee-label text-[12px]">
            All cameras · {counts.live} live webcam · {counts.rec} labelled
            recordings · {counts.black} black
          </span>
          <h1 className="ee-display text-[52px] sm:text-[60px]">Cameras</h1>
        </div>
        <div
          role="group"
          aria-label="Filter cameras"
          className="flex flex-wrap gap-1.5"
        >
          {(
            [
              ["all", "All"],
              ["live", "Live webcam"],
              ["rec", "Recordings"],
              ["black", "Black"],
              ["active", "With an incident"],
            ] as [Filter, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-pressed={filter === k}
              onClick={() => setFilter(k)}
              className={cn(
                "inline-flex min-h-10 items-center gap-1.5 rounded-[2px] border px-3 text-[14px] font-bold",
                filter === k
                  ? "border-ink bg-ink text-white"
                  : "border-line-strong bg-white text-ink",
              )}
            >
              {label} <span className="font-mono">{counts[k]}</span>
            </button>
          ))}
        </div>
      </div>

      <section
        aria-labelledby="map-h"
        className="flex flex-col gap-2.5 rounded-[2px] border border-line bg-white p-3.5"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="map-h" className="ee-display text-[28px]">
            Campus in 3D
          </h2>
          <span className="font-mono text-[12px] uppercase text-muted-ink">
            {site?.name ?? "Site"} · drag to rotate · click a building or camera
          </span>
        </div>
        {site && cameras && plan ? (
          <Campus3D
            mode="cameras"
            cameras={cameras}
            site={site}
            events={evs}
            plan={plan}
            selectedCameraId={camParam ?? undefined}
            onSelectCamera={select}
            onOpenCamera={(id) =>
              router.push(`/?cam=${encodeURIComponent(id)}`)
            }
          />
        ) : (
          <div
            className="h-[560px] rounded-[2px] border border-line bg-raised"
            aria-busy="true"
          />
        )}
      </section>

      <div className="flex flex-wrap items-start gap-3.5">
        <section
          aria-label="Camera grid"
          className="grid min-w-0 flex-[3_1_640px] grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3"
        >
          {shown.map((c) => {
            const k = kinds.get(c.camera_id)!;
            const inc = openByCam.get(c.camera_id);
            const lv = levelOf(c);
            const t = lv ? LEVEL_THEME[lv] : null;
            const sel = c.camera_id === selected?.camera_id;
            const pulse = pulsing.has(c.camera_id);
            const risk = zoneRisk(site, c.zone_type);
            return (
              <button
                key={c.camera_id}
                type="button"
                onClick={() => select(c.camera_id)}
                aria-pressed={sel}
                className={cn(
                  "flex flex-col overflow-hidden rounded-[2px] bg-white text-left text-ink",
                  pulse && "ee-pulse",
                )}
                style={{
                  border: pulse
                    ? "2px solid #C8241B"
                    : sel
                      ? "2px solid #0B0D10"
                      : "1px solid #DCDFE4",
                }}
              >
                <span className="relative block w-full">
                  <CameraFeed
                    camera={c}
                    frame={inc?.snapshot ?? inc?.peak_snapshot}
                    level={lv ?? "calm"}
                    showBox={false}
                    stroke={5}
                    now={now}
                  />
                  <span className="absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-[1px] bg-[rgb(11_13_16/0.75)] px-1.5 py-0.5 font-mono text-[11px] font-bold text-white">
                    <span
                      className="size-[7px] rounded-full"
                      style={{
                        background:
                          k === "black"
                            ? "#8B939E"
                            : k === "live"
                              ? "#FF453A"
                              : "#AEB7C2",
                      }}
                      aria-hidden
                    />
                    {c.camera_id}
                    {kindSuffix(k)}
                  </span>
                  <span
                    className="absolute bottom-2 right-2 rounded-[1px] border px-1.5 py-0.5 text-[11px] font-extrabold uppercase"
                    style={
                      t
                        ? {
                            background: t.pillBg,
                            color: t.pillFg,
                            borderColor: t.pillBorder,
                          }
                        : {
                            background: "#0B0D10",
                            color: "#FFFFFF",
                            borderColor: "#0B0D10",
                          }
                    }
                  >
                    {lv ? LEVEL_LABEL[lv] : "No signal"}
                  </span>
                </span>
                <span className="flex flex-col gap-0.5 px-3 py-2.5">
                  <span className="truncate text-[16px] font-extrabold">
                    {c.location}
                  </span>
                  <span className="flex justify-between gap-2 font-mono text-[11px] uppercase text-muted-ink">
                    <span className="truncate">
                      {zoneLabel(site, c.zone_type)}
                      {risk != null ? ` · RISK ${risk.toFixed(1)}` : ""}
                    </span>
                    <span className="whitespace-nowrap">{tileTimeLine(c)}</span>
                  </span>
                </span>
              </button>
            );
          })}
          {!shown.length && (
            <p className="text-[15px] text-ink-2">
              {cameras ? "No camera matches this filter." : "Loading cameras…"}
            </p>
          )}
        </section>

        {selected && (
          <CameraDetail
            camera={selected}
            kind={kinds.get(selected.camera_id)!}
            level={levelOf(selected)}
            incident={openByCam.get(selected.camera_id)}
            events={evs.filter((e) => e.camera_id === selected.camera_id)}
            hotspot={hotspotFor(selected, plan?.slots, site?.zones)}
            zone={zoneLabel(site, selected.zone_type)}
            risk={zoneRisk(site, selected.zone_type)}
            now={now}
            reported={reported[selected.camera_id]}
            onReport={() =>
              setReported((r) => ({
                ...r,
                [selected.camera_id]: fmtTime(new Date(), false),
              }))
            }
          />
        )}
      </div>
    </PageShell>
  );
}

function hotspotFor(
  c: Camera,
  slots: { location: string; days: string; hours: string }[] | undefined,
  zones: { zone_type: string; risk: number }[] | undefined,
): string {
  const s = slots?.find((x) => x.location === c.location);
  if (s) return `${s.days} ${s.hours}`;
  if (c.zone_type === "sports_court") return "None. Play is suppressed here.";
  return zones ? "None" : "—";
}

function CameraDetail({
  camera: c,
  kind,
  level,
  incident,
  events,
  hotspot,
  zone,
  risk,
  now,
  reported,
  onReport,
}: {
  camera: Camera;
  kind: CameraKind;
  level: Level | null;
  incident?: Event;
  events: Event[];
  hotspot: string;
  zone: string;
  risk?: number;
  now: Date;
  reported?: string;
  onReport: () => void;
}) {
  const t = level ? LEVEL_THEME[level] : null;
  const today = mytDay(now);
  const alertsToday = events.filter(
    (e) => mytDay(e.start_time) === today && e.level !== "calm",
  ).length;
  const w4 = events.filter(
    (e) => Date.parse(e.start_time) >= now.getTime() - 28 * DAY,
  ).length;
  const conf = events.filter(
    (e) => e.status === "confirmed" || (e.status === "resolved" && e.pushed_to),
  ).length;
  const dis = events.filter((e) => e.status === "dismissed").length;
  const total = conf + dis;
  const source =
    kind === "live"
      ? "Live webcam on the demo laptop"
      : kind === "recorded"
        ? (recordingLine(c) ?? "Recording, looping")
        : c.black_since
          ? `Black since ${fmtDateTime(c.black_since)} · ${fmtBlackFor(c.black_since, now).replace(/^Black for /, "")}`
          : "No signal";
  const facts: [string, string, boolean?][] = [
    ["SOURCE", source, true],
    [
      "BUILDING",
      c.geo?.building
        ? `${c.geo.building}${c.geo.floor ? `, ${c.geo.floor}` : ""}`
        : "—",
    ],
    ["ZONE", `${zone}${risk != null ? `, risk ${risk.toFixed(1)}` : ""}`],
    [
      "IN VIEW NOW",
      kind === "black" || c.people_count == null
        ? "Unknown"
        : `${c.people_count} people`,
    ],
    ["ALERTS TODAY", String(alertsToday)],
    ["LAST 4 WEEKS", `${w4} incidents`],
    ["HOTSPOT", hotspot],
  ];
  return (
    <aside
      aria-label="Camera details"
      className="flex min-w-0 flex-[1_1_380px] flex-col gap-3.5 rounded-[2px] border border-line bg-white p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 font-mono text-[13px] font-bold">
          <span
            className="size-2 rounded-full"
            style={{
              background:
                kind === "black"
                  ? "#8B939E"
                  : kind === "live"
                    ? "#FF453A"
                    : "#AEB7C2",
            }}
            aria-hidden
          />
          {c.camera_id} · {sourceLabel(kind)}
        </span>
        <span
          className="rounded-[1px] border px-2 py-0.5 text-[12px] font-extrabold uppercase"
          style={
            t
              ? {
                  background: t.pillBg,
                  color: t.pillFg,
                  borderColor: t.pillBorder,
                }
              : {
                  background: "#0B0D10",
                  color: "#FFFFFF",
                  borderColor: "#0B0D10",
                }
          }
        >
          {level ? LEVEL_LABEL[level] : "No signal"}
        </span>
      </div>
      <h2 className="ee-display text-[40px]">{c.location}</h2>
      <CameraFrame>
        <CameraFeed
          camera={c}
          frame={incident?.snapshot ?? incident?.peak_snapshot}
          level={level ?? "calm"}
          showBox={!!incident}
          score={incident?.peak_score}
          now={now}
          hud={{
            topLeft: `${c.camera_id}${kindSuffix(kind)} · ${c.location.toUpperCase()}`,
          }}
        />
      </CameraFrame>
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
        {facts.map(([k, v, strong]) => (
          <div key={k} className="contents">
            <dt className="ee-label pt-0.5">{k}</dt>
            <dd className={cn("m-0 text-[15px]", strong && "font-extrabold")}>
              {v}
            </dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-col gap-1.5 rounded-[2px] border border-line bg-raised p-3">
        <span className="ee-label">Labels for this camera</span>
        {total > 0 && (
          <span className="flex h-2 overflow-hidden rounded-[1px]" aria-hidden>
            <span
              className="bg-ink"
              style={{ width: `${(conf / total) * 100}%` }}
            />
            <span
              className="bg-line-strong"
              style={{ width: `${(dis / total) * 100}%` }}
            />
          </span>
        )}
        <span className="text-[14px]">
          {total
            ? `${conf} confirmed real, ${dis} dismissed. ${dis > conf ? "Mostly false alarms: ask to retune this camera." : "Labels look healthy."}`
            : "No labels yet."}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {kind === "black" && (
          <button
            type="button"
            onClick={onReport}
            disabled={!!reported}
            className={cn(
              "inline-flex min-h-11 items-center rounded-[2px] px-3.5 text-[14px] font-extrabold text-white",
              reported ? "bg-muted-ink" : "bg-signal",
            )}
          >
            {reported ? `Repair reported · ${reported}` : "Report repair"}
          </button>
        )}
        <Link
          href={`/?cam=${encodeURIComponent(c.camera_id)}`}
          className="inline-flex min-h-11 items-center rounded-[2px] border border-ink px-3.5 text-[14px] font-extrabold text-ink no-underline"
        >
          {kind === "recorded" ? "Play recording in Live" : "Open in Live"}
        </Link>
        <Link
          href={`/incidents?cam=${encodeURIComponent(c.camera_id)}`}
          className="inline-flex min-h-11 items-center rounded-[2px] border border-line-strong px-3.5 text-[14px] font-bold text-ink no-underline"
        >
          See its incidents
        </Link>
        <Link
          href="/plan"
          className="inline-flex min-h-11 items-center rounded-[2px] border border-line-strong px-3.5 text-[14px] font-bold text-ink no-underline"
        >
          Patrol plan
        </Link>
      </div>
    </aside>
  );
}

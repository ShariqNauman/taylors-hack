"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { getCameras, getEvents, getSite, patchEvent } from "@/lib/api";
import type { Camera, Event, Site, Status } from "@/lib/types";
import {
  fmtTime,
  LEVEL_LABEL,
  MYT_TZ,
  normaliseStatus,
  secondsBetween,
  zoneLabel,
} from "@/lib/format";
import { useAppStore } from "@/lib/store/app-store";
import { cn } from "@/lib/utils";
import { PageShell } from "@/components/chrome/page-shell";
import { LevelPill } from "@/components/chrome/level-pill";
import { TypeChip } from "@/components/chrome/type-chip";
import { StatusChip } from "@/components/chrome/status-chip";
import { CameraFrame, SkeletonView } from "@/components/skeleton/skeleton-view";

type Filter =
  "all" | "open" | "pushed" | "confirmed" | "dismissed" | "resolved";
const FILTERS: [Filter, string][] = [
  ["all", "All"],
  ["open", "Open"],
  ["confirmed", "Confirmed"],
  ["dismissed", "Dismissed"],
  ["resolved", "Resolved"],
];

const isOpen = (e: Event) => e.status === "new" || e.status === "pushed";

function dayTime(iso: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: MYT_TZ,
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date(iso))
    .toUpperCase()
    .replace(",", " ·");
}

export function IncidentsScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const { data: events } = useSWR(["events", "full"], () => getEvents(), {
    refreshInterval: 10_000,
  });
  const { data: site } = useSWR("site", getSite, { revalidateOnFocus: false });
  const { data: cameras } = useSWR("cameras", getCameras, {
    refreshInterval: 30_000,
  });
  const [overrides, setOverrides] = useState<Record<string, Partial<Event>>>(
    {},
  );

  const statusParam = (params.get("status") as Filter | null) ?? "all";
  const camParam = params.get("cam");
  const idParam = params.get("id");

  const all = useMemo(
    () =>
      (events ?? [])
        .map(
          (e) =>
            ({
              ...e,
              status: normaliseStatus(e.status),
              ...(overrides[e.incident_id] ?? {}),
            }) as Event,
        )
        .filter((e) => e.level !== "calm")
        .sort((a, b) => Date.parse(b.start_time) - Date.parse(a.start_time)),
    [events, overrides],
  );
  const scoped = camParam ? all.filter((e) => e.camera_id === camParam) : all;
  const match = (e: Event, f: Filter) =>
    f === "all" ? true : f === "open" ? isOpen(e) : e.status === f;
  const rows = scoped.filter((e) => match(e, statusParam));
  const selected = all.find((e) => e.incident_id === idParam) ?? rows[0];

  const conf = all.filter((e) => e.status === "confirmed").length;
  const dis = all.filter((e) => e.status === "dismissed").length;
  const resp = all
    .map((e) => secondsBetween(e.pushed_at, e.acked_at))
    .filter((x): x is number => x != null)
    .sort((a, b) => a - b);
  const median = resp.length ? resp[Math.floor(resp.length / 2)] : null;

  const setQuery = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v == null) q.delete(k);
      else q.set(k, v);
    }
    router.replace(`/incidents${q.toString() ? `?${q}` : ""}`, {
      scroll: false,
    });
  };

  const save = async (
    e: Event,
    patch: { status?: Status; staff_note?: string },
  ) => {
    setOverrides((o) => ({
      ...o,
      [e.incident_id]: { ...o[e.incident_id], ...patch },
    }));
    try {
      await patchEvent(e.incident_id, {
        status: patch.status ?? e.status,
        ...(patch.staff_note != null ? { staff_note: patch.staff_note } : {}),
      });
    } catch {
      // keep the local label; the next poll shows the server state
    }
  };

  return (
    <PageShell>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="ee-label text-[12px]">
            Case review{camParam ? ` · ${camParam}` : ""}
          </span>
          <h1 className="ee-display text-[52px] sm:text-[60px]">Incidents</h1>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            [String(conf + dis), "labels collected", "bg-ink text-white"],
            [String(conf), "confirmed real", "bg-white"],
            [String(dis), "dismissed", "bg-white"],
            [
              median != null ? `${median} s` : "—",
              "median response, push to tap",
              "bg-signal-tint text-signal-ink",
            ],
          ].map(([v, k, cls]) => (
            <div
              key={k}
              className={cn(
                "flex min-w-[130px] flex-col gap-0.5 rounded-[2px] border border-line px-3 py-2",
                cls,
              )}
            >
              <span className="font-mono text-[26px] font-bold">{v}</span>
              <span className="text-[12px]">{k}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-3.5 min-[1000px]:grid-cols-[420px_minmax(0,1fr)]">
        <section
          aria-label="Incident list"
          className="flex min-w-0 flex-col gap-2.5"
        >
          <div
            role="group"
            aria-label="Filter by status"
            className="flex flex-wrap gap-1.5"
          >
            {FILTERS.map(([f, label]) => (
              <button
                key={f}
                type="button"
                aria-pressed={
                  statusParam === f ||
                  (f === "open" && statusParam === "pushed")
                }
                onClick={() =>
                  setQuery({ status: f === "all" ? null : f, id: null })
                }
                className={cn(
                  "inline-flex min-h-10 items-center gap-1.5 rounded-[2px] border px-3 text-[14px] font-bold",
                  statusParam === f ||
                    (f === "open" && statusParam === "pushed")
                    ? "border-ink bg-ink text-white"
                    : "border-line-strong bg-white",
                )}
              >
                {label}{" "}
                <span className="font-mono">
                  {scoped.filter((e) => match(e, f)).length}
                </span>
              </button>
            ))}
            {camParam && (
              <button
                type="button"
                onClick={() => setQuery({ cam: null })}
                className="min-h-10 rounded-[2px] border border-dashed border-line-strong px-3 text-[14px] font-bold"
              >
                {camParam} ×
              </button>
            )}
          </div>
          {statusParam === "pushed" && (
            <p className="text-[13px] text-ink-2">
              Showing incidents that were pushed to a person and have no label
              yet.
            </p>
          )}
          <div className="flex max-h-[1100px] flex-col gap-1.5 overflow-y-auto pr-1">
            {!events && (
              <p className="text-[15px] text-ink-2">Loading incidents…</p>
            )}
            {events && !rows.length && (
              <p className="text-[15px] text-ink-2">
                No incident matches this filter.
              </p>
            )}
            {rows.map((e) => {
              const ack = secondsBetween(e.pushed_at, e.acked_at);
              const sel = e.incident_id === selected?.incident_id;
              return (
                <button
                  key={e.incident_id}
                  type="button"
                  aria-pressed={sel}
                  onClick={() => setQuery({ id: e.incident_id })}
                  className="grid grid-cols-[104px_minmax(0,1fr)] gap-2.5 rounded-[2px] bg-white p-2 text-left text-ink"
                  style={{
                    border: sel ? "2px solid #0B0D10" : "1px solid #DCDFE4",
                  }}
                >
                  <SkeletonView
                    frame={e.peak_snapshot}
                    level={e.level}
                    showBox={false}
                    stroke={7}
                    background="remote"
                    ariaLabel="Skeleton at the peak"
                  />
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-1">
                      <LevelPill level={e.level} size="sm" />
                      <TypeChip type={e.type} size="sm" />
                      <StatusChip status={e.status} />
                    </span>
                    <span className="truncate text-[15px] font-extrabold">
                      {e.location}
                    </span>
                    <span className="truncate font-mono text-[11px] text-muted-ink">
                      {dayTime(e.start_time)} · {e.camera_id} · P{" "}
                      {e.priority.toFixed(2)}
                      {ack != null ? ` · ACK ${ack} S` : ""}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
        {selected ? (
          <CaseView
            key={selected.incident_id}
            e={selected}
            site={site}
            camera={cameras?.find((c) => c.camera_id === selected.camera_id)}
            onSave={save}
          />
        ) : (
          <section className="rounded-[2px] border border-line bg-white p-5 text-[15px] text-ink-2">
            Pick an incident to review it.
          </section>
        )}
      </div>
    </PageShell>
  );
}

function rulesFor(e: Event, site?: Site) {
  const zone = zoneLabel(site, e.zone_type);
  return [
    {
      type: "fight",
      rule: "Two parties with a strike pattern",
      seen:
        e.type === "fight"
          ? `${e.people_count} people; fast arm motion while close`
          : "No strike pattern between two people",
      met: e.type === "fight",
    },
    {
      type: "cornering",
      rule: "1 against 3 or more, over 5 s",
      seen:
        e.type === "cornering"
          ? `1 against ${Math.max(3, e.people_count - 1)}`
          : `${e.people_count} people; no one held against a wall`,
      met: e.type === "cornering",
    },
    {
      type: "crowd",
      rule: "5 or more close, low motion",
      seen: `${e.people_count} people close`,
      met: e.type === "crowd",
    },
    {
      type: "play",
      rule: "Sports zone or rhythmic motion",
      seen:
        e.zone_type === "sports_court"
          ? `${zone}: sports zone`
          : `${zone}: not a sports zone`,
      met: e.type === "play",
    },
  ];
}

function CaseView({
  e,
  site,
  camera,
  onSave,
}: {
  e: Event;
  site?: Site;
  camera?: Camera;
  onSave: (e: Event, p: { status?: Status; staff_note?: string }) => void;
}) {
  const view = useAppStore((s) => s.view);
  const [note, setNote] = useState(e.staff_note ?? "");
  const [clip, setClip] = useState(false);
  const [clipFailed, setClipFailed] = useState(false);
  useEffect(() => setNote(e.staff_note ?? ""), [e.staff_note]);
  const onsite = view === "onsite" && !!camera?.edge_url;
  const ack = secondsBetween(e.pushed_at, e.acked_at);

  const trail: { t: string; text: string; dot: string }[] = [
    {
      t: fmtTime(e.start_time),
      text:
        e.level === "tense"
          ? "Tense. Shown on the desk, silent."
          : "Detected. Shown on the desk.",
      dot: "#F5B323",
    },
  ];
  if (e.pushed_at)
    trail.push({
      t: fmtTime(e.pushed_at),
      text: `${LEVEL_LABEL[e.level === "fight" ? "fight" : "fight_likely"]}. ${e.pushed_to ?? "Person on duty"} pushed.`,
      dot: "#C8241B",
    });
  if (e.acked_at)
    trail.push({
      t: fmtTime(e.acked_at),
      text: `${e.pushed_to ?? "Person on duty"} tapped "On my way". Response ${ack} s.`,
      dot: "#2742D9",
    });
  if (e.pushed_at && !e.acked_at)
    trail.push({
      t: "—",
      text: "No tap from the phone recorded.",
      dot: "#DCDFE4",
    });
  if (e.level === "fight")
    trail.push({
      t: "—",
      text: "Fight. Alarm kept on; security lead called.",
      dot: "#7F1310",
    });
  if (e.status === "confirmed")
    trail.push({
      t: "—",
      text: "Desk confirmed: real incident.",
      dot: "#0B0D10",
    });
  if (e.status === "dismissed")
    trail.push({
      t: "—",
      text: `Desk dismissed: false alarm. Label saved for ${e.camera_id}.`,
      dot: "#DCDFE4",
    });
  if (e.end_time)
    trail.push({
      t: fmtTime(e.end_time),
      text: e.status === "resolved" ? "Ended. Resolved." : "Ended.",
      dot: "#FFFFFF",
    });
  if (e.status === "new" || e.status === "pushed")
    trail.push({
      t: "now",
      text: "Open. Waiting for the desk.",
      dot: "#FFFFFF",
    });

  const clipUrl =
    onsite && camera?.edge_url
      ? `${camera.edge_url.replace(/\/$/, "")}/clips/${encodeURIComponent(e.incident_id)}.mp4`
      : null;

  return (
    <section
      aria-label="Case"
      className="flex min-w-0 flex-col gap-3.5 rounded-[2px] border border-line bg-white p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <LevelPill level={e.level} size="lg" />
        <TypeChip type={e.type} size="lg" />
        <StatusChip status={e.status} />
        <span className="ml-auto font-mono text-[13px] font-bold">
          {e.incident_id}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <h2 className="ee-display text-[40px]">{e.location}</h2>
        <span className="font-mono text-[12px] uppercase text-ink-2">
          {dayTime(e.start_time)} · {e.camera_id} ·{" "}
          {zoneLabel(site, e.zone_type)} · priority {e.priority.toFixed(2)}
        </span>
        <span className="flex flex-wrap gap-x-4 text-[14px] font-bold">
          <Link
            href={`/cameras?cam=${encodeURIComponent(e.camera_id)}`}
            className="text-signal"
          >
            Open this camera on the 3D campus
          </Link>
          <Link href="/" className="text-signal">
            Back to Live
          </Link>
        </span>
      </div>
      <div className="grid gap-3.5 min-[1200px]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <figure className="m-0 flex flex-col gap-2">
          <CameraFrame>
            {clip && clipUrl && !clipFailed ? (
              <video
                src={clipUrl}
                controls
                autoPlay
                className="block aspect-video w-full bg-black"
                onError={() => setClipFailed(true)}
              />
            ) : (
              <SkeletonView
                frame={e.peak_snapshot}
                level={e.level}
                score={e.peak_score}
                background={onsite ? "onsite" : "remote"}
                hud={{
                  topLeft: `${e.camera_id} · PEAK FRAME`,
                  bottomLeft: e.peak_snapshot
                    ? "NO PIXELS LEAVE THE SITE · 12 BODY KEYPOINTS PER PERSON"
                    : "NO PEAK SNAPSHOT SENT FOR THIS INCIDENT",
                }}
              />
            )}
          </CameraFrame>
          <figcaption className="flex flex-wrap items-center gap-2.5 text-[13px] text-ink-2">
            {onsite ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setClip((c) => !c);
                    setClipFailed(false);
                  }}
                  className="min-h-10 rounded-[2px] bg-signal px-3.5 text-[14px] font-extrabold text-white"
                >
                  {clip ? "Back to the peak frame" : "Play 10 s clip on site"}
                </button>
                <span>
                  {clipFailed
                    ? "No clip for this incident on the edge laptop."
                    : "10 s clip on the edge laptop · auto-deletes after [N] days · never uploaded"}
                </span>
              </>
            ) : (
              <span>
                Video stays on site. This is the skeleton at the peak, rebuilt
                from keypoints.
              </span>
            )}
          </figcaption>
        </figure>
        <div className="flex flex-col gap-2">
          <span className="ee-label">Why this type · rules on the score</span>
          {rulesFor(e, site).map((u) => (
            <div
              key={u.type}
              className="flex items-start gap-2 rounded-[2px] border p-2.5"
              style={{
                borderColor: u.met ? "#9FD3B4" : "#DCDFE4",
                background: u.met ? "#F3FAF5" : "#F7F8FA",
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                aria-hidden
                className="mt-0.5 shrink-0"
              >
                <path
                  d={u.met ? "M4 12.5l5 5L20 6.5" : "M6 6l12 12M18 6L6 18"}
                  fill="none"
                  stroke={u.met ? "#17663D" : "#8B939E"}
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              </svg>
              <span className="flex flex-col">
                <span
                  className={cn(
                    "text-[14px] font-bold",
                    !u.met && "text-muted-ink",
                  )}
                >
                  {u.rule}
                  <span className="sr-only">
                    {u.met ? ": met" : ": not met"}
                  </span>
                </span>
                <span className="text-[12px] text-ink-2">{u.seen}</span>
              </span>
            </div>
          ))}
          <span className="text-[12px] text-muted-ink">
            Types are rules on top of the model&apos;s score, not a separate
            model.
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-1 rounded-[2px] border border-line bg-raised p-3">
        <span className="ee-label">Why the model flagged it</span>
        <p className="m-0 text-[20px] font-medium leading-snug">{e.reason}</p>
      </div>
      <div className="grid gap-3.5 min-[1000px]:grid-cols-2">
        <div className="flex flex-col gap-2">
          <span className="ee-label">Audit trail</span>
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {trail.map((a, i) => (
              <li
                key={i}
                className="grid grid-cols-[64px_12px_1fr] items-start gap-2 text-[14px]"
              >
                <span className="font-mono text-[12px] text-ink-2">{a.t}</span>
                <span
                  className="mt-1 size-2.5 rounded-full border border-line-strong"
                  style={{ background: a.dot }}
                  aria-hidden
                />
                <span>{a.text}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="flex flex-col gap-2">
          <label className="ee-label flex flex-col gap-1.5">
            Staff note
            <textarea
              value={note}
              onChange={(ev) => setNote(ev.target.value)}
              rows={3}
              placeholder="What happened, in one line"
              className="rounded-[2px] border border-line-strong bg-raised p-2.5 font-sans text-[15px] font-normal normal-case tracking-normal text-ink"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() =>
                onSave(e, { status: "confirmed", staff_note: note })
              }
              className="min-h-[52px] rounded-[2px] bg-ink text-[16px] font-extrabold text-white"
            >
              Confirm: real
            </button>
            <button
              type="button"
              onClick={() =>
                onSave(e, { status: "dismissed", staff_note: note })
              }
              className="min-h-[52px] rounded-[2px] border-2 border-ink bg-white text-[16px] font-extrabold"
            >
              Dismiss: false alarm
            </button>
          </div>
          <button
            type="button"
            onClick={() => onSave(e, { status: "resolved", staff_note: note })}
            className="min-h-[52px] rounded-[2px] border border-line-strong bg-white text-[16px] font-bold"
          >
            Mark resolved
          </button>
          <span className="text-[12px] text-muted-ink">
            The desk&apos;s Confirm or Dismiss is the label. The phone tap only
            records &quot;on my way&quot;.
          </span>
        </div>
      </div>
    </section>
  );
}

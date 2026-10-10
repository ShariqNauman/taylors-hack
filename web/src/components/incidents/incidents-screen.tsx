"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import { EDGE_URL, getCameras, getEdgeClips, getEvents, patchEvent, PatchError } from "@/lib/api";
import type { Camera, Event, Status } from "@/lib/types";
import { fmtTime, normaliseStatus, secondsBetween } from "@/lib/format";
import {
  bucketOf,
  buildingLine,
  cameraName,
  caseTitle,
  dayHeading,
  dayKey,
  dayLong,
  dayShort,
  guardLine,
  hm,
  LEVEL_NOTE,
  NEXT_STEPS,
  placePhrase,
  repeatPlaces,
  STATUS_CHIP_STYLE,
  STATUS_WORDS,
  TYPE_WORDS,
  type Bucket,
  OUTCOME_WORDS,
} from "@/lib/plain";
import { useAppStore } from "@/lib/store/app-store";
import { useClock } from "@/hooks/use-clock";
import { useFirstName } from "@/hooks/use-first-name";
import { cn } from "@/lib/utils";
import { PageShell } from "@/components/chrome/page-shell";
import { HowItWorks } from "@/components/chrome/how-it-works";
import { LevelPill } from "@/components/chrome/level-pill";
import { SkeletonView } from "@/components/skeleton/skeleton-view";

type Tab = Bucket | "all";
const TABS: [Tab, string][] = [
  ["decide", "Needs a decision"],
  ["real", "Real"],
  ["false", "False alarms"],
  ["all", "All"],
];
const WEEK4 = 28 * 86_400_000;

/** Old and new ?status= values. */
function tabFromParam(p: string | null): Tab {
  if (!p) return "all";
  if (["decide", "open", "new", "pushed"].includes(p)) return "decide";
  if (["real", "confirmed", "resolved"].includes(p)) return "real";
  if (["false", "dismissed", "false_alarm"].includes(p)) return "false";
  return "all";
}

const SIGNAL: Record<string, string> = {
  close_motion: "close motion",
  pair_motion_energy: "pair motion",
  max_wrist_speed: "wrist speed",
  risk_score: "risk score",
};

const label =
  "font-mono text-[12px] font-bold tracking-[0.08em] text-muted-ink";

const LAPTOP_EDGE = "http://127.0.0.1:8765";

export function IncidentsScreen() {
  const firstName = useFirstName();
  const params = useSearchParams();
  const router = useRouter();
  const now = useClock(30_000);
  const { data: events, error } = useSWR(
    ["events", "full"],
    () => getEvents(),
    { refreshInterval: 10_000 },
  );
  const { data: cameras } = useSWR("cameras", getCameras, {
    refreshInterval: 30_000,
  });

  // Optimistic edits; rolled back with a toast if the PATCH fails.
  const [overrides, setOverrides] = useState<Record<string, Partial<Event>>>(
    {},
  );

  const tab = tabFromParam(params.get("status"));
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
  const camById = useMemo(
    () => new Map((cameras ?? []).map((c) => [c.camera_id, c])),
    [cameras],
  );
  const scoped = camParam ? all.filter((e) => e.camera_id === camParam) : all;
  const inTab = (e: Event, t: Tab) => t === "all" || bucketOf(e.status) === t;
  // On site, cases with a recording on this laptop come first (the clip never leaves campus).
  const siteView = useAppStore((s) => s.view);
  // The live camera's edge (may be a GPU server) and this laptop's own edge: either may hold a clip.
  // The laptop's is asked directly, since NEXT_PUBLIC_EDGE_URL may point at the GPU server.
  const liveEdge = cameras?.find((c) => c.source === "live" && c.edge_url)?.edge_url ?? null;
  const clipEdges =
    siteView === "onsite"
      ? [...new Set([liveEdge, EDGE_URL, LAPTOP_EDGE].filter((u): u is string => !!u).map((u) => u.replace(/\/$/, "")))]
      : [];
  const { data: clipMap } = useSWR(
    clipEdges.length ? ["edge-clips", ...clipEdges] : null,
    async () => {
      const m = new Map<string, string>();
      const lists = await Promise.all(clipEdges.map((u) => getEdgeClips(u)));
      lists.forEach((ids, i) => ids.forEach((id) => m.has(id) || m.set(id, clipEdges[i])));
      return m;
    },
    { refreshInterval: 10_000 },
  );
  const clipFor = (id: string) => {
    const edge = clipMap?.get(id);
    return edge ? `${edge}/clips/${encodeURIComponent(id)}.mp4` : null;
  };
  const inScope = scoped.filter((e) => inTab(e, tab));
  const recorded = inScope.filter((e) => clipFor(e.incident_id));
  const rows = [...recorded, ...inScope.filter((e) => !clipFor(e.incident_id))];
  const selected =
    all.find((e) => e.incident_id === idParam) ?? rows[0] ?? null;

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
  const caseRef = useRef<HTMLElement>(null);
  const openCase = (id: string, extra: Record<string, string | null> = {}) => {
    setQuery({ id, ...extra });
    if (typeof window !== "undefined" && window.innerWidth < 1100) {
      setTimeout(() => caseRef.current?.scrollIntoView({ block: "start" }), 50);
    }
  };

  const save = async (
    e: Event,
    patch: { status?: Status; staff_note?: string },
    success?: string,
  ) => {
    // Keep this case open even if the decision moves it out of the current tab.
    if (idParam !== e.incident_id) setQuery({ id: e.incident_id });
    const before = overrides[e.incident_id];
    setOverrides((o) => ({
      ...o,
      [e.incident_id]: { ...o[e.incident_id], ...patch },
    }));
    try {
      await patchEvent(e.incident_id, patch);
      if (success) toast.success(success);
    } catch (err) {
      setOverrides((o) => {
        const n = { ...o };
        if (before) n[e.incident_id] = before;
        else delete n[e.incident_id];
        return n;
      });
      toast.error("That change was not saved. Please try again.", {
        description:
          err instanceof PatchError
            ? `The server answered ${err.status}.`
            : undefined,
      });
    }
  };

  // ── Needs you now, last 4 weeks ──
  const decide = all.filter((e) => bucketOf(e.status) === "decide");
  const realOpen = all.filter((e) => e.status === "confirmed");
  const repeats = repeatPlaces(all, now);
  const recent = all.filter(
    (e) => Date.parse(e.start_time) >= now.getTime() - WEEK4,
  );
  const realN = recent.filter((e) => bucketOf(e.status) === "real").length;
  const falseN = recent.filter((e) => bucketOf(e.status) === "false").length;
  const replies = recent
    .map((e) => secondsBetween(e.pushed_at, e.acked_at))
    .filter((x): x is number => x != null)
    .sort((a, b) => a - b);
  const median = replies.length
    ? replies[Math.floor(replies.length / 2)]
    : null;
  const byPlace = new Map<string, number>();
  for (const e of recent)
    if (bucketOf(e.status) === "real")
      byPlace.set(e.location, (byPlace.get(e.location) ?? 0) + 1);
  const busiest = [...byPlace.entries()].sort((a, b) => b[1] - a[1])[0];

  const counts: Record<Tab, number> = {
    decide: scoped.filter((e) => inTab(e, "decide")).length,
    real: scoped.filter((e) => inTab(e, "real")).length,
    false: scoped.filter((e) => inTab(e, "false")).length,
    all: scoped.length,
  };

  return (
    <PageShell>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5">
        <h1 className="ee-display text-[52px]">Incidents</h1>
        <HowItWorks>
          <span>Every alert EarlyEye raises is saved here as a case. Decide if it was real, write down what happened, and follow up.</span>
          <span>Each false alarm you mark helps EarlyEye raise fewer at that spot. People appear as stick figures; the video never leaves campus, and the desk on site can watch the clip.</span>
          <span>EarlyEye never knows who people are, so names go in your own records, not in the notes here.</span>
        </HowItWorks>
      </div>

      <section aria-label="Needs you now" className="flex flex-col gap-2">
        <h2 className={label}>NEEDS YOU NOW</h2>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-2.5">
          <TodoCard
            n={decide.length}
            title={
              decide.length === 1
                ? "alert needs a decision"
                : "alerts need a decision"
            }
            body="Was it real or a false alarm? One tap each."
            emptyTitle="alerts waiting"
            emptyBody="Every alert has a decision."
            strong
            action={
              decide.length
                ? {
                    label: "Review them",
                    primary: true,
                    onClick: () =>
                      openCase(decide[0].incident_id, {
                        status: "decide",
                        cam: null,
                      }),
                  }
                : undefined
            }
          />
          <TodoCard
            n={realOpen.length}
            title={
              realOpen.length === 1
                ? "real incident is still open"
                : "real incidents are still open"
            }
            body="Write what happened, then close each one when the follow-up is done."
            emptyTitle="open incidents"
            emptyBody="Every real incident is closed."
            action={
              realOpen.length
                ? {
                    label: "Open them",
                    onClick: () =>
                      openCase(realOpen[0].incident_id, {
                        status: "real",
                        cam: null,
                      }),
                  }
                : undefined
            }
          />
          {repeats[0] ? (
            <TodoCard
              n={repeats[0].count}
              blue
              title={`real incidents ${placePhrase(repeats[0].location)}`}
              body={`All in the last 4 weeks, between ${repeats[0].hours}. The patrol plan puts one person there at that hour.`}
              emptyTitle=""
              emptyBody=""
              link={{ label: "See the patrol plan", href: "/plan" }}
            />
          ) : (
            <TodoCard
              n={0}
              title=""
              body=""
              emptyTitle="repeat places"
              emptyBody="No place has 3 real incidents in 4 weeks."
            />
          )}
        </div>
      </section>

      <section aria-label="Last 4 weeks" className="flex flex-col gap-2">
        <h2 className={label}>LAST 4 WEEKS</h2>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2.5">
          <Stat
            v={String(realN)}
            k="real incidents"
            sub="Confirmed by the desk"
          />
          <Stat
            v={String(falseN)}
            k="false alarms"
            sub="Each one you mark teaches EarlyEye that spot"
          />
          <Stat
            v={median != null ? `${median} s` : "—"}
            k="for a guard to reply"
            sub={
              median != null
                ? 'Typical time from the alarm to "On my way"'
                : "No replies recorded yet"
            }
          />
          <Stat
            v={busiest ? busiest[0] : "—"}
            k="busiest place"
            sub={
              busiest
                ? `${busiest[1]} real incident${busiest[1] === 1 ? "" : "s"}`
                : "No real incidents yet"
            }
          />
        </div>
      </section>

      <div className="flex flex-wrap items-start gap-3.5">
        <section
          aria-label="All incidents"
          className="flex min-w-0 flex-[1_1_400px] flex-col gap-2.5 rounded-[2px] border border-line bg-white p-3"
        >
          <div
            role="group"
            aria-label="Show"
            className="flex flex-wrap gap-1.5"
          >
            {TABS.map(([t, name]) => (
              <button
                key={t}
                type="button"
                aria-pressed={tab === t}
                onClick={() =>
                  setQuery({ status: t === "all" ? null : t, id: null })
                }
                className={cn(
                  "min-h-10 rounded-[2px] border px-3 text-[14px] font-bold",
                  tab === t
                    ? "border-ink bg-ink text-white"
                    : "border-line-strong bg-white text-ink",
                )}
              >
                {name} <span className="ml-1 font-mono">{counts[t]}</span>
              </button>
            ))}
          </div>
          {camParam && (
            <div className="flex flex-wrap items-center gap-2 text-[14px] text-ink-2">
              Only{" "}
              {cameraName(
                camById.get(camParam),
                scoped[0]?.location ??
                  camById.get(camParam)?.location ??
                  "this camera",
              )}
              .
              <button
                type="button"
                onClick={() => setQuery({ cam: null })}
                className="min-h-9 rounded-[2px] border border-line-strong px-2.5 font-bold text-ink"
              >
                Show every place
              </button>
            </div>
          )}
          {!events && (
            <p className="px-2 py-4 text-[15px] text-ink-2">
              {error
                ? "Could not load the incidents."
                : "Loading the incidents…"}
            </p>
          )}
          {events && !rows.length && (
            <p className="px-2 py-4 text-[15px] text-ink-2">
              Nothing here. Every alert in this list has a decision.
            </p>
          )}
          <div className="flex flex-col gap-1.5 min-[1100px]:max-h-[1200px] min-[1100px]:overflow-y-auto min-[1100px]:pr-1">
            {rows.map((e, i) => {
              const clip = clipFor(e.incident_id);
              const head =
                !clip &&
                      (i === recorded.length ||
                        dayKey(rows[i - 1].start_time) !== dayKey(e.start_time))
                    ? dayHeading(e.start_time, now)
                  : null;
              const on = e.incident_id === selected?.incident_id;
              return (
                <div key={e.incident_id} className="flex flex-col gap-1.5">
                  {head && (
                    <span className={cn(label, "px-0.5 pt-2")}>{head}</span>
                  )}
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => openCase(e.incident_id)}
                    className={cn(
                      "grid w-full items-start gap-3 rounded-[2px] p-2.5 text-left text-ink",
                      clip ? "grid-cols-[128px_minmax(0,1fr)]" : "grid-cols-[56px_minmax(0,1fr)]",
                    )}
                    style={{
                      border: on ? "2px solid #0B0D10" : "1px solid #DCDFE4",
                      background: on ? "#F7F8FA" : "#FFFFFF",
                    }}
                  >
                    {clip ? (
                      <span className="relative block">
                        <video
                          src={`${clip}#t=5`}
                          muted
                          playsInline
                          preload="metadata"
                          aria-label="Recording of this incident"
                          className="block aspect-video w-full rounded-[2px] bg-black object-cover"
                        />
                        <span className="absolute bottom-1 left-1 rounded-[1px] bg-ink/85 px-1 font-mono text-[11px] font-bold text-white">
                          {hm(e.start_time)}
                        </span>
                      </span>
                    ) : (
                      <span className="pt-px font-mono text-[17px] font-bold">
                        {hm(e.start_time)}
                      </span>
                    )}
                    <span className="flex min-w-0 flex-col gap-1.5">
                      <span className="text-[16px] font-extrabold leading-tight">
                        {caseTitle(e)}
                      </span>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <LevelPill level={e.level} size="sm" />
                        <StatusChip status={e.status} />
                        <span className="text-[13px] text-muted-ink">
                          {guardLine(e, firstName)}
                        </span>
                      </span>
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        <section
          ref={caseRef}
          aria-label="The incident"
          className="flex min-w-0 flex-[2_1_640px] scroll-mt-52 flex-col gap-[18px] min-[1100px]:scroll-mt-24 rounded-[2px] border border-line bg-white p-[18px]"
        >
          {selected ? (
            <CaseStory
              key={selected.incident_id}
              e={selected}
              clipUrl={clipFor(selected.incident_id)}
              camera={camById.get(selected.camera_id)}
              all={all}
              now={now}
              onSave={save}
              onOpen={(id) => openCase(id)}
            />
          ) : (
            <p className="text-[15px] text-ink-2">
              Pick an incident on the left to see what happened.
            </p>
          )}
        </section>
      </div>
    </PageShell>
  );
}

function TodoCard({
  n,
  title,
  body,
  emptyTitle,
  emptyBody,
  strong,
  blue,
  action,
  link,
}: {
  n: number;
  title: string;
  body: string;
  emptyTitle: string;
  emptyBody: string;
  strong?: boolean;
  blue?: boolean;
  action?: { label: string; onClick: () => void; primary?: boolean };
  link?: { label: string; href: string };
}) {
  const empty = n === 0;
  return (
    <div
      className="flex flex-col gap-2 rounded-[2px] bg-white px-4 py-3.5"
      style={{
        border: empty
          ? "1px solid #DCDFE4"
          : strong
            ? "2px solid #0B0D10"
            : blue
              ? "1px solid #A9B6F2"
              : "1px solid #DCDFE4",
      }}
    >
      <span className="flex items-baseline gap-2.5">
        <span
          className="ee-display text-[40px] leading-[0.9]"
          style={{ color: empty ? "#5D6672" : blue ? "#1F35B3" : "#0B0D10" }}
        >
          {n}
        </span>
        <span className="text-[18px] font-extrabold leading-tight">
          {empty ? emptyTitle : title}
        </span>
      </span>
      <span className="text-[15px] leading-[1.45] text-ink-2">
        {empty ? emptyBody : body}
      </span>
      {!empty && action && (
        <button
          type="button"
          onClick={action.onClick}
          className={cn(
            "inline-flex min-h-10 self-start items-center rounded-[2px] px-3.5 text-[14px] font-extrabold",
            action.primary
              ? "bg-ink text-white"
              : "border-2 border-ink bg-white text-ink",
          )}
        >
          {action.label}
        </button>
      )}
      {!empty && link && (
        <Link
          href={link.href}
          className="self-start text-[14px] font-extrabold text-signal"
        >
          {link.label}
        </Link>
      )}
    </div>
  );
}

function Stat({ v, k, sub }: { v: string; k: string; sub: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-[2px] border border-line bg-white px-3.5 py-3">
      <span className="ee-display text-[32px] leading-none">{v}</span>
      <span className="text-[15px] font-bold">{k}</span>
      <span className="text-[13px] leading-[1.4] text-muted-ink">{sub}</span>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "rounded-[1px] border px-[7px] py-px text-[12px] font-bold",
        STATUS_CHIP_STYLE[status] ?? STATUS_CHIP_STYLE.new,
      )}
    >
      {STATUS_WORDS[status] ?? "Needs a decision"}
    </span>
  );
}

function CaseStory({
  e,
  camera,
  clipUrl,
  all,
  now,
  onSave,
  onOpen,
}: {
  e: Event;
  camera?: Camera;
  /** This case's recording on this laptop (on site only), else null. */
  clipUrl: string | null;
  all: Event[];
  now: Date;
  onSave: (
    e: Event,
    p: { status?: Status; staff_note?: string },
    success?: string,
  ) => void;
  onOpen: (id: string) => void;
}) {
  const view = useAppStore((s) => s.view);
  const onsite = view === "onsite";
  const [clipFailed, setClipFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [note, setNote] = useState(e.staff_note ?? "");
  const [noteSaved, setNoteSaved] = useState(false);
  useEffect(() => setNote(e.staff_note ?? ""), [e.staff_note]);

  const bucket = bucketOf(e.status);
  const title = caseTitle(e);
  const building = buildingLine(camera);
  const reply = secondsBetween(e.pushed_at, e.acked_at);
  const firstName = useFirstName();
  const guard = e.pushed_to ? firstName(e.pushed_to) : null;
  const arrived = secondsBetween(e.acked_at ?? e.pushed_at, e.arrived_at);

  // How it unfolded: what the camera and the people really did, to the second, from the record.
  // The camera's own timeline (every level change with the model's score) when the edge sent it.
  const LV_WORD: Record<string, string> = { calm: "Calm again", tense: "Tense", fight_likely: "Fight likely", fight: "Fight" };
  const LV_DOT: Record<string, string> = { calm: "#E4F3EA", tense: "#F5B323", fight_likely: "#C8241B", fight: "#7F1310" };
  // With the recording and its start time, each camera row links to that second of the video.
  const clip0 = clipUrl && e.clip_start ? Date.parse(e.clip_start) : NaN;
  const timed: { at: number; t: string; text: string; dot: string; clip?: number }[] = [];
  const put = (iso: string | null | undefined, text: string, dot: string, seekable = false) => {
    if (!iso) return;
    const at = Date.parse(iso);
    const off = (at - clip0) / 1000;
    timed.push({ at, t: fmtTime(iso), text, dot, clip: seekable && off >= 0 ? off : undefined });
  };
  if (e.timeline?.length) {
    e.timeline.forEach((x, i) =>
      put(
        x.t,
        `${i === 0 ? "Camera: " : ""}${LV_WORD[x.level] ?? x.level} · score ${x.score.toFixed(2)} · ${x.people} ${x.people === 1 ? "person" : "people"} in view`,
        LV_DOT[x.level] ?? "#FFFFFF",
        true,
      ),
    );
  } else {
    put(e.start_time, "Incident opened. The camera's second-by-second record wasn't kept for this one.", "#FFFFFF");
  }
  const peakAt = (e.peak_snapshot as { t?: string } | undefined)?.t;
  if (peakAt && e.peak_score)
    put(peakAt, `Highest score ${e.peak_score.toFixed(2)}: the worst moment${Number.isNaN(clip0) ? ", shown here" : ""}`, "#7F1310", true);
  put(e.pushed_at, `Alarm: ${guard ?? "the guard on duty"}'s phone rang`, "#C8241B");
  if (reply != null) put(e.acked_at, `${guard ?? "The guard"} tapped "On my way" · ${reply} s after the alarm`, "#2742D9");
  if (e.arrived_at) put(e.arrived_at, `${guard ?? "The guard"} got there${arrived != null ? ` · ${arrived} s later` : ""}`, "#2742D9");
  if (e.outcome)
    put(
      e.outcome_at ?? e.arrived_at ?? e.acked_at,
      `${guard ?? "The guard"}: ${OUTCOME_WORDS[e.outcome]}${e.outcome === "nothing" ? " (a hint; the desk decides)" : ""}`,
      "#0B0D10",
    );
  const lasted = secondsBetween(e.start_time, e.end_time);
  if (e.end_time)
    put(
      e.end_time,
      `Incident closed${lasted != null ? ` · lasted ${lasted >= 60 ? `${Math.floor(lasted / 60)} min ${lasted % 60} s` : `${lasted} s`}` : ""}`,
      "#FFFFFF",
    );
  timed.sort((x, y) => x.at - y.at);
  const trail: { t: string; text: string; dot: string; clip?: number }[] = timed.map(({ t, text, dot, clip }) => ({ t, text, dot, clip }));
  // The recording opens on the first Fight moment (else 5 s in, where the edge's alarm sits).
  const firstFight = trail.find((x) => x.clip != null && /^(Camera: )?Fight/.test(x.text))?.clip;
  const openAt = Math.max(0, Math.floor(firstFight ?? 5));
  const seek = (sec: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = sec;
    void v.play().catch(() => {});
  };
  const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
  if (bucket === "real")
    trail.push({
      t: "",
      text: "The desk marked it as a real incident.",
      dot: "#0B0D10",
    });
  if (bucket === "false")
    trail.push({
      t: "",
      text: "The desk marked it as a false alarm.",
      dot: "#DCDFE4",
    });
  if (e.status === "resolved")
    trail.push({ t: "", text: "Follow-up done. Case closed.", dot: "#FFFFFF" });
  if (bucket === "decide")
    trail.push({
      t: "Now",
      text: "Waiting for the desk to decide.",
      dot: "#FFFFFF",
    });

  const steps =
    bucket === "decide"
      ? ["Decide first: was it real or a false alarm?"]
      : bucket === "false"
        ? ["Nothing to follow up."]
        : NEXT_STEPS[e.type];
  const done = e.status === "resolved";

  // Earlier at this place, last 4 weeks.
  const since = now.getTime() - WEEK4;
  const earlier = all.filter(
    (x) =>
      x.location === e.location &&
      x.incident_id !== e.incident_id &&
      Date.parse(x.start_time) >= since,
  );
  const pattern = repeatPlaces(all, now).find((p) => p.location === e.location);

  const frame = e.peak_snapshot ?? e.snapshot;
  const h3 = label;

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <span className="flex flex-wrap items-center gap-2">
          <LevelPill level={e.level} size="md" />
          <span className="text-[14px] text-ink-2">{LEVEL_NOTE[e.level]}</span>
        </span>
        <h2 className="ee-display text-[40px] leading-none">{title}</h2>
        <span className="text-[16px] text-ink-2">
          {dayLong(e.start_time)}, {hm(e.start_time)}
          {building ? ` · ${building}` : ""}
        </span>
      </div>

      {bucket === "decide" && (
        <div className="flex flex-col gap-2.5 rounded-[2px] border-2 border-ink px-4 py-3.5">
          <span className={h3}>NEEDS YOUR DECISION</span>
          <span className="text-[22px] font-extrabold">
            Was this a real incident?
          </span>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2">
            <button
              type="button"
              onClick={() =>
                onSave(e, { status: "confirmed" }, "Marked as a real incident.")
              }
              className="min-h-14 rounded-[2px] bg-ink text-[17px] font-extrabold text-white"
            >
              Yes, it was real
            </button>
            <button
              type="button"
              onClick={() =>
                onSave(e, { status: "dismissed" }, "Marked as a false alarm.")
              }
              className="min-h-14 rounded-[2px] border-2 border-ink bg-white text-[17px] font-extrabold text-ink"
            >
              No, false alarm
            </button>
          </div>
          <span className="text-[14px] text-ink-2">
            {onsite
              ? "Not sure? Watch the clip below first."
              : "Not sure? Ask the desk on site to watch the clip."}
          </span>
        </div>
      )}
      {e.status === "confirmed" && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-[2px] bg-ink px-4 py-3.5 text-white">
          <span className="flex flex-[1_1_260px] flex-col gap-0.5">
            <span className="text-[20px] font-extrabold">
              Real incident. Follow-up is open.
            </span>
            <span className="text-[14px] text-[#C9CED6]">
              Write what happened below, then close it when the follow-up is
              done.
            </span>
          </span>
          <button
            type="button"
            onClick={() => onSave(e, { status: "resolved" }, "Case closed.")}
            className="min-h-11 rounded-[2px] bg-white px-4 text-[15px] font-extrabold text-ink"
          >
            Mark as closed
          </button>
          <button
            type="button"
            onClick={() => onSave(e, { status: "new" })}
            className="min-h-11 rounded-[2px] border border-muted-ink px-3 text-[14px] font-bold text-white"
          >
            Undo
          </button>
        </div>
      )}
      {e.status === "resolved" && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-[2px] border border-line-strong px-4 py-3.5">
          <span className="flex flex-[1_1_260px] flex-col gap-0.5">
            <span className="text-[20px] font-extrabold">
              Real incident. Closed.
            </span>
            <span className="text-[14px] text-ink-2">Follow-up is done.</span>
          </span>
          <button
            type="button"
            onClick={() => onSave(e, { status: "confirmed" }, "Case reopened.")}
            className="min-h-11 rounded-[2px] border border-line-strong bg-white px-3.5 text-[14px] font-bold"
          >
            Reopen
          </button>
        </div>
      )}
      {bucket === "false" && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-[2px] border border-line bg-ground px-4 py-3.5">
          <span className="flex flex-[1_1_260px] flex-col gap-0.5">
            <span className="text-[20px] font-extrabold">
              False alarm. Nothing more to do.
            </span>
          </span>
          <button
            type="button"
            onClick={() => onSave(e, { status: "new" })}
            className="min-h-11 rounded-[2px] border border-line-strong bg-white px-3.5 text-[14px] font-bold"
          >
            Undo
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-start gap-[18px]">
        <div className="flex min-w-0 flex-[3_1_400px] flex-col gap-3.5">
          <div className="flex flex-col gap-1.5">
            <h3 className={h3}>WHAT EARLYEYE SAW</h3>
            <p className="m-0 text-[20px] font-medium leading-[1.4]">
              {e.reason}
            </p>
            {e.top_features?.length ? (
              <span className="flex flex-wrap gap-1.5" aria-label="What the model measured">
                {e.top_features.map((f) => (
                  <span key={f.name} className="rounded-[2px] border border-line px-2 py-1 font-mono text-[12px]">
                    {SIGNAL[f.name] ?? f.name.replace(/_/g, " ")}{" "}
                    <b>{f.value.toFixed(2)}{f.name === "max_wrist_speed" ? " TL/s" : ""}</b>
                  </span>
                ))}
                <span className="rounded-[2px] border border-line px-2 py-1 font-mono text-[12px]">
                  people <b>{e.people_count}</b>
                </span>
              </span>
            ) : null}
          </div>
          <figure className="m-0 flex flex-col gap-2">
            <div className="overflow-hidden rounded-[2px]">
              {clipUrl && !clipFailed ? (
                // The recording itself, paused on the alarm moment; play to watch.
                <video
                  ref={videoRef}
                  src={`${clipUrl}#t=${openAt}`}
                  controls
                  playsInline
                  preload="metadata"
                  aria-label={`Recording of ${title}`}
                  className="block aspect-video w-full bg-black"
                  onError={() => setClipFailed(true)}
                />
              ) : (
                <SkeletonView
                  frame={frame}
                  level={e.level}
                  label={
                    e.level === "fight_likely"
                      ? "FIGHT LIKELY"
                      : e.level.toUpperCase()
                  }
                  showBox={!!frame}
                  background={onsite ? "onsite" : "remote"}
                  hud={{ topLeft: "The worst moment" }}
                  idleText={frame ? undefined : "No picture saved"}
                  ariaLabel={`Stick figures of the people ${placePhrase(e.location)} at the worst moment`}
                />
              )}
            </div>
            <figcaption className="flex flex-wrap items-center gap-2.5">
              {clipUrl && !clipFailed ? (
                <span className="font-mono text-[11px] font-bold text-muted-ink">RECORDING · STAYS ON THIS COMPUTER</span>
              ) : onsite ? (
                <span className="font-mono text-[11px] font-bold text-muted-ink">NO RECORDING OF THIS ONE · STICK FIGURES</span>
              ) : (
                <span className="font-mono text-[11px] font-bold text-muted-ink">STICK FIGURES · NO VIDEO OFF SITE</span>
              )}
            </figcaption>
          </figure>
        </div>

        <div className="flex min-w-0 flex-[2_1_280px] flex-col gap-2">
          <h3 className={h3}>HOW IT UNFOLDED</h3>
          <ol className="m-0 flex list-none flex-col p-0">
            {trail.map((a, i) => (
              <li
                key={i}
                className="grid grid-cols-[72px_14px_minmax(0,1fr)] items-start gap-2.5 border-b border-ground py-2"
              >
                <span className="font-mono text-[14px] text-ink-2">{a.t}</span>
                <span
                  className="mt-[5px] size-2.5 rounded-full border border-ink"
                  style={{ background: a.dot }}
                  aria-hidden
                />
                <span className="flex flex-col items-start gap-1 text-[15px] leading-[1.45]">
                  {a.text}
                  {a.clip != null && clipUrl && !clipFailed ? (
                    <button
                      type="button"
                      onClick={() => seek(a.clip!)}
                      className="font-mono text-[12px] font-bold text-ink underline underline-offset-2"
                    >
                      ▶ {mmss(a.clip)} in the recording
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-[18px]">
        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-2.5">
          <h3 className={h3}>{done ? "WHAT WAS DONE" : "WHAT TO DO NEXT"}</h3>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {steps.map((t) => (
              <li
                key={t}
                className="grid grid-cols-[18px_minmax(0,1fr)] items-start gap-2 text-[15px] leading-[1.45]"
              >
                <span
                  className="mt-[5px] size-3 rounded-[1px] border-2 border-ink"
                  style={{ background: done ? "#0B0D10" : "#FFFFFF" }}
                  aria-hidden
                />
                <span>{t}</span>
              </li>
            ))}
          </ul>
          <Link
            href={`/reports?period=daily&date=${dayKey(e.start_time)}`}
            className="min-h-11 self-start rounded-[2px] border-2 border-ink bg-white px-4 py-2.5 text-[15px] font-extrabold text-ink no-underline"
          >
            Report for this day (PDF)
          </Link>
        </div>

        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-2.5">
          <label className="flex flex-col gap-1.5">
            <span className={h3}>WHAT HAPPENED, IN YOUR WORDS</span>
            <textarea
              value={note}
              onChange={(ev) => {
                setNote(ev.target.value);
                setNoteSaved(false);
              }}
              onBlur={() => {
                if (note !== (e.staff_note ?? "")) {
                  onSave(e, { status: e.status, staff_note: note });
                  setNoteSaved(true);
                }
              }}
              rows={3}
              placeholder="For example: two students separated and sent to Student Affairs"
              className="resize-y rounded-[2px] border border-line-strong bg-white px-3 py-2.5 text-[16px] leading-[1.45] text-ink"
            />
          </label>
          <span className="text-[13px] text-muted-ink">
            {noteSaved
              ? "Saved with the case. "
              : "Saved with the case when you click away. "}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-line pt-3.5">
        <h3 className={h3}>EARLIER AT THIS PLACE</h3>
        {pattern && (
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 rounded-[2px] border border-[#A9B6F2] bg-signal-tint px-3 py-2.5">
            <span className="flex-[1_1_260px] text-[15px] font-bold text-signal-ink">
              This keeps happening here: {pattern.count} real incidents in 4
              weeks, all between {pattern.hours}.
            </span>
            <Link
              href="/plan"
              className="text-[14px] font-extrabold text-signal"
            >
              See the patrol plan
            </Link>
          </div>
        )}
        {!earlier.length && (
          <span className="text-[15px] text-ink-2">
            Nothing else here in the last 4 weeks.
          </span>
        )}
        <div className="flex flex-col gap-1">
          {earlier.slice(0, 4).map((x) => (
            <button
              key={x.incident_id}
              type="button"
              onClick={() => onOpen(x.incident_id)}
              className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[2px] border border-line bg-white px-2.5 py-1.5 text-left text-[14px] text-ink"
            >
              <span className="font-mono text-ink-2">
                {dayShort(x.start_time)} · {hm(x.start_time)}
              </span>
              <span className="font-bold">{TYPE_WORDS[x.type]}</span>
              <span className="text-muted-ink">{STATUS_WORDS[x.status]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-line pt-3 text-[13px] text-muted-ink">
        <span>Reference {e.incident_id}</span>
        <span>{cameraName(camera, e.location)}</span>
        <Link
          href={`/cameras?cam=${encodeURIComponent(e.camera_id)}`}
          className="font-bold text-signal"
        >
          See it on the campus map
        </Link>
        <Link href="/proof" className="font-bold text-signal">
          How EarlyEye decides
        </Link>
      </div>
    </>
  );
}

"use client";

// Plan: standing guard posts (handoff design/canvas/L3Plan.dc.html, brief §6.4).
// Posts stay until the supervisor ends them. The daily 06:00 check only suggests.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { createSlot, getCameras, getEvents, getPatrolPlan, getSite, patchSlot, type SavedWhere } from "@/lib/api";
import { cameraKind } from "@/lib/camera-meta";
import {
  activePosts,
  dateOnly,
  dayDate,
  daysLabel,
  floorOf,
  hh,
  hm,
  myt,
  QUIET_DAYS,
  WINDOW_DAYS,
  nextPost,
  postIncidents,
  postOnNow,
  slotKey,
  startHour,
  team,
} from "@/lib/posts";
import type { GeoPoint, PatrolSlot, SlotPatch } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PageShell } from "@/components/chrome/page-shell";
import { HowItWorks } from "@/components/chrome/how-it-works";
import { Campus3D } from "@/components/campus3d";
import type { PostView } from "@/components/campus3d/types";
import { PostMap } from "./post-map";
import { PostDrawer, type PostDraft } from "./post-drawer";
import { PostRow, type RosterPost, TeamStrip } from "./post-roster";
import { PostStats } from "./post-stats";
import { PostTimetable } from "./post-timetable";

const DAY_MS = 86_400_000;
const SEED_URL = "/campus/campus-3d-seed.json";
const ASSUMPTION = "60% of hotspot incidents are avoided when a person is present. Stated, not measured.";

type Seed = { patrol_posts?: { location: string; geo: { lat: number; lng: number } }[] };
const fetchJson = <T,>(u: string) => fetch(u).then((r) => r.json() as Promise<T>);

function useNow(ms = 30_000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}


/** The place as the data names it. */
const placePhrase = (s: PatrolSlot) => s.location;

const ICON = {
  pin: "M12 21s-6-5.33-6-11a6 6 0 0 1 12 0c0 5.67-6 11-6 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2",
  person: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  bulb: "M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z",
};

function SectionHead({ n, title, children }: { n: number; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span className="inline-flex size-[34px] flex-none items-center justify-center rounded-full bg-ink text-[17px] font-extrabold text-white">{n}</span>
      <h2 className="ee-display text-[30px] leading-none">{title}</h2>
      {children}
    </div>
  );
}

export function PlanScreen() {
  const { data: plan } = useSWR("plan", getPatrolPlan, { refreshInterval: 2000 });
  const { data: site } = useSWR("site", getSite, { revalidateOnFocus: false });
  const { data: cameras } = useSWR("cameras", getCameras, { refreshInterval: 30_000 });
  const { data: events } = useSWR(["events", "full"], () => getEvents(), { refreshInterval: 10_000 });
  const { data: seed } = useSWR(SEED_URL, fetchJson<Seed>, { revalidateOnFocus: false });
  const { mutate } = useSWRConfig();
  const router = useRouter();
  const now = useNow();
  const [view, setView] = useState<"2d" | "3d">("2d");
  const [selected, setSelected] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedWhere | null>(null);
  const [kept, setKept] = useState<string[]>([]);
  const [drawer, setDrawer] = useState<{ open: boolean; slot: PatrolSlot | null }>({ open: false, slot: null });
  // The map can hand a point to "+ Add a post" (onPickPoint): call pickPoint(geo).
  const [pickedPoint, setPickedPoint] = useState<GeoPoint | null>(null);
  const pickPoint = (g: GeoPoint) => {
    setPickedPoint(g);
    setDrawer({ open: true, slot: null });
  };
  void pickPoint;

  const people = useMemo(() => team(site?.staff), [site]);
  const slots = useMemo(() => plan?.slots ?? [], [plan]);
  const active = useMemo(() => activePosts(slots), [slots]);
  const roster: RosterPost[] = active.map((slot, i) => ({ slot, rank: i + 1 }));
  const suggested = slots.filter((s) => s.status === "suggested");
  const toEnd = active.filter((s) => s.suggestion === "end" && !kept.includes(slotKey(s)));
  const checkAt = plan?.last_check ? Date.parse(plan.last_check) : plan ? Date.parse(plan.generated_at) : 0;

  const write = async (id: string | undefined, patch: SlotPatch, done: string) => {
    if (!id) return;
    setBusy(true);
    try {
      const r = await patchSlot(id, patch);
      setSaved(r.saved);
      setNote(done);
      await mutate("plan");
    } catch {
      setNote("Couldn't save that. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = async (d: PostDraft): Promise<boolean> => {
    const g = people.find((x) => x.id === d.assigned_to);
    try {
      if (drawer.slot?.id) {
        const r = await patchSlot(drawer.slot.id, d);
        setSaved(r.saved);
        const rank = roster.find((x) => x.slot.id === drawer.slot?.id)?.rank;
        setNote(`Post ${rank ?? ""} changed: ${d.location}, ${daysLabel(d.days, " and ")} ${d.hours}.${d.assigned_to ? ` ${g?.name ?? d.assigned_to}'s app shows the change.` : ""}`);
      } else {
        const r = await createSlot({ ...d, source: "manual" });
        setSaved(r.saved);
        setNote(`Added by you: ${d.location}, ${daysLabel(d.days, " and ")} ${d.hours}${d.assigned_to ? `, sent to ${g?.name ?? d.assigned_to}'s app` : ". Pick who goes"}.`);
      }
      await mutate("plan");
      return true;
    } catch {
      return false;
    }
  };

  const geoFor = (s: PatrolSlot) =>
    s.geo ??
    seed?.patrol_posts?.find((p) => p.location === s.location)?.geo ??
    cameras?.find((c) => c.location === s.location)?.geo ??
    null;
  const posts3d: PostView[] = [...roster, ...suggested.map((slot) => ({ slot, rank: active.length + 1 }))].flatMap(({ slot, rank }) => {
    const geo = geoFor(slot);
    if (!geo || !slot.id) return [];
    const g = people.find((p) => p.id === slot.assigned_to);
    const pending = slot.status === "suggested";
    return [{
      id: slot.id,
      rank,
      status: pending ? "suggested" : "active",
      place: slot.location,
      daysLabel: daysLabel(slot.days),
      hours: slot.hours,
      since: pending ? "new today" : slot.since ?? undefined,
      geo: { lat: geo.lat, lng: geo.lng },
      floor: floorOf(slot.location),
      incidents28d: events && checkAt ? postIncidents(events, slot, checkAt).hits.length : slot.incidents_4w,
      guard: g ? { first: g.first, name: g.name, call_sign: g.id, photo_url: g.photo_url ?? undefined } : null,
      onNow: now != null && !pending && postOnNow(slot, now),
    } satisfies PostView];
  });

  const select = (id: string) => {
    setSelected((cur) => (cur === id ? undefined : id));
    if (view === "2d") document.getElementById(`post-${id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  if (!plan || !site || now == null) {
    return (
      <PageShell>
        <h1 className="ee-display text-[58px] leading-[0.95]">Guard posts</h1>
        <p className="text-[17px] text-ink-2" aria-busy="true">Loading the guard posts…</p>
      </PageShell>
    );
  }

  const n = myt(now);
  const checkedToday = myt(checkAt).key === n.key;
  const checkedYesterday = myt(checkAt).key === myt(now - DAY_MS).key;
  const nextCheck = n.hour < 6 ? "today at 06:00" : "tomorrow at 06:00";
  const next = nextPost(active, now);
  const nextWho = next ? people.find((p) => p.id === next.slot.assigned_to)?.name ?? "nobody yet" : "";
  const covered = active.filter((s) => s.assigned_to).length;
  const first = suggested[0];
  const black = (cameras ?? []).filter((c) => cameraKind(c) === "black");

  const tiles = [
    { icon: ICON.pin, v: `${active.length} post${active.length === 1 ? "" : "s"}`, k: "running now", sub: "" },
    { icon: ICON.clock, v: next ? `${next.day} ${hh(startHour(next.slot.hours))}` : "None", k: "next post starts", sub: next ? `${next.slot.location} · ${nextWho}` : "No posts in the next 7 days" },
    { icon: ICON.person, v: `${covered} of ${active.length}`, k: "posts have a guard", sub: covered < active.length ? `${active.length - covered} still need${active.length - covered === 1 ? "s" : ""} someone` : "Every post is covered" },
    { icon: ICON.bulb, v: `${suggested.length + toEnd.length} suggestion${suggested.length + toEnd.length === 1 ? "" : "s"}`, k: "to review", sub: first ? `A new post at ${placePhrase(first)}` : toEnd.length ? `End post ${roster.find((r) => r.slot === toEnd[0])?.rank}?` : "" },
  ];

  return (
    <PageShell>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5">
        <h1 className="ee-display text-[48px] leading-[0.95] sm:text-[58px]">Guard posts</h1>
        <span className="font-mono text-[13px] text-muted-ink">
          Updated {checkedToday ? "today" : checkedYesterday ? "yesterday" : dayDate(checkAt)} {hm(checkAt)}
        </span>
        <HowItWorks>
          <span>When a place keeps having trouble at the same hour, it gets a standing guard post. Every morning EarlyEye rechecks the last {WINDOW_DAYS} days ({dateOnly(checkAt - (WINDOW_DAYS - 1) * DAY_MS)} to {dateOnly(checkAt)}) and suggests changes; nothing changes until you accept it. Next check {nextCheck}.</span>
          <span>Pick a guard and the post goes straight to the EarlyEye app on their phone. You see when they&rsquo;ve read it.</span>
          <span>A suggested post is the dashed &ldquo;+&rdquo; on the map. A post quiet for {QUIET_DAYS} days is suggested for ending, never ended on its own.</span>
        </HowItWorks>
      </div>

      <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr))]">
        {tiles.map((t) => (
          <div key={t.k} className="flex min-w-0 items-center gap-3.5 rounded-[2px] border border-line bg-white px-4 py-3.5">
            <span className="inline-flex size-12 flex-none items-center justify-center rounded-full bg-signal-tint">
              <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><path d={t.icon} fill="none" stroke="#1F35B3" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="ee-display text-[32px] leading-none">{t.v}</span>
              <span className="text-[15px] font-bold">{t.k}</span>
              {t.sub && <span className="truncate text-[13px] text-muted-ink">{t.sub}</span>}
            </span>
          </div>
        ))}
      </div>

      {first && (
        <section aria-label="Suggestion" className="flex flex-wrap items-center gap-x-[18px] gap-y-2.5 rounded-[2px] border-2 border-signal bg-signal-tint px-4 py-3.5">
          <span className="flex min-w-0 flex-[1_1_320px] flex-col gap-1">
            <span className="text-[20px] font-extrabold">
              Add a post at {placePhrase(first)}, {daysLabel(first.days, " and ")}, {first.hours}
            </span>
            {first.evidence?.length ? (
              <span className="text-[15px] text-ink-2">
                {first.evidence.length} incidents at that hour in {WINDOW_DAYS} days: {first.evidence.map(dateOnly).join(", ")}
              </span>
            ) : null}
          </span>
          <span className="flex min-w-0 flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => write(first.id, { status: "active" }, `Post ${active.length + 1} added: ${placePhrase(first)}, ${daysLabel(first.days, " and ")} ${first.hours}. Pick who goes below.`)} className="min-h-[46px] rounded-[2px] bg-signal px-[18px] text-[16px] font-extrabold text-white">
              Add this post
            </button>
            <button type="button" disabled={busy} onClick={() => write(first.id, { status: "ended" }, "Not now. EarlyEye will only suggest it again if trouble keeps happening there.")} className="min-h-[46px] rounded-[2px] border border-signal bg-white px-4 text-[15px] font-extrabold text-signal-ink">
              Not now
            </button>
          </span>
        </section>
      )}
      {toEnd.map((s) => {
        const rank = roster.find((r) => r.slot === s)?.rank;
        return (
          <section key={slotKey(s)} aria-label="Suggestion" className="flex flex-wrap items-center gap-x-[18px] gap-y-2.5 rounded-[2px] border-2 border-signal bg-signal-tint px-4 py-3.5">
            <span className="flex min-w-0 flex-[1_1_320px] flex-col gap-1">
              <span className="text-[20px] font-extrabold">End post {rank} at {s.location}</span>
              <span className="text-[15px] text-ink-2">No real incidents at {s.hours} in {QUIET_DAYS} days</span>
            </span>
            <span className="flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => write(s.id, { status: "ended" }, `Post ${rank} ended. EarlyEye will suggest it again if trouble comes back.`)} className="min-h-[46px] rounded-[2px] bg-signal px-[18px] text-[16px] font-extrabold text-white">End this post</button>
              <button type="button" onClick={() => setKept([...kept, slotKey(s)])} className="min-h-[46px] rounded-[2px] border border-signal bg-white px-4 text-[15px] font-extrabold text-signal-ink">Keep it</button>
            </span>
          </section>
        );
      })}
      {note && (
        <div role="status" className="flex flex-wrap items-baseline gap-x-3 rounded-[2px] border border-line bg-white px-3.5 py-2.5 text-[15px] font-bold">
          <span>{note}</span>
          {saved === "this-computer" && !note.startsWith("Couldn") && (
            <span className="rounded-[1px] border border-dashed border-line-strong px-1.5 font-mono text-[11px] font-bold text-muted-ink">Saved on this computer</span>
          )}
        </div>
      )}

      <div className="grid items-stretch gap-4 min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(0,1.12fr)]">
        <section aria-label="Where" className="flex min-w-0 flex-[1_1_500px] flex-col gap-3 rounded-[2px] border border-line bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <SectionHead n={1} title="Where are the posts?" />
            <div role="group" aria-label="Map type" className="inline-flex overflow-hidden rounded-[2px] border border-line-strong">
              {(["2d", "3d"] as const).map((v) => (
                <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={cn("min-h-9 px-3.5 text-[14px] font-bold", v === "3d" && "border-l border-line-strong", view === v ? "bg-ink text-white" : "bg-white")}>
                  {v === "2d" ? "Map" : "3D"}
                </button>
              ))}
            </div>
          </div>
          {view === "2d" ? (
            <>
              <PostMap url={site.campus?.buildings ?? "/campus/taylors-lakeside-campus.geojson"} posts={posts3d} selectedId={selected} onSelect={select} />
              <div className="flex flex-wrap items-center gap-x-[18px] gap-y-2 text-[14px] text-ink-2">
                <span className="inline-flex items-center gap-1.5"><span className="inline-flex size-[22px] items-center justify-center rounded-full bg-signal text-[12px] font-extrabold text-white">1</span>Guard post</span>
                <span className="inline-flex items-center gap-1.5"><span className="inline-block size-[26px] rounded-full border-2 border-signal bg-[rgba(39,66,217,0.16)]" />Bigger = more incidents in 28 days</span>
                <span className="inline-flex items-center gap-1.5"><span className="inline-block h-4 w-[26px] rounded-lg border-[1.5px] border-dashed border-signal" />Dashed = nobody yet, or suggested</span>
              </div>
            </>
          ) : cameras ? (
            <Campus3D
              mode="plan"
              cameras={cameras}
              site={site}
              events={events ?? []}
              plan={plan}
              posts={posts3d}
              selectedPostId={selected}
              onSelectPost={select}
              height={620}
              onOpenCamera={(id) => router.push(`/cameras?cam=${encodeURIComponent(id)}`)}
            />
          ) : (
            <div className="h-[620px] rounded-[2px] border border-line bg-raised" aria-busy="true" />
          )}
        </section>

        <section aria-label="Who" className="flex min-w-0 flex-[1_1_560px] flex-col gap-3 rounded-[2px] border border-line bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <SectionHead n={2} title="Who is going?" />
            <button type="button" onClick={() => setDrawer({ open: true, slot: null })} className="min-h-11 rounded-[2px] bg-ink px-4 text-[15px] font-extrabold text-white">
              + Add a post
            </button>
          </div>
          <TeamStrip people={people} now={now} />
          {roster.length === 0 && <p className="text-[15px]">No standing posts. Accept a suggestion to start one.</p>}
          {roster.map((p) => (
            <PostRow
              key={slotKey(p.slot)}
              post={p}
              people={people}
              allActive={active}
              selected={selected === p.slot.id}
              onSelect={() => p.slot.id && select(p.slot.id)}
              busy={busy}
              onAssign={(who) => {
                const g = people.find((x) => x.id === who);
                write(p.slot.id, { assigned_to: who }, who ? `Post ${p.rank} sent to ${g?.name ?? who}'s app.` : `Post ${p.rank} taken off the app. Nobody is going.`);
              }}
              onEnd={() => write(p.slot.id, { status: "ended" }, `Post ${p.rank} ended. EarlyEye will suggest it again if trouble comes back.`)}
              onEdit={() => setDrawer({ open: true, slot: p.slot })}
            />
          ))}
          {black.map((c) => {
            const post = roster.find((r) => r.slot.zone_type === c.zone_type);
            const days = c.black_since ? Math.max(1, Math.round((now - Date.parse(c.black_since)) / DAY_MS)) : null;
            return (
              <div key={c.camera_id} className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[2px] bg-ink px-3.5 py-2.5 text-white">
                <span className="min-w-0 flex-[1_1_220px] text-[14px] leading-snug">
                  {c.location}: camera off{days ? ` ${days} day${days === 1 ? "" : "s"}` : ""}
                  {post ? ` · post ${post.rank} is the only eye there` : ""}
                </span>
                <Link href={`/cameras?cam=${encodeURIComponent(c.camera_id)}`} className="text-[14px] font-extrabold text-white">Report the repair</Link>
              </div>
            );
          })}
        </section>
      </div>

      <section aria-label="When" className="flex flex-col gap-3 rounded-[2px] border border-line bg-white p-4">
        <SectionHead n={3} title="When: the next 7 days" />
        <PostTimetable posts={roster} people={people} now={now} />
      </section>

      <PostStats posts={roster} events={events ?? []} end={checkAt} assumption={plan.assumption || ASSUMPTION} />

      <PostDrawer
        open={drawer.open}
        onOpenChange={(o) => {
          setDrawer((d) => ({ ...d, open: o }));
          if (!o) setPickedPoint(null);
        }}
        slot={drawer.slot}
        cameras={cameras ?? []}
        buildingsUrl={site.campus?.buildings ?? "/campus/taylors-lakeside-campus.geojson"}
        people={people}
        allActive={active}
        pickedPoint={pickedPoint}
        onSave={saveDraft}
      />
    </PageShell>
  );
}

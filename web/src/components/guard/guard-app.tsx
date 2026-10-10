"use client";

// EarlyEye for guards: the installable phone app (handoff GuardPhone.dc.html, brief §6.6).
// One person per phone. Polls every 2 s for alerts pushed to them and for their posts.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import {
  getCameras,
  getEvents,
  getPatrolPlan,
  getSite,
  mergeEvents,
  patchEvent,
  patchSlot,
  postCheckin,
  setOnDuty,
} from "@/lib/api";
import { LEVEL_LABEL, LEVEL_THEME, normaliseStatus } from "@/lib/format";
import { fmtDistance, staffDistance } from "@/lib/geo";
import {
  activePosts,
  dayDate,
  daysLabel,
  DAY_SHORT,
  hh,
  hm,
  myt,
  onShift,
  type Person,
  postOnNow,
  rollingWeek,
  slotDays,
  slotSpan,
  startHour,
  team,
} from "@/lib/posts";
import type { Event, Level, Outcome, PatrolSlot } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/plan/avatar";
import { useGuardDevice } from "./use-guard-device";

const ME_KEY = "ee-guard-staff";
const SHIFT_KEY = "ee-guard-on-shift";
const HANDLED_KEY = "ee-guard-handled";
const FRESH_MS = 15 * 60_000;
const OUTCOMES: { id: Outcome; label: string }[] = [
  { id: "sorted", label: "Sorted, nobody hurt" },
  { id: "hurt", label: "Sorted, someone hurt" },
  { id: "backup", label: "Need backup" },
  { id: "nothing", label: "Nothing there" },
];
const NOTES = ["Separated them", "Sent to Student Affairs", "Called the clinic"];
const GLYPH: Record<Level, string> = {
  calm: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
  tense: "M12 3 22 20H2z",
  fight_likely: "M12 2 22 12 12 22 2 12z",
  fight: "M8 2h8l6 6v8l-6 6H8l-6-6V8z",
};

type Tab = "today" | "schedule" | "alerts" | "me";
type Flow = { kind: "alert" | "enroute" | "found" | "done"; event: Event; test?: boolean; outcome?: Outcome; outcomeAt?: string; note?: string[] };

const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string | null) => {
    try {
      if (v == null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      // private mode: this session only
    }
  },
};
/** One alarm per push: a new pushed_at on the same incident (a re-push) rings again. */
const pushKey = (e: Event) => `${e.incident_id}|${e.pushed_at ?? ""}`;
const secs = (a?: string | null, b?: string | null) => (a && b ? Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / 1000)) : null);

function LevelChip({ level, big }: { level: Level; big?: boolean }) {
  const t = LEVEL_THEME[level];
  return (
    <span className={cn("inline-flex items-center gap-1.5 self-start rounded-[2px] font-extrabold uppercase", big ? "px-3 py-1 text-[16px]" : "px-2 py-0.5 text-[12px]")} style={{ background: t.pillBg, color: t.pillFg, border: `1px solid ${t.pillBorder}` }}>
      <svg width={big ? 18 : 10} height={big ? 18 : 10} viewBox="0 0 24 24" aria-hidden="true"><path d={GLYPH[level]} fill="currentColor" /></svg>
      {LEVEL_LABEL[level]}
    </span>
  );
}

const TAB_ICON: Record<Tab, string> = {
  today: "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  schedule: "M4 5h16v16H4zM4 9h16M9 3v4M15 3v4",
  alerts: "M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4",
  me: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
};

export function GuardApp() {
  const params = useSearchParams();
  const { mutate } = useSWRConfig();
  const dev = useGuardDevice();
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<string | null>(null);
  const [shift, setShift] = useState(false);
  const [tab, setTab] = useState<Tab>("today");
  const [flow, setFlow] = useState<Flow | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [notice, setNotice] = useState<string | null>(null);
  const handled = useRef(new Set<string>());

  // Who is this phone? ?staff= (the old /push link) wins and is remembered.
  useEffect(() => {
    const fromLink = params.get("staff");
    const saved = fromLink || store.get(ME_KEY);
    if (fromLink) store.set(ME_KEY, fromLink);
    setMe(saved);
    setShift(!!saved && store.get(SHIFT_KEY) === saved);
    try {
      for (const id of JSON.parse(sessionStorage.getItem(HANDLED_KEY) ?? "[]")) handled.current.add(id);
    } catch {
      // nothing handled yet
    }
    setReady(true);
  }, [params]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const { data: site } = useSWR("site", getSite, { refreshInterval: 30_000 });
  const { data: cameras } = useSWR("cameras", getCameras, { refreshInterval: 30_000 });
  const { data: plan } = useSWR(me ? "plan" : null, getPatrolPlan, { refreshInterval: 2000 });
  const recent = useSWR(me && shift ? ["guard-events", "since"] : null, () => getEvents(new Date(Date.now() - 30 * 60_000).toISOString()), { refreshInterval: 2000 });
  const full = useSWR(me ? ["guard-events", "full"] : null, () => getEvents(), { refreshInterval: shift ? 4000 : 15_000 });
  const events = useMemo(
    () => mergeEvents(full.data ?? [], recent.data ?? []).map((e) => ({ ...e, status: normaliseStatus(e.status) })),
    [full.data, recent.data],
  );

  const people = useMemo(() => team(site?.staff), [site]);
  const person: Person | null = people.find((p) => p.id === me) ?? null;
  const posts = useMemo(() => activePosts(plan?.slots ?? []), [plan]);
  const mine = posts.filter((s) => s.assigned_to === me);

  const markHandled = (key: string) => {
    handled.current.add(key);
    try {
      sessionStorage.setItem(HANDLED_KEY, JSON.stringify([...handled.current]));
    } catch {
      // fine
    }
  };

  const raise = useCallback(
    (e: Event, test = false) => {
      markHandled(pushKey(e));
      setFlow({ kind: "alert", event: e, test });
      dev.ring();
    },
    [dev],
  );

  // An alert pushed to me, not yet answered.
  useEffect(() => {
    if (!me || !shift || flow) return;
    const t = Date.now();
    const waiting = events
      .filter(
        (e) =>
          (e.pushed_to === me || (!e.pushed_to && e.nearest_staff === me && e.status === "pushed")) &&
          e.status === "pushed" &&
          !e.acked_at &&
          e.end_time == null &&
          t - Date.parse(e.pushed_at ?? e.start_time) < FRESH_MS &&
          !handled.current.has(pushKey(e)),
      )
      .sort((a, b) => Date.parse(b.pushed_at ?? b.start_time) - Date.parse(a.pushed_at ?? a.start_time));
    // Ring for the newest only. Older unanswered pushes and scenes already calm are history.
    for (const e of waiting.slice(1)) markHandled(pushKey(e));
    const next = waiting[0];
    if (next && next.level === "calm") markHandled(pushKey(next));
    else if (next) raise(next);
  }, [events, me, shift, flow, raise]);

  // Same browser as the desk (demo): the Live tab announces its pushes.
  useEffect(() => {
    if (!me || !shift || typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel("earlyeye-push");
    ch.onmessage = (m: MessageEvent<{ type: string; event: Event }>) => {
      const e = m.data?.event;
      if (m.data?.type !== "push" || !e || e.pushed_to !== me || handled.current.has(pushKey(e)) || flow) return;
      raise(e);
    };
    return () => ch.close();
  }, [me, shift, flow, raise]);

  const live = flow ? events.find((e) => e.incident_id === flow.event.incident_id) ?? flow.event : null;
  const write = async (patch: Parameters<typeof patchEvent>[1]) => {
    if (!flow || flow.test) return;
    try {
      await patchEvent(flow.event.incident_id, patch);
      void mutate(["guard-events", "since"]);
    } catch {
      setNotice("Saved on this phone only. The desk did not get the tap; tell them by radio.");
    }
  };

  const pick = (id: string) => {
    store.set(ME_KEY, id);
    store.set(SHIFT_KEY, null);
    setMe(id);
    setShift(false);
    setTab("today");
  };
  const startShift = async () => {
    await dev.unlock();
    dev.keepAwake(true);
    store.set(SHIFT_KEY, me);
    setShift(true);
    setTab("today");
    if (me) void setOnDuty(me, true);
  };
  const endShift = () => {
    dev.keepAwake(false);
    store.set(SHIFT_KEY, null);
    setShift(false);
    if (me) void setOnDuty(me, false);
  };

  if (!ready) return <Frame />;

  // ── First time: who is using this phone? ──
  if (!me || (site && !person)) {
    return (
      <Frame>
        <div className="flex flex-col gap-3 px-[18px] py-[18px]">
          <span className="ee-display text-[22px] tracking-[0.04em]">EARLYEYE</span>
          <h1 className="ee-display text-[40px] leading-[0.95]">Who is using this phone?</h1>
          <span className="text-[15px] text-ink-2">{site?.name ?? "Your site"} security team</span>
          {!site && <span className="text-[15px] text-muted-ink">Loading the team…</span>}
          {people.map((p) => (
            <button key={p.id} type="button" onClick={() => pick(p.id)} className={cn("flex min-h-[72px] items-center gap-3 rounded-[4px] bg-white py-2 pr-3.5 pl-2.5 text-left", p.id === me ? "border-2 border-ink" : "border border-line")}>
              <Avatar person={p} size={52} />
              <span className="flex flex-col gap-0.5">
                <span className="text-[18px] font-extrabold">{p.name}</span>
                <span className="text-[13px] text-muted-ink">{p.id} · {p.shiftLabel}</span>
              </span>
            </button>
          ))}
          <span className="text-[13px] text-muted-ink">Name missing? Ask your supervisor to add you.</span>
        </div>
      </Frame>
    );
  }
  if (!person) return <Frame />;

  // ── Alarm, over any tab ──
  if (flow?.kind === "alert" && live) {
    // The level that rang the alarm, or worse if it has grown since.
    const LV: Level[] = ["calm", "tense", "fight_likely", "fight"];
    const alarmLevel = LV[Math.max(LV.indexOf(flow.event.level), LV.indexOf(live.level), 2)];
    const cam = cameras?.find((c) => c.camera_id === live.camera_id);
    const dist = fmtDistance(staffDistance(site, me, cam));
    const spot = cam?.geo?.floor ?? cam?.geo?.building;
    return (
      <Frame alarm>
        <div role="alert" className="flex flex-1 flex-col gap-3.5 px-[18px] pt-4 pb-[22px] text-white">
          {flow.test && <span className="self-start rounded-[2px] bg-white px-2 py-0.5 font-mono text-[12px] font-bold text-[#C8241B]">TEST · NOT SENT TO THE DESK</span>}
          <span className="text-[15px] font-extrabold">{person.first}, you&rsquo;re the nearest guard</span>
          <span className="inline-flex items-center gap-2 self-start rounded-[2px] bg-white py-1 pr-3 pl-2 text-[16px] font-extrabold text-[#C8241B] uppercase">
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d={GLYPH[alarmLevel]} fill="#C8241B" /></svg>
            {LEVEL_LABEL[alarmLevel]}
          </span>
          <span className="ee-display text-[52px] leading-[0.92]">{live.location}</span>
          {(spot || dist) && <span className="text-[20px] font-extrabold">{[spot && spot[0].toUpperCase() + spot.slice(1), dist && `about ${dist.replace("~", "")} from you`].filter(Boolean).join(" · ")}</span>}
          <span className="text-[18px] leading-[1.45]">{live.reason}</span>
          <span className="text-[15px] opacity-90">The desk sees it too. {dev.soundOn ? "Alarm sounding." : "Sound is off: turn the volume up."}</span>
          <button
            type="button"
            onClick={() => {
              dev.silence();
              setFlow({ ...flow, kind: "enroute" });
              void write({ acked_at: new Date().toISOString() });
            }}
            className="mt-auto min-h-24 rounded-[4px] bg-white text-[28px] font-extrabold text-ink"
          >
            On my way
          </button>
        </div>
      </Frame>
    );
  }

  const header = <Header person={person} shift={shift} now={now} />;

  if (flow && live && flow.kind === "enroute") {
    const cam = cameras?.find((c) => c.camera_id === live.camera_id);
    const dist = fmtDistance(staffDistance(site, me, cam));
    const calm = live.level === "calm" || live.end_time != null;
    return (
      <Frame header={header}>
        <div className="flex flex-1 flex-col gap-3 px-4 pt-4 pb-[22px]">
          <span className="font-mono text-[12px] font-bold tracking-[0.06em] text-muted-ink">ON THE WAY{flow.test ? " · TEST" : ""}</span>
          <span className="ee-display text-[40px] leading-[0.95]">{live.location}</span>
          {cam?.geo?.floor && <span className="text-[18px] font-bold">{cam.geo.floor[0].toUpperCase() + cam.geo.floor.slice(1)}</span>}
          <div className="flex items-center gap-2.5 rounded-[4px] border border-line bg-white px-3.5 py-3">
            <span className="text-[15px] font-bold">Camera now:</span>
            <LevelChip level={calm ? "calm" : live.level} />
            {!calm && <span className="text-[14px] text-ink-2">still going</span>}
          </div>
          <svg viewBox="0 0 340 170" role="img" aria-label={`Map: you are ${dist ?? "near"} from ${live.location}`} className="h-auto w-full rounded-[4px] border border-line bg-white">
            <rect x="30" y="30" width="180" height="110" fill="#E6E9EE" stroke="#B4BAC3" />
            <text x="40" y="52" fontSize="13" fontWeight="700" fill="#3A414B">{(cam?.geo?.building ?? live.location).toUpperCase().slice(0, 22)}</text>
            <path d="M260 120 L200 100 L150 90" fill="none" stroke="#2742D9" strokeWidth="4" strokeDasharray="8 6" />
            <circle cx="268" cy="122" r="10" fill="#2742D9" stroke="#FFFFFF" strokeWidth="3" />
            <text x="250" y="152" fontSize="13" fontWeight="700" fill="#1F35B3">You</text>
            <circle cx="146" cy="88" r="11" fill="#C8241B" stroke="#FFFFFF" strokeWidth="3" />
            <text x="96" y="72" fontSize="13" fontWeight="700" fill="#0B0D10">{dist ? `${dist.replace("~", "")} away` : "Here"}</text>
          </svg>
          {notice && <span className="text-[14px] font-bold">{notice}</span>}
          <button
            type="button"
            onClick={() => {
              setFlow({ ...flow, kind: "found" });
              void write({ arrived_at: new Date().toISOString() });
            }}
            className="mt-auto min-h-[84px] rounded-[4px] bg-ink text-[26px] font-extrabold text-white"
          >
            I&rsquo;m here
          </button>
        </div>
      </Frame>
    );
  }

  if (flow && live && flow.kind === "found") {
    const notes = flow.note ?? [];
    return (
      <Frame header={header}>
        <div className="flex flex-col gap-2.5 px-4 pt-4 pb-[22px]">
          <h1 className="ee-display text-[40px] leading-[0.95]">What did you find?</h1>
          {OUTCOMES.map((o, i) => (
            <button
              key={o.id}
              type="button"
              onClick={() => {
                const at = new Date().toISOString();
                setFlow({ ...flow, kind: "done", outcome: o.id, outcomeAt: at });
                void write({ outcome: o.id, outcome_at: at, ...(notes.length ? { staff_note: `${person.first}: ${notes.join("; ")}` } : {}) });
              }}
              className={cn(
                "min-h-[68px] rounded-[4px] px-[18px] text-left text-[20px] font-extrabold",
                i === 0 ? "bg-ink text-white" : i === 3 ? "border border-line-strong bg-white text-ink-2" : "border-2 border-ink bg-white text-ink",
              )}
            >
              {o.label}
            </button>
          ))}
          <span className="mt-1.5 font-mono text-[12px] font-bold tracking-[0.06em] text-muted-ink">ADD A QUICK NOTE (OPTIONAL)</span>
          <span className="flex flex-wrap gap-1.5">
            {NOTES.map((n) => {
              const on = notes.includes(n);
              return (
                <button key={n} type="button" aria-pressed={on} onClick={() => setFlow({ ...flow, note: on ? notes.filter((x) => x !== n) : [...notes, n] })} className={cn("inline-flex min-h-10 items-center rounded-full border px-3 text-[15px] font-bold", on ? "border-ink bg-ink text-white" : "border-line-strong bg-white")}>
                  {n}
                </button>
              );
            })}
          </span>
        </div>
      </Frame>
    );
  }

  if (flow && live && flow.kind === "done") {
    const calm = live.level === "calm" || live.end_time != null;
    const backup = flow.outcome === "backup";
    const label = OUTCOMES.find((o) => o.id === flow.outcome)?.label ?? "";
    const ackS = secs(live.pushed_at, live.acked_at);
    const thereS = secs(live.acked_at, live.arrived_at);
    const myPostNow = mine.find((s) => postOnNow(s, now));
    return (
      <Frame header={header}>
        <div className="flex flex-1 flex-col gap-3.5 px-4 py-[22px]">
          <span className="inline-flex size-16 items-center justify-center rounded-full bg-ink text-[34px] font-extrabold text-white" aria-hidden="true">✓</span>
          <h1 className="ee-display text-[44px] leading-[0.95]">{backup ? "Backup is coming." : "Thanks. The desk has it."}</h1>
          <div className="flex flex-col gap-1.5 rounded-[4px] border border-line bg-white px-3.5 py-3 text-[16px] leading-[1.45]">
            <span><span className="font-extrabold">You reported:</span> {label} · {flow.outcomeAt ? hm(flow.outcomeAt) : ""}</span>
            <span>
              <span className="font-extrabold">Camera:</span>{" "}
              {backup ? (calm ? "calm now. The desk is sending the next guard." : `still ${LEVEL_LABEL[live.level].toLowerCase()}. The desk is sending the next guard.`) : flow.outcome === "nothing" ? `${calm ? "calm" : LEVEL_LABEL[live.level].toLowerCase()}. The desk will decide if it was a false alarm.` : calm ? "calm" : `still ${LEVEL_LABEL[live.level].toLowerCase()}`}
            </span>
            {!flow.test && (ackS != null || thereS != null) && (
              <span className="text-ink-2">{[ackS != null && `On my way in ${ackS} s`, thereS != null && `there in ${thereS} s`].filter(Boolean).join(" · ")}</span>
            )}
            {flow.test && <span className="text-ink-2">Test only. Nothing was sent to the desk.</span>}
          </div>
          {notice && <span className="text-[14px] font-bold">{notice}</span>}
          <button
            type="button"
            onClick={() => {
              setFlow(null);
              setNotice(null);
              setTab("today");
            }}
            className="mt-auto min-h-16 rounded-[4px] bg-ink text-[20px] font-extrabold text-white"
          >
            {myPostNow ? `Back to my post · until ${hh(slotSpan(myPostNow.hours)[1])}` : "Back to today"}
          </button>
        </div>
      </Frame>
    );
  }

  // ── Start my shift ──
  if (!shift) {
    return (
      <Frame>
        <div className="flex flex-1 flex-col justify-center gap-4 p-6">
          <Avatar person={person} size={112} />
          <h1 className="ee-display text-[44px] leading-[0.95]">Hi, {person.first}</h1>
          <span className="text-[18px] text-ink-2">{person.id} · {person.shiftLabel} · {site?.name}</span>
          <button type="button" onClick={startShift} className="min-h-[72px] rounded-[4px] bg-ink text-[22px] font-extrabold text-white">
            Start my shift
          </button>
          <span className="text-[15px] leading-normal text-ink-2">This turns on alert sounds and keeps the screen awake. Keep EarlyEye open during your shift.</span>
          <button type="button" onClick={() => setMe(null)} className="min-h-10 self-start text-[14px] font-extrabold text-signal">
            Not {person.first}? Switch person
          </button>
        </div>
      </Frame>
    );
  }

  // ── Tabs ──
  return (
    <Frame header={header} tabs={<Tabs tab={tab} onTab={setTab} />}>
      {!dev.soundOn && (
        <button type="button" onClick={() => void dev.unlock()} className="mx-4 mt-3 min-h-11 rounded-[4px] border-2 border-dashed border-ink bg-white px-3 text-left text-[14px] font-extrabold">
          Sound is off after a reload. Tap here to turn alerts back on.
        </button>
      )}
      {tab === "today" && <TodayTab person={person} mine={mine} posts={posts} now={now} onSeen={(s) => s.id && patchSlot(s.id, { seen_at: new Date().toISOString() }).then(() => mutate("plan"))} onCheckIn={(s) => s.id && postCheckin(s.id, person.id).then(() => mutate("plan"))} />}
      {tab === "schedule" && <ScheduleTab person={person} mine={mine} now={now} />}
      {tab === "alerts" && <AlertsTab me={person.id} events={events} now={now} />}
      {tab === "me" && (
        <MeTab
          person={person}
          site={site?.name}
          dev={dev}
          onTest={() => {
            const cam = cameras?.find((c) => c.zone_type === person.zone_type) ?? cameras?.[0];
            const at = new Date().toISOString();
            raise(
              {
                incident_id: `TEST-${Date.now()}`,
                camera_id: cam?.camera_id ?? "TEST",
                location: cam?.location ?? "Test location",
                zone_type: cam?.zone_type ?? "test",
                start_time: at,
                end_time: null,
                type: "fight",
                level: "fight_likely",
                peak_score: 0.7,
                eta_seconds: null,
                priority: 0.4,
                reason: "This is a test of the alarm. Nothing is happening.",
                people_count: 2,
                action: "Test",
                nearest_staff: person.id,
                pushed_to: person.id,
                pushed_at: at,
                status: "pushed",
                staff_note: null,
              },
              true,
            );
          }}
          onEnd={endShift}
          onSwitch={() => {
            endShift();
            store.set(ME_KEY, null);
            setMe(null);
          }}
        />
      )}
    </Frame>
  );
}

function Frame({ children, header, tabs, alarm }: { children?: React.ReactNode; header?: React.ReactNode; tabs?: React.ReactNode; alarm?: boolean }) {
  return (
    <div className={cn("mx-auto flex h-dvh max-w-[480px] flex-col overflow-hidden", alarm ? "ee-guard-alarm bg-[#C8241B] text-white" : "bg-[#F1F2F4] text-ink")}>
      {header}
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</main>
      {tabs}
    </div>
  );
}

function Header({ person, shift, now }: { person: Person; shift: boolean; now: number }) {
  const on = shift && onShift(person, now);
  return (
    <div className="flex flex-none items-center gap-2.5 border-b border-line bg-white px-4 pt-[max(10px,env(safe-area-inset-top))] pb-3">
      <Avatar person={person} size={40} />
      <span className="flex flex-1 flex-col gap-px">
        <span className="text-[17px] font-extrabold">{person.name}</span>
        <span className={cn("text-[13px] font-bold", shift ? "text-signal-ink" : "text-muted-ink")}>
          {shift ? `● On duty · until ${hh(person.to)}` : "Off duty"}
          {shift && !on ? " · outside your usual hours" : ""}
        </span>
      </span>
      <span className="font-mono text-[12px] text-muted-ink uppercase">{person.id}</span>
    </div>
  );
}

function Tabs({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  const items: [Tab, string][] = [["today", "Today"], ["schedule", "Schedule"], ["alerts", "Alerts"], ["me", "Me"]];
  return (
    <nav aria-label="App" className="grid flex-none grid-cols-4 border-t border-line bg-white pb-[env(safe-area-inset-bottom)]">
      {items.map(([t, label]) => (
        <button key={t} type="button" onClick={() => onTab(t)} aria-current={tab === t ? "page" : undefined} className={cn("flex min-h-16 flex-col items-center justify-center gap-1 text-[12px] font-bold", tab === t ? "text-ink" : "text-[#8B939E]")}>
          <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d={TAB_ICON[t]} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          {label}
        </button>
      ))}
    </nav>
  );
}

const Kicker = ({ children, blue }: { children: React.ReactNode; blue?: boolean }) => (
  <span className={cn("font-mono text-[12px] font-bold tracking-[0.06em]", blue ? "text-signal-ink" : "text-muted-ink")}>{children}</span>
);

function TodayTab({ person, mine, posts, now, onSeen, onCheckIn }: { person: Person; mine: PatrolSlot[]; posts: PatrolSlot[]; now: number; onSeen: (s: PatrolSlot) => void; onCheckIn: (s: PatrolSlot) => void }) {
  const n = myt(now);
  const unseen = mine.filter((s) => !s.seen_at);
  const today = mine.filter((s) => slotDays(s.days).includes(n.wd)).sort((a, b) => startHour(a.hours) - startHour(b.hours));
  // The post running now, else the next one today, else the next day with one.
  const current = today.find((s) => postOnNow(s, now)) ?? today.find((s) => startHour(s.hours) > n.hour) ?? null;
  const later = !current
    ? rollingWeek(now).slice(1).flatMap((d) => mine.filter((s) => slotDays(s.days).includes(d.wd)).map((s) => ({ s, d }))).sort((a, b) => a.d.i - b.d.i || startHour(a.s.hours) - startHour(b.s.hours))[0]
    : null;
  const checkin = current?.checkins?.filter((c) => c.staff === person.id && myt(c.at).key === n.key).pop();
  const startsIn = current ? startHour(current.hours) * 60 - (n.hour * 60 + n.minute) : 0;
  const working = person.days.includes(n.wd);
  const rank = (s: PatrolSlot) => posts.findIndex((x) => x.id === s.id) + 1;

  return (
    <div className="flex flex-col gap-3 px-4 py-3.5">
      {unseen.map((s) => (
        <div key={s.id} className="flex flex-col gap-2 rounded-[4px] border-2 border-signal bg-signal-tint p-3.5">
          {s.changed_at ? (
            <>
              <Kicker blue>CHANGED BY YOUR SUPERVISOR · {dayDate(s.changed_at).toUpperCase()}, {hm(s.changed_at)}</Kicker>
              <span className="text-[18px] leading-[1.3] font-extrabold">Your post is now: {s.location}, {daysLabel(s.days)}, {s.hours}.</span>
              {s.tip && <span className="text-[14px] text-ink-2">{s.tip}</span>}
            </>
          ) : (
            <>
              <Kicker blue>NEW FROM YOUR SUPERVISOR{s.since ? ` · ${dayDate(s.since).toUpperCase()}` : ""}</Kicker>
              <span className="text-[18px] leading-[1.3] font-extrabold">You have a standing post: {s.location}, {daysLabel(s.days)}, {s.hours}.</span>
              <span className="text-[14px] text-ink-2">It stays in your schedule until your supervisor ends it.</span>
            </>
          )}
          <button type="button" onClick={() => onSeen(s)} className="min-h-[52px] rounded-[4px] bg-signal text-[18px] font-extrabold text-white">Got it</button>
        </div>
      ))}
      {current && !checkin && (
        <div className="flex flex-col gap-1.5 rounded-[4px] border-2 border-ink bg-white p-3.5">
          <Kicker>{startsIn > 0 ? `NEXT · IN ${startsIn >= 60 ? `${Math.floor(startsIn / 60)} H ${startsIn % 60} MIN` : `${startsIn} MIN`}` : "NOW · POST " + rank(current)}</Kicker>
          <span className="ee-display text-[34px] leading-none">{current.hours.slice(0, 5)} · {current.location}</span>
          {current.tip && <span className="text-[15px] leading-[1.45] text-ink-2">{current.tip}</span>}
          <button type="button" onClick={() => onCheckIn(current)} disabled={startsIn > 30} className="mt-1 min-h-[52px] rounded-[4px] bg-ink text-[18px] font-extrabold text-white disabled:bg-line-strong">
            I&rsquo;m at my post
          </button>
          {startsIn > 30 && <span className="text-[13px] text-muted-ink">You can check in from 30 minutes before.</span>}
        </div>
      )}
      {current && checkin && (
        <div className="flex flex-col gap-1.5 rounded-[4px] border-2 border-signal bg-white p-3.5">
          <Kicker blue>AT YOUR POST · ✓ CHECKED IN {hm(checkin.at)}</Kicker>
          <span className="ee-display text-[34px] leading-none">{current.location}</span>
          <span className="text-[18px] font-extrabold">
            Until {hh(slotSpan(current.hours)[1])}
            {postOnNow(current, now) ? ` · ${slotSpan(current.hours)[1] * 60 - (n.hour * 60 + n.minute)} min left` : ""}
          </span>
          <span className="text-[14px] leading-[1.45] text-ink-2">The desk can see you&rsquo;re here. If anything starts nearby, you get the alert first.</span>
        </div>
      )}
      {!current && later && (
        <div className="flex flex-col gap-1.5 rounded-[4px] border border-line bg-white p-3.5">
          <Kicker>NEXT POST · {later.d.i === 1 ? "TOMORROW" : `${DAY_SHORT[later.d.wd].toUpperCase()} ${later.d.date.toUpperCase()}`}</Kicker>
          <span className="ee-display text-[30px] leading-none">{later.s.hours.slice(0, 5)} · {later.s.location}</span>
        </div>
      )}
      {!mine.length && <div className="rounded-[4px] border border-line bg-white p-3.5 text-[15px] text-ink-2">No standing posts for you. Alerts still come to this phone while you&rsquo;re on duty.</div>}
      <div className="flex flex-col rounded-[4px] border border-line bg-white px-3.5 py-3">
        <span className="pb-1.5"><Kicker>TODAY · {dayDate(now).toUpperCase()}</Kicker></span>
        {(working
          ? [
              { t: person.from, text: n.hour >= person.from ? "Shift started" : "Shift starts", strong: false },
              ...today.map((s) => ({ t: startHour(s.hours), text: `Post: ${s.location}, until ${hh(slotSpan(s.hours)[1])}`, strong: true })),
              { t: person.to, text: "Shift ends", strong: false },
            ]
          : [{ t: -1, text: "Day off. Alerts still come while you're on duty.", strong: false }]
        ).map((row, i) => (
          <div key={i} className="grid grid-cols-[58px_minmax(0,1fr)] gap-2.5 border-t border-[#F1F2F4] py-[9px] text-[16px]">
            <span className="font-mono font-bold">{row.t >= 0 ? hh(row.t) : ""}</span>
            <span className={row.strong ? "font-extrabold" : "text-ink-2"}>{row.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScheduleTab({ person, mine, now }: { person: Person; mine: PatrolSlot[]; now: number }) {
  return (
    <div className="flex flex-col gap-2.5 px-4 py-3.5">
      <h1 className="ee-display text-[32px] leading-none">Next 7 days</h1>
      {rollingWeek(now).map((d) => {
        const works = person.days.includes(d.wd);
        const ps = mine.filter((s) => slotDays(s.days).includes(d.wd));
        return (
          <div key={d.key} className={cn("grid grid-cols-[58px_minmax(0,1fr)] items-start gap-2.5 rounded-[4px] bg-white px-3 py-2.5", d.i === 0 ? "border-2 border-ink" : "border border-line")}>
            <span className={cn("flex flex-col items-center rounded-[4px] py-0.5", d.i === 0 ? "bg-ink text-white" : "bg-[#F1F2F4]")}>
              <span className="text-[12px] font-extrabold">{DAY_SHORT[d.wd].toUpperCase()}</span>
              <span className="ee-display text-[24px] leading-none">{d.date.split(" ").find((x) => /^\d+$/.test(x))}</span>
            </span>
            <span className="flex flex-col gap-1">
              <span className="text-[15px] text-ink-2">{d.i === 0 ? "Today · " : ""}{works ? `Shift ${hh(person.from)}–${hh(person.to)}` : "Day off"}</span>
              {ps.map((s) => (
                <span key={s.id} className="text-[16px] font-extrabold text-signal-ink">Post {s.hours} · {s.location}</span>
              ))}
            </span>
          </div>
        );
      })}
      <span className="text-[13px] leading-normal text-muted-ink">
        {mine.length ? `${mine.map((s) => s.location).join(" and ")} ${mine.length === 1 ? "is a standing post. It stays" : "are standing posts. They stay"} until your supervisor ends ${mine.length === 1 ? "it" : "them"}. Any change shows up here and on Today.` : "No standing posts for you yet. Your supervisor adds them on the Plan page."}
      </span>
    </div>
  );
}

function AlertsTab({ me, events, now }: { me: string; events: Event[]; now: number }) {
  const OUT: Record<Outcome, string> = { sorted: "Sorted, nobody hurt", hurt: "Sorted, someone hurt", backup: "Needed backup", nothing: "Nothing there" };
  const list = events
    .filter((e) => e.pushed_to === me && Date.parse(e.pushed_at ?? e.start_time) > now - 30 * 86_400_000 && Date.parse(e.pushed_at ?? e.start_time) <= now)
    .sort((a, b) => Date.parse(b.pushed_at ?? b.start_time) - Date.parse(a.pushed_at ?? a.start_time));
  const replies = list.map((e) => secs(e.pushed_at, e.acked_at)).filter((x): x is number => x != null).sort((a, b) => a - b);
  const median = replies.length ? replies[Math.floor(replies.length / 2)] : null;
  return (
    <div className="flex flex-col gap-2.5 px-4 py-3.5">
      <h1 className="ee-display text-[32px] leading-none">Your alerts</h1>
      <span className="text-[15px] text-ink-2">
        {list.length} in the last 30 days{median != null ? ` · you reply in about ${median} seconds` : ""}
      </span>
      {list.map((e) => {
        const r = secs(e.pushed_at, e.acked_at);
        const t = e.pushed_at ?? e.start_time;
        return (
          <div key={e.incident_id} className="flex flex-col gap-1.5 rounded-[4px] border border-line bg-white p-3">
            <span className="flex items-center gap-2">
              <LevelChip level={e.level} />
              <span className="font-mono text-[12px] text-muted-ink">{dayDate(t).toUpperCase()} · {hm(t)}</span>
            </span>
            <span className="text-[17px] font-extrabold">{e.location}</span>
            <span className="text-[14px] text-ink-2">
              You: {e.outcome ? OUT[e.outcome] : e.status === "confirmed" ? "Confirmed by the desk" : e.status === "dismissed" ? "False alarm" : e.status === "resolved" ? "Resolved" : "No report"}
              {r != null ? ` · on the way in ${r} s` : " · no answer"}
            </span>
          </div>
        );
      })}
      {!list.length && <span className="text-[15px] text-ink-2">No alerts for you in the last 30 days.</span>}
    </div>
  );
}

function MeTab({ person, site, dev, onTest, onEnd, onSwitch }: { person: Person; site?: string; dev: ReturnType<typeof useGuardDevice>; onTest: () => void; onEnd: () => void; onSwitch: () => void }) {
  const rows: [string, string][] = [
    ["Shift", person.shiftLabel],
    ["Alert sound", dev.soundOn ? "On" : "Off"],
    ["Vibrate", dev.canVibrate ? "On" : "Not on this phone"],
    ["Screen stays awake on shift", dev.awake ? "On" : "Off"],
    ["Installed on this phone", dev.installed ? "✓" : "Not yet"],
  ];
  return (
    <div className="flex flex-col gap-3 px-4 py-[18px]">
      <span className="self-center"><Avatar person={person} size={104} /></span>
      <span className="self-center text-[24px] font-extrabold">{person.name}</span>
      <span className="self-center text-center text-[15px] text-ink-2">{person.id} · {person.role}{site ? ` · ${site}` : ""}</span>
      <div className="rounded-[4px] border border-line bg-white">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-2.5 border-b border-[#F1F2F4] px-3.5 py-3 text-[16px] last:border-b-0">
            <span>{k}</span>
            <span className="text-right font-extrabold text-signal-ink">{v}</span>
          </div>
        ))}
      </div>
      {!dev.installed && (
        <p className="m-0 text-[13px] leading-normal text-muted-ink">
          To install: iPhone, tap Share, then Add to Home Screen. Android, tap the menu, then Install app.
        </p>
      )}
      <button type="button" onClick={onTest} className="min-h-[52px] rounded-[4px] border-2 border-ink bg-white text-[17px] font-extrabold">Test the alarm</button>
      <button type="button" onClick={onEnd} className="min-h-[52px] rounded-[4px] bg-ink text-[17px] font-extrabold text-white">End my shift</button>
      <button type="button" onClick={onSwitch} className="min-h-10 text-[14px] font-extrabold text-signal">Not {person.first}? Switch person</button>
    </div>
  );
}

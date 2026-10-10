"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { getCameras, getEvents, getPatrolPlan, getSite } from "@/lib/api";
import type { PatrolPlan, Staff } from "@/lib/types";
import { fmtBlackFor, WEEKDAY_SHORT } from "@/lib/format";
import { cameraKind } from "@/lib/camera-meta";
import {
  apiHasAssignments,
  buildPosts,
  DAY_FULL,
  DAY_PLURAL,
  fitFor,
  fmtDM,
  fmtWDM,
  hh,
  hoursOf,
  mergeAssignments,
  MOCK_REVIEW,
  planWeek,
  plural,
  type Post,
  realIncidents,
  type ReviewRow,
  shiftText,
  suggest,
  useLocalAssignments,
  type Week,
} from "@/lib/patrol";
import { cn } from "@/lib/utils";
import { PageShell } from "@/components/chrome/page-shell";
import { Campus3D } from "@/components/campus3d";

type Sort = "incidents" | "quick" | "open";

const SORTS: [Sort, string, string][] = [
  [
    "incidents",
    "Most incidents",
    "Posts with the most incidents in the last 4 weeks come first.",
  ],
  [
    "quick",
    "Quick wins first",
    "Posts that prevent the most for each hour a guard spends there come first.",
  ],
  ["open", "Nobody yet first", "Posts that still need someone come first."],
];

/** Calendar shading: incidents at that hour in the last 4 weeks. Blue means a count, never a risk level. */
const SHADE = ["#FFFFFF", "#E7EBFD", "#C4CEF6", "#93A6EE"];
const shade = (n: number) => SHADE[Math.min(n, SHADE.length - 1)];

const CAL_HOURS = Array.from({ length: 17 }, (_, i) => 7 + i); // 07:00–23:00

const BTN_TOGGLE =
  "min-h-9 cursor-pointer rounded-[2px] border px-3 text-[14px] font-bold";
const toggle = (on: boolean) =>
  on
    ? "border-ink bg-ink text-white"
    : "border-line-strong bg-white text-ink hover:border-ink";
const BTN_QUIET =
  "min-h-10 cursor-pointer rounded-[2px] border border-line-strong bg-white px-3 text-[14px] font-bold text-ink";
const CHIP_DASHED =
  "inline-flex min-h-7 items-center rounded-[2px] border border-dashed border-line-strong bg-white px-2 font-mono text-[11px] font-bold tracking-[0.06em] text-ink-2";

/** "Mon 12, Tue 13, Wed 14, Thu 15 Oct" */
function datesText(week: Week, days: number[]): string {
  const d = [...days].sort((a, b) => a - b).map((i) => week.days[i]);
  const month = (x: number) => new Date(x).getUTCMonth();
  if (!d.every((x) => month(x) === month(d[0]))) return d.map(fmtWDM).join(", ");
  const parts = d.map((x) => fmtWDM(x).replace(/ \w+$/, ""));
  return `${parts.join(", ")} ${fmtDM(d[0]).split(" ")[1]}`;
}

/** Most frequent value, or null. */
function mode<T>(xs: T[]): { k: T; n: number } | null {
  const m = new Map<T, number>();
  xs.forEach((x) => m.set(x, (m.get(x) ?? 0) + 1));
  let best: { k: T; n: number } | null = null;
  for (const [k, n] of m) if (!best || n > best.n) best = { k, n };
  return best;
}

const initial = (name: string) => name.split(" ").pop()?.[0] ?? name[0];

export function PlanScreen() {
  const router = useRouter();
  const { data: plan } = useSWR("plan", getPatrolPlan, {
    revalidateOnFocus: false,
  });
  const { data: site } = useSWR("site", getSite, { revalidateOnFocus: false });
  const { data: cameras } = useSWR("cameras", getCameras, {
    refreshInterval: 30_000,
  });
  const { data: events } = useSWR(["events", "full"], () => getEvents(), {
    refreshInterval: 10_000,
  });

  const week = useMemo(
    () => (plan ? planWeek(plan.generated_at) : null),
    [plan],
  );
  const incidents = useMemo(
    () => (week ? realIncidents(events ?? [], week) : []),
    [events, week],
  );
  const posts = useMemo(
    () => buildPosts(plan, incidents, events ?? []),
    [plan, incidents, events],
  );
  const [local, setLocal] = useLocalAssignments(week?.key ?? null);
  const assign = useMemo(() => mergeAssignments(posts, local), [posts, local]);
  const staff: Staff[] = useMemo(() => site?.staff ?? [], [site]);

  const [sort, setSort] = useState<Sort>("incidents");
  const [focus, setFocus] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<string | null>(null);
  const [seen, setSeen] = useState<Set<string>>(() => new Set());
  const [rosterOpen, setRosterOpen] = useState(false);
  const [shared, setShared] = useState<"copied" | "printed" | null>(null);
  const [zone, setZone] = useState("all");
  const [pickedDay, setPickedDay] = useState<number | null>(null);
  const [dayOrder, setDayOrder] = useState<"week" | "busy">("week");
  const [mapPost, setMapPost] = useState<string | undefined>();

  const nPosts = posts.length || 3;
  const covered = posts.filter((p) => assign[p.key]).length;
  const allCovered = posts.length > 0 && covered === posts.length;
  const checked = posts.length > 0 && posts.every((p) => seen.has(p.key));

  const look = (key: string) => {
    setFocus(key);
    setSeen((s) => (s.has(key) ? s : new Set(s).add(key)));
  };
  const setAssign = (key: string, name: string | null) => {
    setLocal(key, name);
    setChoosing(null);
    look(key);
    setShared(null);
  };
  const focusCard = (key: string) => {
    look(key);
    document
      .getElementById(`post-${key}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const ordered = useMemo(
    () =>
      posts.slice().sort((a, b) => {
        if (sort === "quick") return b.perHour - a.perHour || a.rank - b.rank;
        if (sort === "open")
          return (
            Number(!!assign[a.key]) - Number(!!assign[b.key]) ||
            a.rank - b.rank
          );
        return a.rank - b.rank;
      }),
    [posts, sort, assign],
  );

  const camFor = (loc: string) => cameras?.find((c) => c.location === loc);

  // The map gets the plan in rank order, with this week's names on the pins.
  const mapPlan: PatrolPlan | undefined = useMemo(
    () =>
      plan && {
        ...plan,
        slots: posts.map((p) => ({
          ...p.slot,
          incidents_4w: p.incidents,
          assigned_to: assign[p.key] ?? null,
        })),
      },
    [plan, posts, assign],
  );

  // ── Week at a glance ──
  const zones = site?.zones ?? [];
  const shown = useMemo(
    () => incidents.filter((x) => zone === "all" || x.zone_type === zone),
    [incidents, zone],
  );
  const zoneName = zones.find((z) => z.zone_type === zone)?.label;
  const placeOf = (zt: string) =>
    zones.find((z) => z.zone_type === zt)?.label ??
    incidents.find((x) => x.zone_type === zt)?.location ??
    zt;
  const dayStats = WEEKDAY_SHORT.map((_, wd) => {
    const list = shown.filter((x) => x.wd === wd);
    const hr = mode(list.map((x) => x.hour));
    const pl = mode(list.map((x) => x.zone_type));
    const tile = !hr
      ? "Quiet"
      : hr.n >= 2
        ? `Busiest ${hh(hr.k)}`
        : list.length === 1
          ? `One, at ${hh(hr.k)}`
          : "Spread out";
    return { wd, list, n: list.length, hr, pl, tile };
  });
  const busiest = dayStats.reduce((a, b) => (b.n > a.n ? b : a), dayStats[0]);
  const day = pickedDay ?? busiest.wd;
  const sel = dayStats[day];
  const dayTiles =
    dayOrder === "busy"
      ? dayStats.slice().sort((a, b) => b.n - a.n || a.wd - b.wd)
      : dayStats;
  const selDates = (() => {
    const m = new Map<number, number>();
    sel.list.forEach((x) => m.set(x.day, (m.get(x.day) ?? 0) + 1));
    return [...m].map(([d, n]) => `${fmtWDM(d)}${n > 1 ? ` (${n})` : ""}`);
  })();
  const grid = useMemo(() => {
    const g = WEEKDAY_SHORT.map(() => new Array(24).fill(0) as number[]);
    shown.forEach((x) => (g[x.wd][x.hour] += 1));
    return g;
  }, [shown]);
  const postAt = (wd: number, h: number) =>
    posts.find((p) => p.days.includes(wd) && h >= p.from && h < p.to);

  // ── Roster ──
  const rosterLines = week
    ? [
        `Patrol roster · week of ${fmtWDM(week.start)}${site ? ` · ${site.name}` : ""}`,
        ...posts.map(
          (p) =>
            `${p.rank}. ${p.place} · ${p.daysLabel} ${p.hours} (${datesText(week, p.days)}) · ${assign[p.key] ?? "NOBODY YET"}.${p.slot.tip ? ` ${p.slot.tip}` : ""}`,
        ),
      ]
    : [];
  const copyRoster = async () => {
    try {
      await navigator.clipboard.writeText(rosterLines.join("\n"));
    } catch {
      // clipboard blocked: the text is on screen to select by hand
    }
    setShared("copied");
  };
  const printRoster = () => {
    setShared("printed");
    window.print();
  };

  const black = (cameras ?? []).filter((c) => cameraKind(c) === "black");

  // ── Review: plan.review from the API, else the synthetic sample ──
  const reviewIsMock = !plan?.review;
  const review: ReviewRow[] = plan?.review ?? MOCK_REVIEW;
  const rv = review.reduce(
    (a, r) => ({
      n: a.n + r.incidents_during_post,
      c: a.c + r.covered_days,
      p: a.p + r.planned_days,
    }),
    { n: 0, c: 0, p: 0 },
  );

  const savedHere = !apiHasAssignments(plan) && Object.keys(local).length > 0;

  const steps = [
    {
      done: checked,
      title: `Check the ${nPosts} posts`,
      sub: checked
        ? "All posts looked at"
        : "Where and when trouble keeps happening",
    },
    {
      done: allCovered,
      title: `Pick who goes (${covered} of ${nPosts})`,
      sub: `${covered} of ${nPosts} posts have someone`,
    },
    {
      done: !!shared,
      title: "Share the roster",
      sub:
        shared === "copied"
          ? "Copied for your team chat"
          : shared === "printed"
            ? "Sent to the printer"
            : "Copy or print it for your team",
    },
  ];

  return (
    <PageShell
      headerRight={<span className={CHIP_DASHED}>SYNTHETIC HISTORY · 8 WEEKS</span>}
    >
      {/* ── Title ── */}
      <div className="flex flex-wrap items-end justify-between gap-3.5 print:hidden">
        <div className="flex max-w-[860px] flex-col gap-1.5">
          <span className="ee-label text-[12px]">
            {week ? `Patrol plan · week of ${fmtWDM(week.start)}` : "Patrol plan"}
          </span>
          <h1 className="ee-display text-[44px] leading-[0.95] sm:text-[56px]">
            Where to put people this week
          </h1>
          <p className="text-[18px] leading-[1.45] text-ink-2">
            EarlyEye found {nPosts} places and times where trouble keeps
            happening. Put one person at each, and fewer incidents should
            happen. It takes about two minutes.
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <span className="ee-display text-[30px] leading-none">
            {covered} of {nPosts} posts covered
          </span>
          <button
            type="button"
            onClick={() => setRosterOpen((o) => !o)}
            aria-expanded={rosterOpen}
            className="min-h-12 cursor-pointer rounded-[2px] bg-ink px-[18px] text-[16px] font-extrabold text-white"
          >
            {rosterOpen ? "Hide the roster" : "Share the roster"}
          </button>
          {savedHere && (
            <span className="text-[13px] text-muted-foreground">
              Saved on this computer
            </span>
          )}
        </div>
      </div>

      {/* ── Steps ── */}
      <ol
        aria-label="How to use this page"
        className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-2 print:hidden"
      >
        {steps.map((st, i) => (
          <li
            key={i}
            className="flex items-center gap-3 rounded-[2px] border border-line bg-white px-3.5 py-2.5"
          >
            <span
              className={cn(
                "inline-flex size-8 flex-none items-center justify-center rounded-full border-2 border-ink text-[15px] font-extrabold",
                st.done ? "bg-ink text-white" : "bg-white text-ink",
              )}
              aria-label={st.done ? "Done" : `Step ${i + 1}`}
            >
              {st.done ? "✓" : i + 1}
            </span>
            <span className="flex flex-col gap-px">
              <span className="text-[16px] font-extrabold">{st.title}</span>
              <span className="text-[13px] text-muted-foreground">{st.sub}</span>
            </span>
          </li>
        ))}
      </ol>

      {/* ── Roster ── */}
      {rosterOpen && (
        <section
          aria-label="Roster to share"
          className="flex flex-col gap-2.5 rounded-[2px] border-2 border-ink bg-white p-4"
        >
          <span className="ee-label text-[12px]">
            Roster to share with your team
          </span>
          <div className="flex flex-col gap-1.5 rounded-[2px] border border-line bg-raised px-3.5 py-3">
            {rosterLines.map((l, i) => (
              <span
                key={i}
                className={cn(
                  "text-[15px] leading-[1.45]",
                  i === 0 ? "font-extrabold" : "font-medium",
                )}
              >
                {l}
              </span>
            ))}
          </div>
          <span className="flex flex-wrap items-center gap-2.5 print:hidden">
            <button
              type="button"
              onClick={copyRoster}
              className="min-h-11 cursor-pointer rounded-[2px] bg-signal px-4 text-[15px] font-extrabold text-white"
            >
              Copy roster
            </button>
            <button
              type="button"
              onClick={printRoster}
              className="min-h-11 cursor-pointer rounded-[2px] border-2 border-ink bg-white px-4 text-[15px] font-extrabold text-ink"
            >
              Print
            </button>
            <span
              className="text-[14px] font-bold text-signal-ink"
              aria-live="polite"
            >
              {shared === "copied" ? "Copied. Paste it into your team chat." : ""}
            </span>
          </span>
          <span className="text-[13px] text-muted-foreground print:hidden">
            Nothing is sent from EarlyEye. Paste it into your team chat. Each
            guard also sees their own post on their duty phone page.
          </span>
        </section>
      )}

      {/* ── Posts and map ── */}
      <div className="flex flex-wrap items-start gap-3.5 print:hidden">
        <section
          aria-label="This week's posts"
          className="flex min-w-0 flex-[1_1_520px] flex-col gap-2.5"
        >
          <div
            role="group"
            aria-label="Sort posts"
            className="flex flex-wrap items-center gap-1.5"
          >
            <span className="mr-1 text-[14px] font-extrabold">Sort posts</span>
            {SORTS.map(([k, label]) => (
              <button
                key={k}
                type="button"
                aria-pressed={sort === k}
                onClick={() => setSort(k)}
                className={cn(BTN_TOGGLE, toggle(sort === k))}
              >
                {label}
              </button>
            ))}
            <span className="basis-full text-[13px] text-muted-foreground">
              {SORTS.find((s) => s[0] === sort)?.[2]}
            </span>
          </div>

          {!plan && (
            <div
              className="h-[420px] rounded-[2px] border border-line bg-raised"
              aria-busy="true"
            />
          )}
          {week &&
            ordered.map((p) => {
              const cam = camFor(p.place);
              return (
                <PostCard
                  key={p.key}
                  post={p}
                  posts={posts}
                  week={week}
                  staff={staff}
                  assign={assign}
                  focused={focus === p.key}
                  choosing={choosing === p.key}
                  incidentsHref={
                    cam
                      ? `/incidents?cam=${encodeURIComponent(cam.camera_id)}`
                      : "/incidents"
                  }
                  onLook={() => look(p.key)}
                  onAssign={(name) => setAssign(p.key, name)}
                  onChoose={() => {
                    look(p.key);
                    setChoosing((c) => (c === p.key ? null : p.key));
                  }}
                  onMap={() => {
                    look(p.key);
                    setMapPost(p.place);
                    document
                      .getElementById("plan-map")
                      ?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                />
              );
            })}
          <p className="text-[13px] leading-[1.45] text-muted-foreground">
            How &ldquo;should prevent&rdquo; is worked out: we assume a person
            on the spot stops about 6 in 10 of these incidents. That is our
            estimate, not a measurement. The &ldquo;Did last week&apos;s plan
            work?&rdquo; section below checks it.
          </p>
        </section>

        <section
          id="plan-map"
          aria-labelledby="map-h"
          className="flex min-w-0 flex-[1_1_520px] scroll-mt-4 flex-col gap-2.5 rounded-[2px] border border-line bg-white p-3.5"
        >
          <h2 id="map-h" className="ee-display text-[28px]">
            Where the posts are
          </h2>
          {mapPlan && site && cameras ? (
            <Campus3D
              mode="plan"
              cameras={cameras}
              site={site}
              events={events ?? []}
              plan={mapPlan}
              height={520}
              selectedPostLocation={mapPost}
              onOpenCamera={(id) =>
                router.push(`/cameras?cam=${encodeURIComponent(id)}`)
              }
            />
          ) : (
            <div
              className="h-[520px] rounded-[2px] border border-line bg-raised"
              aria-busy="true"
            />
          )}
          <span className="text-[14px] text-ink-2">
            Blue pins are the posts, with who stands there. Taller columns mean
            more incidents there in the last 4 weeks.
          </span>
          {black.map((c) => {
            const p = posts.find((q) => q.zoneType === c.zone_type);
            const since = c.black_since
              ? ` for ${fmtBlackFor(c.black_since).replace(/^Black for /, "")}`
              : "";
            return (
              <div
                key={c.camera_id}
                className="flex flex-wrap items-center gap-x-3.5 gap-y-2 rounded-[2px] bg-ink px-3.5 py-3 text-white"
              >
                <span className="flex-[1_1_280px] text-[15px] leading-[1.45]">
                  {`The camera at ${c.location} has been off${since}. `}
                  {p
                    ? `Until it's fixed, post ${p.rank} at ${p.place} is the only eye on that building.`
                    : "Until it's fixed, nobody sees that area."}
                </span>
                <Link
                  href={`/cameras?cam=${encodeURIComponent(c.camera_id)}`}
                  className="text-[14px] font-extrabold text-white underline underline-offset-2"
                >
                  Report the repair
                </Link>
              </div>
            );
          })}
        </section>
      </div>

      {/* ── Week at a glance ── */}
      <section
        aria-labelledby="week-h"
        className="flex flex-col gap-3 rounded-[2px] border border-line bg-white p-4 print:hidden"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="week-h" className="ee-display text-[30px]">
            Your week at a glance
          </h2>
          <span className="text-[14px] text-ink-2">
            Shading shows when trouble happened in the last 4 weeks. Boxes are
            this week&apos;s posts.
          </span>
        </div>
        <div
          role="group"
          aria-label="Show trouble at"
          className="flex flex-wrap gap-1.5"
        >
          {[{ zone_type: "all", label: "All places" }, ...zones].map((z) => (
            <button
              key={z.zone_type}
              type="button"
              aria-pressed={zone === z.zone_type}
              onClick={() => setZone(z.zone_type)}
              className={cn(BTN_TOGGLE, "min-h-[38px]", toggle(zone === z.zone_type))}
            >
              {z.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ground pt-3">
          <span className="text-[18px] font-extrabold">
            By weekday{" "}
            <span className="text-[14px] font-medium text-ink-2">
              · incidents in the last 4 weeks · pick a day
            </span>
          </span>
          <div
            role="group"
            aria-label="Order the days"
            className="inline-flex overflow-hidden rounded-[2px] border border-line-strong"
          >
            {(
              [
                ["week", "Mon to Sun"],
                ["busy", "Busiest first"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                aria-pressed={dayOrder === k}
                onClick={() => setDayOrder(k)}
                className={cn(
                  "min-h-9 cursor-pointer px-3 text-[13px] font-bold",
                  dayOrder === k ? "bg-ink text-white" : "bg-white text-ink",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-1.5">
          {week &&
            dayTiles.map((t) => {
              const on = t.wd === day;
              return (
                <button
                  key={t.wd}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setPickedDay(t.wd)}
                  className={cn(
                    "flex cursor-pointer flex-col gap-[3px] rounded-[2px] p-2.5 text-left",
                    on
                      ? "border-2 border-ink bg-ink text-white"
                      : "border border-line bg-white text-ink hover:border-ink",
                  )}
                >
                  <span className="font-mono text-[12px] font-bold">
                    {WEEKDAY_SHORT[t.wd].toUpperCase()} {fmtDM(week.days[t.wd])}
                  </span>
                  <span className="ee-display text-[32px] leading-none">
                    {t.n}
                  </span>
                  <span className="text-[12px] leading-[1.35]">{t.tile}</span>
                </button>
              );
            })}
        </div>

        {week && (
          <DayPanel
            wd={day}
            week={week}
            n={sel.n}
            zoneName={zoneName}
            hour={
              sel.hr && sel.hr.n >= 2
                ? `${hh(sel.hr.k)}, ${plural(sel.hr.n, "incident")}`
                : null
            }
            place={
              sel.pl && sel.pl.n >= 2
                ? `${placeOf(sel.pl.k)}, ${plural(sel.pl.n, "incident")}`
                : null
            }
            dates={selDates}
            posts={posts.filter((p) => p.days.includes(day))}
            assign={assign}
            onPost={focusCard}
          />
        )}

        <div className="overflow-x-auto">
          <div className="flex min-w-[760px] flex-col gap-0.5">
            <div className="grid grid-cols-[64px_repeat(7,minmax(0,1fr))] gap-0.5">
              <span />
              {WEEKDAY_SHORT.map((d, wd) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={wd === day}
                  onClick={() => setPickedDay(wd)}
                  className={cn(
                    "cursor-pointer rounded-[1px] px-1.5 py-1 text-left font-mono text-[12px] font-bold",
                    wd === day ? "bg-ink text-white" : "text-ink-2",
                  )}
                >
                  {d.toUpperCase()}{" "}
                  {week ? new Date(week.days[wd]).getUTCDate() : ""}
                </button>
              ))}
            </div>
            {CAL_HOURS.map((h) => (
              <div
                key={h}
                className="grid grid-cols-[64px_repeat(7,minmax(0,1fr))] gap-0.5"
              >
                <span className="px-1 py-1.5 text-right font-mono text-[12px] text-muted-foreground">
                  {hh(h)}
                </span>
                {WEEKDAY_SHORT.map((d, wd) => {
                  const c = grid[wd][h];
                  const p = postAt(wd, h);
                  const who = p ? assign[p.key] : undefined;
                  return (
                    <button
                      key={d}
                      type="button"
                      title={`${d} ${hh(h)}: ${c ? `${plural(c, "incident")} in the last 4 weeks` : "no incidents in the last 4 weeks"}${p ? `. Post ${p.rank}, ${p.place}: ${who ?? "nobody yet"}` : ""}`}
                      onClick={() => {
                        setPickedDay(wd);
                        if (p) focusCard(p.key);
                      }}
                      className={cn(
                        "min-h-[30px] cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap rounded-[1px] px-1.5 py-0.5 text-left text-[12px] font-extrabold text-ink",
                        p
                          ? cn("border-2 border-ink", !who && "border-dashed")
                          : wd === day
                            ? "border border-[#93A6EE]"
                            : "border border-[#EEF0F3]",
                      )}
                      style={{ background: shade(c) }}
                    >
                      {p ? `${p.rank} · ${who ?? "Nobody yet"}` : ""}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-ink-2">
          <span className="inline-flex items-center gap-1">
            Fewer
            {SHADE.map((c) => (
              <span
                key={c}
                className="h-3.5 w-[18px] border border-line"
                style={{ background: c }}
              />
            ))}
            More incidents
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3.5 w-[18px] border-2 border-ink bg-white" />
            Post with someone
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3.5 w-[18px] border-2 border-dashed border-ink bg-white" />
            Post with nobody yet
          </span>
        </div>
      </section>

      {/* ── Team and review ── */}
      <div className="flex flex-wrap items-start gap-3.5 print:hidden">
        <section
          aria-labelledby="team-h"
          className="flex min-w-0 flex-[1_1_520px] flex-col gap-2.5 rounded-[2px] border border-line bg-white p-4"
        >
          <h2 id="team-h" className="ee-display text-[30px]">
            Your team this week
          </h2>
          {[...staff]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((g) => {
              const mine = posts.filter((p) => assign[p.key] === g.name);
              const hrs = hoursOf(g.name, posts, assign);
              return (
                <div
                  key={g.name}
                  className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 border-b border-ground py-2.5"
                >
                  <span
                    className={cn(
                      "inline-flex size-10 items-center justify-center rounded-full font-extrabold",
                      g.on_duty ? "bg-signal text-white" : "bg-ground text-ink-2",
                    )}
                  >
                    {initial(g.name)}
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[17px] font-extrabold">{g.name}</span>
                      {g.role && (
                        <span className="text-[13px] text-muted-foreground">
                          {g.role}
                        </span>
                      )}
                      <span
                        className={cn(
                          "inline-flex items-center gap-[5px] text-[13px] font-bold",
                          g.on_duty ? "text-signal-ink" : "text-muted-foreground",
                        )}
                      >
                        <span
                          className={cn(
                            "size-2 rounded-full",
                            g.on_duty ? "bg-signal" : "bg-line-strong",
                          )}
                        />
                        {g.on_duty ? "On duty now" : "Off duty"}
                      </span>
                    </span>
                    <span className="text-[14px] text-ink-2">{shiftText(g)}</span>
                    <span className="text-[14px] font-bold">
                      {mine.length
                        ? mine
                            .map(
                              (p) =>
                                `Post ${p.rank}, ${p.place}, ${p.daysLabel} ${p.hours}`,
                            )
                            .join(" · ")
                        : "No posts this week"}
                    </span>
                  </span>
                  <span className="ee-display text-right text-[26px] normal-case">
                    {hrs ? `${hrs} h` : "—"}
                  </span>
                </div>
              );
            })}
          <span className="text-[13px] leading-[1.45] text-muted-foreground">
            No personal profiles. EarlyEye only needs a name, a shift and a duty
            phone to send each alert to the nearest person on duty.
          </span>
        </section>

        <section
          aria-labelledby="last-h"
          className="flex min-w-0 flex-[1_1_520px] flex-col gap-2.5 rounded-[2px] border border-line bg-white p-4"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="last-h" className="ee-display text-[30px]">
              Did last week&apos;s plan work?
            </h2>
            {reviewIsMock && (
              <span className={CHIP_DASHED}>SAMPLE · SYNTHETIC HISTORY</span>
            )}
          </div>
          <p className="text-[17px] font-bold leading-[1.45]">
            Last week the posts were covered on {rv.c} of {rv.p} planned days,
            and {plural(rv.n, "incident")} happened during post hours.
          </p>
          {review.map((r) => (
            <div
              key={r.location}
              className="flex flex-col gap-1 rounded-[2px] border border-line px-3 py-2.5"
            >
              <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1.5">
                <span className="text-[16px] font-extrabold">{r.location}</span>
                <span className="text-[13px] text-muted-foreground">
                  {r.assigned_to ?? "Nobody"} · covered {r.covered_days} of{" "}
                  {plural(r.planned_days, "day")}
                </span>
              </span>
              <span className="text-[15px] leading-[1.45]">
                {r.result ??
                  `${r.incidents_during_post === 0 ? "No incidents" : plural(r.incidents_during_post, "incident")} during post hours, against about ${Math.round(r.baseline_per_week * 4)} a month before the post.`}
              </span>
              <span className="text-[14px] font-extrabold text-signal-ink">
                {r.verdict}
              </span>
            </div>
          ))}
          <span className="text-[13px] text-muted-foreground">
            One week is too short to be sure. EarlyEye keeps counting every
            week.
          </span>
        </section>
      </div>
    </PageShell>
  );
}

function PostCard({
  post: p,
  posts,
  week,
  staff,
  assign,
  focused,
  choosing,
  incidentsHref,
  onLook,
  onAssign,
  onChoose,
  onMap,
}: {
  post: Post;
  posts: Post[];
  week: Week;
  staff: Staff[];
  assign: Record<string, string>;
  focused: boolean;
  choosing: boolean;
  incidentsHref: string;
  onLook: () => void;
  onAssign: (name: string | null) => void;
  onChoose: () => void;
  onMap: () => void;
}) {
  const who = assign[p.key];
  const g = who ? staff.find((s) => s.name === who) : undefined;
  const sug = suggest(p, posts, staff, assign);
  const byDay = p.days.map((d) => ({
    d: WEEKDAY_SHORT[d],
    n: p.hits.filter((x) => x.wd === d).length,
  }));
  // The plan's own sentence when its count matches the real incidents; else say it plainly.
  const why =
    p.slot.rationale && p.incidents === p.slot.incidents_4w
      ? `${p.slot.rationale.split(". ")[0].replace(/\.$/, "")}.`
      : `${plural(p.incidents, "incident")} here in the last 4 weeks, on ${
          p.days.length > 1 ? p.daysLabel : DAY_PLURAL[p.days[0]]
        } between ${p.hours.replace(/[–-]/, " and ")}.`;
  return (
    <article
      id={`post-${p.key}`}
      onClick={onLook}
      className={cn(
        "flex scroll-mt-4 flex-col gap-2.5 rounded-[2px] bg-white p-4",
        focused ? "border-2 border-ink" : "border border-line",
      )}
    >
      <div className="flex items-start gap-3">
        <span className="ee-display inline-flex size-10 flex-none items-center justify-center rounded-[2px] bg-signal text-[26px] text-white">
          {p.rank}
        </span>
        <span className="flex min-w-0 flex-auto flex-col gap-0.5">
          <h3 className="ee-display text-[28px] leading-none sm:text-[32px]">
            {p.place}
          </h3>
          <span className="text-[16px] font-bold">
            {p.daysLabel} · {p.hours} · {plural(p.hoursWeek, "hour")} this week
          </span>
        </span>
        <span
          className={cn(
            "flex-none rounded-[1px] px-[9px] py-[3px] text-[13px] font-extrabold",
            who
              ? "border border-ink bg-ink text-white"
              : "border-2 border-dashed border-ink bg-white text-ink",
          )}
        >
          {who ? "Covered" : "Nobody yet"}
        </span>
      </div>
      <p className="text-[16px] leading-[1.45]">{why}</p>
      <p className="text-[15px] font-bold leading-[1.45] text-signal-ink">
        Should prevent about {plural(p.prevent, "incident")} a month.
      </p>

      <div className="flex flex-col gap-1.5 border-t border-ground pt-2.5">
        <span className="ee-label text-[12px]">When it happened</span>
        <span className="flex flex-wrap gap-1.5">
          {p.hits.map((x) => (
            <Link
              key={x.id}
              href={`/incidents?id=${encodeURIComponent(x.id)}`}
              title={`${DAY_FULL[x.wd]} ${fmtDM(x.day)}, ${x.time}`}
              className="inline-flex min-h-[30px] items-center rounded-[2px] border border-line bg-white px-2 text-[13px] font-bold text-ink no-underline hover:border-ink"
            >
              {fmtWDM(x.day)}
            </Link>
          ))}
          {!p.hits.length && (
            <span className="text-[13px] text-muted-foreground">
              No confirmed incidents in the last 4 weeks.
            </span>
          )}
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-2">
          <span className="font-extrabold text-ink">By weekday</span>
          {byDay.map((b, i) => (
            <span key={b.d}>
              {b.d} <span className="font-extrabold text-ink">{b.n}</span>
              {i < byDay.length - 1 ? " ·" : ""}
            </span>
          ))}
        </span>
        <span className="text-[14px] font-bold">
          This week: {datesText(week, p.days)}
        </span>
      </div>

      <div className="flex flex-col gap-2.5 rounded-[2px] border border-line bg-raised p-3">
        <span className="ee-label text-[12px]">Who goes</span>
        {!choosing && who && (
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="inline-flex min-h-10 items-center gap-2 rounded-full bg-signal py-0 pl-1.5 pr-3 text-[15px] font-extrabold text-white">
              <span className="inline-flex size-7 items-center justify-center rounded-full bg-white text-[13px] text-signal">
                {initial(who)}
              </span>
              {who}
            </span>
            <span className="flex-[1_1_200px] text-[14px] text-ink-2">
              {g
                ? `${fitFor(g, p, posts, assign).note}. ${shiftText(g)}.`
                : "Not on this site's staff list."}
            </span>
            <button type="button" onClick={onChoose} className={BTN_QUIET}>
              Change
            </button>
          </div>
        )}
        {!choosing && !who && (
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={!sug}
              onClick={() => sug && onAssign(sug.name)}
              className="min-h-11 cursor-pointer rounded-[2px] bg-ink px-4 text-[15px] font-extrabold text-white disabled:cursor-not-allowed disabled:bg-ink-2"
            >
              {sug ? `Send ${sug.name}` : "Nobody is free"}
            </button>
            <span className="flex-[1_1_200px] text-[14px] text-ink-2">
              {sug
                ? `Suggested: on shift then${sug.zone_type === p.zoneType ? ", and already works nearby." : "."}`
                : "Nobody on the team is working then. Change a shift or skip this post."}
            </span>
            <button type="button" onClick={onChoose} className={BTN_QUIET}>
              Choose someone else
            </button>
          </div>
        )}
        {choosing && (
          <div
            className="flex flex-col gap-1.5"
            role="group"
            aria-label={`Who goes to post ${p.rank}`}
          >
            {staff.map((t) => {
              const f =
                t.name === who
                  ? { ok: true, note: "Going now" }
                  : fitFor(t, p, posts, assign);
              return (
                <button
                  key={t.name}
                  type="button"
                  disabled={!f.ok}
                  onClick={() => onAssign(t.name)}
                  className={cn(
                    "flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-[2px] border px-3 py-1.5 text-left text-[15px]",
                    f.ok
                      ? "cursor-pointer border-ink bg-white text-ink"
                      : "cursor-not-allowed border-line bg-ground text-muted-foreground",
                  )}
                >
                  <span className="min-w-[84px] font-extrabold">{t.name}</span>
                  <span className="text-[13px]">{f.note}</span>
                </button>
              );
            })}
            {who && (
              <button
                type="button"
                onClick={() => onAssign(null)}
                className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-3 rounded-[2px] border border-line-strong bg-white px-3 py-1.5 text-left text-[15px] text-ink"
              >
                <span className="min-w-[84px] font-extrabold">Nobody</span>
                <span className="text-[13px]">Leave this post empty</span>
              </button>
            )}
            <button
              type="button"
              onClick={onChoose}
              className={cn(BTN_QUIET, "self-start")}
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {p.slot.tip && (
        <p className="text-[14px] leading-[1.45] text-ink-2">
          <span className="font-extrabold text-ink">At the post: </span>
          {p.slot.tip}
        </p>
      )}
      <span className="flex flex-wrap gap-3.5 text-[14px] font-extrabold">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onMap();
          }}
          className="cursor-pointer text-signal underline-offset-2 hover:underline"
        >
          See it on the map
        </button>
        <Link href={incidentsHref} className="text-signal">
          See the {plural(p.incidents, "incident")}
        </Link>
      </span>
    </article>
  );
}

function DayPanel({
  wd,
  week,
  n,
  zoneName,
  hour,
  place,
  dates,
  posts,
  assign,
  onPost,
}: {
  wd: number;
  week: Week;
  n: number;
  zoneName?: string;
  hour: string | null;
  place: string | null;
  dates: string[];
  posts: Post[];
  assign: Record<string, string>;
  onPost: (key: string) => void;
}) {
  return (
    <div
      className="flex flex-col gap-2 rounded-[2px] border border-line bg-raised px-3.5 py-3"
      aria-live="polite"
    >
      <span className="text-[18px] font-extrabold">
        {`${DAY_PLURAL[wd]}: ${plural(n, "incident")} in the last 4 weeks${zoneName ? ` at the ${zoneName}` : ""}`}
      </span>
      {(hour || place) && (
        <span className="flex flex-wrap gap-x-[18px] gap-y-1.5 text-[15px]">
          {hour && (
            <span>
              <span className="font-extrabold">Busiest hour:</span> {hour}
            </span>
          )}
          {place && (
            <span>
              <span className="font-extrabold">Busiest place:</span> {place}
            </span>
          )}
        </span>
      )}
      <span className="ee-label text-[12px]">Dates</span>
      <span className="flex flex-wrap gap-1.5">
        {(dates.length ? dates : [`No incidents on ${DAY_PLURAL[wd]}`]).map(
          (d) => (
            <span
              key={d}
              className="inline-flex min-h-[30px] items-center rounded-[2px] border border-line bg-white px-2 text-[13px] font-bold"
            >
              {d}
            </span>
          ),
        )}
      </span>
      <span className="ee-label text-[12px]">
        {`This ${DAY_FULL[wd]}, ${fmtDM(week.days[wd])}`}
      </span>
      {posts.length ? (
        posts.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => onPost(p.key)}
            className="cursor-pointer text-left text-[15px] leading-[1.45] hover:underline"
          >
            {`Post ${p.rank}, ${p.place}, ${p.hours}: `}
            <span className="font-extrabold">
              {assign[p.key] ?? "nobody yet"}
            </span>
          </button>
        ))
      ) : (
        <span className="text-[15px] leading-[1.45]">
          {`No posts planned. EarlyEye found no repeat pattern on ${DAY_PLURAL[wd]}.`}
        </span>
      )}
    </div>
  );
}

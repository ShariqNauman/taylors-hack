"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import useSWR from "swr";
import {
  getCameras,
  getEvents,
  getHotspots,
  getPatrolPlan,
  getSite,
} from "@/lib/api";
import { useRouter } from "next/navigation";
import type { Camera, PatrolSlot } from "@/lib/types";
import {
  daysInclude,
  fmtBlackFor,
  fmtDayDate,
  fmtTime,
  heatColour,
  HEAT_RAMP,
  MYT_TZ,
  patrolHoursPerWeek,
  WEEKDAY_SHORT,
  zoneLabel,
} from "@/lib/format";
import { cameraKind } from "@/lib/camera-meta";
import { cn } from "@/lib/utils";
import { PageShell } from "@/components/chrome/page-shell";
import { Campus3D } from "@/components/campus3d";

const pad2 = (n: number) => String(n).padStart(2, "0");

function hourRange(hours: string): [number, number] | null {
  const m = hours.match(/(\d{1,2}):\d{2}\s*[–-]\s*(\d{1,2}):\d{2}/);
  return m ? [parseInt(m[1]), parseInt(m[2])] : null;
}

/** "Mon 12 Oct": the Monday after the plan was built. */
function weekOf(iso: string): string {
  const d = new Date(iso);
  const wd = new Intl.DateTimeFormat("en-GB", {
    timeZone: MYT_TZ,
    weekday: "short",
  }).format(d);
  const i = WEEKDAY_SHORT.indexOf(wd);
  const add = i <= 0 ? (i === 0 ? 0 : 1) : 7 - i;
  return fmtDayDate(new Date(d.getTime() + add * 86_400_000).toISOString());
}

export function PlanScreen() {
  const { data: plan } = useSWR("plan", getPatrolPlan, {
    revalidateOnFocus: false,
  });
  const { data: hotspots } = useSWR("hotspots", getHotspots, {
    revalidateOnFocus: false,
  });
  const { data: site } = useSWR("site", getSite, { revalidateOnFocus: false });
  const { data: cameras } = useSWR("cameras", getCameras, {
    refreshInterval: 30_000,
  });
  const { data: events } = useSWR(["events", "full"], () => getEvents(), {
    refreshInterval: 10_000,
  });
  const router = useRouter();
  const [zone, setZone] = useState<string>("all");
  const [sel, setSel] = useState<number | null>(null);

  const camFor = (loc: string): Camera | undefined =>
    cameras?.find((c) => c.location === loc);
  const slots = useMemo(
    () =>
      (plan?.slots ?? [])
        .slice()
        .sort(
          (a, b) => b.expected_avoided_per_week - a.expected_avoided_per_week,
        )
        .slice(0, 3)
        .map((s) => {
          const hw = patrolHoursPerWeek(s.days, s.hours);
          return {
            ...s,
            hoursWeek: hw,
            perHour:
              s.avoided_per_patrol_hour ?? s.expected_avoided_per_week / hw,
          };
        }),
    [plan],
  );
  const zones = site?.zones ?? [];
  const cells = useMemo(() => {
    const grid = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
    for (const h of hotspots ?? [])
      if (zone === "all" || h.zone_type === zone)
        grid[h.weekday][h.hour] += h.count;
    return grid;
  }, [hotspots, zone]);

  const selSlot = sel != null ? slots[sel] : null;
  const selRange = selSlot ? hourRange(selSlot.hours) : null;
  const outlined = (wd: number, hr: number) =>
    !!selSlot &&
    !!selRange &&
    daysInclude(selSlot.days, wd) &&
    hr >= selRange[0] &&
    hr < (selRange[1] || 24);

  const black = (cameras ?? []).filter((c) => cameraKind(c) === "black");
  const blackSlot = (c: Camera) =>
    slots.findIndex((s) => camFor(s.location)?.zone_type === c.zone_type);

  const hotspotRows = slots.map((s) => {
    const last = (hotspots ?? [])
      .filter((h) => h.location === s.location)
      .map((h) => h.last_seen)
      .sort()
      .pop();
    return { s, last };
  });

  const show = (i: number) => {
    setSel((cur) => (cur === i ? null : i));
    const zt = camFor(slots[i].location)?.zone_type;
    if (zt) setZone(zt);
    document.getElementById("heat-h")?.scrollIntoView({ block: "start" });
  };

  return (
    <PageShell>
      <div className="flex flex-col gap-2">
        <span className="ee-label text-[12px]">
          {plan
            ? `Patrol plan · week of ${weekOf(plan.generated_at)} · built ${fmtDayDate(plan.generated_at)} ${fmtTime(plan.generated_at, false)}`
            : "Patrol plan"}
        </span>
        <h1 className="ee-display text-[48px] sm:text-[60px]">
          Where to put people this week
        </h1>
        <p className="max-w-[900px] text-[18px] leading-normal text-ink-2">
          Three slots from the last four weeks of incidents. Ranked by incidents
          avoided per week; avoided per patrol hour sits beside it.
        </p>
      </div>

      <section
        aria-labelledby="map3d-h"
        className="flex flex-col gap-2.5 rounded-[2px] border border-line bg-white p-3.5"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="map3d-h" className="ee-display text-[28px]">
            This week on the campus
          </h2>
          <span className="font-mono text-[12px] text-muted-ink">
            BLUE PIN: WHERE TO STAND · COLUMN HEIGHT: INCIDENTS IN 4 WEEKS ·
            CLICK A POST
          </span>
        </div>
        {plan && site && cameras ? (
          <Campus3D
            mode="plan"
            cameras={cameras}
            site={site}
            events={events ?? []}
            plan={plan}
            onOpenCamera={(id) =>
              router.push(`/cameras?cam=${encodeURIComponent(id)}`)
            }
          />
        ) : (
          <div
            className="h-[560px] rounded-[2px] border border-line bg-raised"
            aria-busy="true"
          />
        )}
      </section>

      <section
        aria-label="Patrol slots"
        className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-3"
      >
        {!plan && (
          <p className="text-[15px] text-ink-2">Loading the patrol plan…</p>
        )}
        {slots.map((p, i) => (
          <SlotCard
            key={p.location}
            slot={p}
            rank={i + 1}
            pressed={sel === i}
            onShow={() => show(i)}
            cameraId={camFor(p.location)?.camera_id}
          />
        ))}
      </section>

      <div className="grid gap-3 min-[900px]:grid-cols-2">
        <div className="flex flex-col gap-1 rounded-[2px] border border-dashed border-ink bg-white p-3.5">
          <span className="ee-label">Assumption</span>
          <span className="text-[16px]">
            {plan?.assumption ??
              "60% of hotspot incidents are avoided when a person is present. Stated, not measured."}
          </span>
        </div>
        {black.map((c) => {
          const bi = blackSlot(c);
          return (
            <div
              key={c.camera_id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[2px] bg-ink p-3.5 text-white"
            >
              <span className="font-mono text-[11px] font-bold tracking-[0.08em]">
                NO SIGNAL
              </span>
              <span className="text-[16px]">
                {c.camera_id}, {c.location},{" "}
                {c.black_since
                  ? fmtBlackFor(c.black_since).toLowerCase()
                  : "no signal"}
                .
                {bi >= 0
                  ? ` Slot P/${pad2(bi + 1)} is the only eye on that block.`
                  : ""}
              </span>
              <Link
                href={`/cameras?cam=${encodeURIComponent(c.camera_id)}`}
                className="text-[15px] font-extrabold text-[#B7C4FF]"
              >
                Open the camera
              </Link>
            </div>
          );
        })}
      </div>

      <section
        aria-labelledby="heat-h"
        className="grid gap-3.5 min-[1100px]:grid-cols-[minmax(0,3fr)_minmax(280px,1fr)]"
      >
        <div className="flex min-w-0 flex-col gap-2.5 rounded-[2px] border border-line bg-white p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="heat-h" className="ee-display scroll-mt-24 text-[28px]">
              When and where incidents cluster
            </h2>
            <span className="font-mono text-[12px] text-muted-ink">
              INCIDENTS PER HOUR OF THE WEEK · LAST 4 WEEKS
            </span>
          </div>
          <div
            role="group"
            aria-label="Zone"
            className="flex flex-wrap gap-1.5"
          >
            {[{ zone_type: "all", label: "All zones" }, ...zones].map((z) => (
              <button
                key={z.zone_type}
                type="button"
                aria-pressed={zone === z.zone_type}
                onClick={() => setZone(z.zone_type)}
                className={cn(
                  "min-h-9 rounded-[2px] border px-3 text-[14px] font-bold",
                  zone === z.zone_type
                    ? "border-ink bg-ink text-white"
                    : "border-line-strong bg-white",
                )}
              >
                {z.label}
              </button>
            ))}
          </div>
          <div className="overflow-x-auto">
            <div
              className="grid min-w-[760px] gap-[2px]"
              style={{ gridTemplateColumns: "44px repeat(24, minmax(0, 1fr))" }}
              role="table"
              aria-label="Incidents per hour of the week"
            >
              <span />
              {Array.from({ length: 24 }, (_, h) => (
                <span
                  key={h}
                  className="text-center font-mono text-[10px] text-muted-ink"
                >
                  {pad2(h)}
                </span>
              ))}
              {cells.map((row, wd) => (
                <div key={wd} className="contents" role="row">
                  <span className="self-center font-mono text-[11px] font-bold uppercase">
                    {WEEKDAY_SHORT[wd]}
                  </span>
                  {row.map((n, hr) => {
                    const c = heatColour(n);
                    const out = outlined(wd, hr);
                    return (
                      <span
                        key={hr}
                        role="cell"
                        title={`${WEEKDAY_SHORT[wd]} ${pad2(hr)}:00–${pad2((hr + 1) % 24)}:00 · ${n} incident${n === 1 ? "" : "s"}${zone === "all" ? "" : ` · ${zoneLabel(site, zone)}`}`}
                        className="flex h-7 items-center justify-center rounded-[1px] font-mono text-[11px] font-bold"
                        style={{
                          background: c.bg,
                          color: c.fg,
                          outline: out
                            ? "2px solid #0B0D10"
                            : n
                              ? "none"
                              : "1px solid #EEF0F3",
                          outlineOffset: out ? "-1px" : "-1px",
                        }}
                      >
                        {n || ""}
                      </span>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[13px] text-ink-2">
            <span className="inline-flex items-center gap-1 font-mono">
              0
              {HEAT_RAMP.map((c) => (
                <span
                  key={c}
                  className="inline-block size-3.5 border border-line"
                  style={{ background: c }}
                />
              ))}
              5+
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block size-3.5 outline outline-2 outline-ink" />{" "}
              Selected slot
            </span>
            <span>Blue is a count, never a risk level.</span>
          </div>
        </div>
        <aside
          aria-labelledby="hot-h"
          className="flex flex-col gap-2.5 rounded-[2px] border border-line bg-white p-4"
        >
          <h2 id="hot-h" className="ee-display text-[28px]">
            Hotspots
          </h2>
          <p className="text-[14px] text-ink-2">
            3 or more incidents in one place, in the same hour of the week,
            within 4 weeks.
          </p>
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {hotspotRows.map(({ s, last }, i) => (
              <li
                key={s.location}
                className="grid grid-cols-[1fr_auto] gap-x-2 rounded-[2px] border border-line bg-raised p-2.5"
              >
                <span className="text-[15px] font-extrabold">
                  P/{pad2(i + 1)} · {s.location}
                </span>
                <span className="font-mono text-[18px] font-bold">
                  {s.incidents_4w}
                </span>
                <span className="col-span-2 font-mono text-[11px] uppercase text-muted-ink">
                  {s.days} {s.hours}
                  {last ? ` · last ${fmtDayDate(last)}` : ""}
                </span>
              </li>
            ))}
          </ol>
          <Link
            href="/incidents"
            className="text-[14px] font-extrabold text-signal"
          >
            Review the incidents behind these
          </Link>
        </aside>
      </section>
    </PageShell>
  );
}

function SlotCard({
  slot: p,
  rank,
  pressed,
  onShow,
  cameraId,
}: {
  slot: PatrolSlot & { hoursWeek: number; perHour: number };
  rank: number;
  pressed: boolean;
  onShow: () => void;
  cameraId?: string;
}) {
  const month = Math.round(p.expected_avoided_per_week * 4);
  return (
    <article
      className={cn(
        "flex flex-col gap-3 rounded-[2px] bg-white p-4",
        rank === 1 ? "border-2 border-ink" : "border border-line",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-[1px] bg-signal px-2 py-0.5 font-mono text-[13px] font-bold text-white">
          P/{pad2(rank)}
        </span>
        <span className="ee-label">Place one person at</span>
      </div>
      <h2 className="ee-display text-[36px]">{p.location}</h2>
      <div className="flex flex-wrap gap-1.5">
        <span className="rounded-[2px] bg-ink px-2.5 py-1 font-mono text-[14px] font-bold uppercase text-white">
          {p.days}
        </span>
        <span className="rounded-[2px] bg-ink px-2.5 py-1 font-mono text-[14px] font-bold text-white">
          {p.hours}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <div className="flex flex-col gap-0.5 rounded-[2px] border border-line bg-raised p-2.5">
          <span className="font-mono text-[24px] font-bold">
            {p.incidents_4w}
          </span>
          <span className="text-[12px] leading-tight text-ink-2">
            incidents in 4 weeks
          </span>
        </div>
        <div className="flex flex-col gap-0.5 rounded-[2px] border border-[#A9B6F2] bg-signal-tint p-2.5 text-signal-ink">
          <span className="font-mono text-[24px] font-bold">
            {p.expected_avoided_per_week.toFixed(2)}
          </span>
          <span className="text-[12px] leading-tight">
            avoided a week · ≈ {month} a month
          </span>
        </div>
        <div className="flex flex-col gap-0.5 rounded-[2px] border border-line bg-raised p-2.5">
          <span className="font-mono text-[24px] font-bold">
            {p.perHour.toFixed(2)}
          </span>
          <span className="text-[12px] leading-tight text-ink-2">
            avoided per patrol hour · {p.hoursWeek} h
          </span>
        </div>
      </div>
      <p className="text-[15px] leading-snug">{p.rationale}</p>
      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          aria-pressed={pressed}
          onClick={onShow}
          className={cn(
            "min-h-11 rounded-[2px] border px-3.5 text-[14px] font-extrabold",
            pressed ? "border-ink bg-ink text-white" : "border-ink bg-white",
          )}
        >
          {pressed ? "Shown on the heatmap" : "Show on the heatmap"}
        </button>
        <Link
          href={
            cameraId
              ? `/incidents?cam=${encodeURIComponent(cameraId)}`
              : "/incidents"
          }
          className="text-[14px] font-bold text-signal"
        >
          See the incidents behind this slot
        </Link>
      </div>
    </article>
  );
}

"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import useSWR from "swr";
import {
  getCameras,
  getEvents,
  getProof,
  getSite,
  patchCamera,
  usingMock,
} from "@/lib/api";
import type { Camera, Event, Proof } from "@/lib/types";
import { normaliseStatus } from "@/lib/format";
import {
  MODEL_CARD,
  MODEL_REPORT,
  TECH_ROWS,
  TECH_ROWS_MISSING,
  type TechRow,
} from "@/lib/model-report";
import { useAppStore } from "@/lib/store/app-store";
import { cn } from "@/lib/utils";
import { PageShell } from "@/components/chrome/page-shell";

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 28;
const MIN_DECISIONS = 10;
const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MYT = 8 * 3_600_000;

/** "1 Oct" / "Thu 1 Oct" in Malaysia time. */
const dm = (t: number) => {
  const d = new Date(t + MYT);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};
const wdm = (t: number) => `${WD[new Date(t + MYT).getUTCDay()]} ${dm(t)}`;
const hourOf = (iso: string) => new Date(Date.parse(iso) + MYT).getUTCHours();
const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const secs = (a?: string | null, b?: string | null) =>
  a && b ? (Date.parse(b) - Date.parse(a)) / 1000 : null;
const fmtS = (s: number) =>
  s < 90 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`;

const isAlarm = (e: Event) => e.level === "fight_likely" || e.level === "fight";
const isReal = (e: Event) => {
  const s = normaliseStatus(e.status);
  return s === "confirmed" || s === "resolved";
};
const isFalse = (e: Event) => normaliseStatus(e.status) === "dismissed";
/** A fight the desk confirmed as real while EarlyEye stayed at Tense: the alarm missed it. */
const isMiss = (e: Event) =>
  e.level === "tense" &&
  e.type === "fight" &&
  normaliseStatus(e.status) === "confirmed";

/** Plain reason for alerts the desk dismissed, by the most common incident type there. */
const CONFUSED_WHY: Record<Event["type"], string> = {
  play: "Sport and rough play look like fighting.",
  crowd: "Queues and groups look like a crowd gathering.",
  cornering: "People standing close look like someone being boxed in.",
  fight: "Fast, close movement, like play-fighting, looks like a fight.",
};

// ── Zone changes: PATCH /cameras/:id, else kept in this browser ──

const ZONES_KEY = "earlyeye.camera-zones.v1";
const zoneListeners = new Set<() => void>();
const readZones = () => {
  try {
    return localStorage.getItem(ZONES_KEY) ?? "{}";
  } catch {
    return "{}";
  }
};
function subscribeZones(cb: () => void) {
  zoneListeners.add(cb);
  return () => zoneListeners.delete(cb);
}
function writeZone(cameraId: string, zone: string | null) {
  let all: Record<string, string> = {};
  try {
    all = JSON.parse(readZones());
  } catch {}
  if (zone) all[cameraId] = zone;
  else delete all[cameraId];
  try {
    localStorage.setItem(ZONES_KEY, JSON.stringify(all));
  } catch {}
  zoneListeners.forEach((l) => l());
}

// ── Small pieces ──

function Dots({ on, label }: { on: number; label: [string, string] }) {
  return (
    <div
      className="flex flex-wrap gap-2"
      role="img"
      aria-label={`${on} of 10 ${label[0].toLowerCase()}`}
    >
      {Array.from({ length: 10 }, (_, i) => (
        <span
          key={i}
          title={i < on ? label[0] : label[1]}
          className={cn(
            "size-[30px] rounded-full border-[3px]",
            i < on ? "border-ink bg-ink" : "border-[#8B939E] bg-white",
          )}
        />
      ))}
    </div>
  );
}

function SectionHead({ n, title }: { n: number; title: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span className="inline-flex size-[34px] flex-none items-center justify-center rounded-full bg-ink text-[17px] font-extrabold text-white">
        {n}
      </span>
      <h2 className="ee-display text-[26px] leading-none sm:text-[30px]">
        {title}
      </h2>
    </div>
  );
}

function NotEnough({ n }: { n: number }) {
  return (
    <p className="rounded-[2px] border border-dashed border-line-strong bg-raised px-3.5 py-3 text-[15px] leading-[1.45]">
      <span className="font-extrabold">
        Not enough answers yet: {n} so far.
      </span>{" "}
      Answer Yes or No on alerts to build this.
    </p>
  );
}

const CARD =
  "flex min-w-0 flex-[1_1_560px] flex-col gap-3 rounded-[2px] border border-line bg-white p-4";
const CHIP_DASHED =
  "inline-flex min-h-7 items-center rounded-[2px] border border-dashed border-line-strong bg-white px-2 font-mono text-[11px] font-bold tracking-[0.06em] text-ink-2";

const LIMITS = [
  {
    icon: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3M4 4l16 16",
    k: "Hear words",
    v: "It sees bodies, not sound. Verbal or online bullying is out of reach.",
  },
  {
    icon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",
    k: "Night cameras",
    v: "Not tested on night-time or infrared video yet.",
  },
  {
    icon: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0M3 3l18 18",
    k: "Recognise people",
    v: "No face images, no names. The guard finds out who was involved.",
  },
  {
    icon: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM4 4l16 16",
    k: "See blind spots",
    v: "Only what a camera can see. Corners out of view stay dark.",
  },
  {
    icon: "M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z",
    k: "Arm-only fights",
    v: "Its known weak spot. A shove with little body movement can stay at Tense.",
  },
];

const PRIVACY = [
  {
    icon: "M3 11l9-7 9 7v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z",
    k: "Video stays on campus",
    v: "Footage never leaves the camera laptop. Only times and stick-figure data go online.",
  },
  {
    icon: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
    k: "No faces, no identities",
    v: "It tracks body points per person. Nose, eyes and ears count only as head position: no face images, no names.",
  },
  {
    icon: "M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14",
    k: "Clips delete themselves",
    v: "The 10-second clip for each alert stays on the camera laptop and is deleted automatically after a set number of days.",
  },
  {
    icon: "M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z",
    k: "Only your team sees it",
    v: "The desk, the supervisor and guards on duty. Nothing is public.",
  },
];

function IconCard({
  icon,
  k,
  v,
  tone,
}: {
  icon: string;
  k: string;
  v: string;
  tone: "grey" | "blue";
}) {
  return (
    <div className="flex items-start gap-2.5 rounded-[2px] border border-line px-3 py-2.5">
      <span
        className={cn(
          "inline-flex size-[34px] flex-none items-center justify-center rounded-full",
          tone === "blue" ? "bg-signal-tint" : "bg-ground",
        )}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d={icon}
            fill="none"
            stroke={tone === "blue" ? "#1F35B3" : "#3A414B"}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-[15px] font-extrabold">{k}</span>
        <span className="text-[13px] leading-[1.4] text-ink-2">{v}</span>
      </span>
    </div>
  );
}

// ── The screen ──

export function ProofScreen() {
  const { data: proof } = useSWR("proof", getProof, {
    revalidateOnFocus: false,
  });
  const { data: events } = useSWR(["events", "full"], () => getEvents(), {
    refreshInterval: 10_000,
  });
  const { data: cameras, mutate: mutateCameras } = useSWR(
    "cameras",
    getCameras,
    { refreshInterval: 30_000 },
  );
  const { data: site } = useSWR("site", getSite, { revalidateOnFocus: false });
  const apiDown = useAppStore((s) => s.apiDown);
  const synthetic = usingMock || apiDown;

  const zonesRaw = useSyncExternalStore(subscribeZones, readZones, () => "{}");
  const localZones = useMemo(() => {
    try {
      return JSON.parse(zonesRaw) as Record<string, string>;
    } catch {
      return {};
    }
  }, [zonesRaw]);
  const [savedOnApi, setSavedOnApi] = useState<Record<string, boolean>>({});
  const [share, setShare] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [tech, setTech] = useState(false);
  const [now] = useState(() => Date.now());

  const since = now - WINDOW_DAYS * DAY_MS;
  const recent = useMemo(
    () =>
      (events ?? []).filter((e) => {
        const t = Date.parse(e.start_time);
        return t >= since && t <= now;
      }),
    [events, since, now],
  );

  // ── The answer ──
  const alarms = recent.filter(isAlarm);
  const real = alarms.filter(isReal).length;
  const falseAlarms = alarms.filter(isFalse).length;
  const decided = real + falseAlarms;
  const enough = decided >= MIN_DECISIONS;
  const realShare = decided ? real / decided : 0;
  const realDots = Math.round(realShare * 10);
  const ack = median(
    alarms
      .map((e) => secs(e.pushed_at, e.acked_at))
      .filter((x): x is number => x != null && x >= 0),
  );
  const there = median(
    alarms
      .map((e) => secs(e.pushed_at, e.arrived_at))
      .filter((x): x is number => x != null && x >= 0),
  );
  const verdict = !enough
    ? "Too early to say."
    : realShare >= 0.8
      ? "Mostly, yes."
      : realShare >= 0.6
        ? "Usually, yes."
        : realShare >= 0.4
          ? "About half the time."
          : "Not yet.";
  const evidence = !enough
    ? `The desk has answered ${plural(decided, "alarm")} in the last 4 weeks. EarlyEye needs at least ${MIN_DECISIONS} answers before it gives a verdict.`
    : `${realDots} of every 10 alarms were real. There ${falseAlarms === 1 ? "was" : "were"} ${plural(falseAlarms, "false alarm")} in 4 weeks${ack != null ? `, and a guard was on the way in about ${fmtS(ack)}` : ""}.`;

  // ── 1. Misses ──
  const misses = recent
    .filter(isMiss)
    .sort((a, b) => Date.parse(b.start_time) - Date.parse(a.start_time));
  const testCaught = MODEL_REPORT.holdout.caught;
  const testDots = Math.round(testCaught * 10);

  // ── 2. Where it gets confused ──
  const sportsZone =
    site?.zones.find((z) => /sport/i.test(z.zone_type))?.zone_type ??
    "sports_court";
  const camZone = (c: Camera) => localZones[c.camera_id] ?? c.zone_type;
  const confused = useMemo(() => {
    const by = new Map<string, Event[]>();
    for (const e of recent.filter(isFalse))
      by.set(e.camera_id, [...(by.get(e.camera_id) ?? []), e]);
    return [...by.entries()]
      .map(([camera_id, list]) => {
        const types = new Map<Event["type"], number>();
        list.forEach((e) => types.set(e.type, (types.get(e.type) ?? 0) + 1));
        const top = [...types].sort((a, b) => b[1] - a[1])[0][0];
        const hours = new Map<number, number>();
        list.forEach((e) => {
          const h = hourOf(e.start_time);
          hours.set(h, (hours.get(h) ?? 0) + 1);
        });
        const busyHour = [...hours].sort((a, b) => b[1] - a[1])[0][0];
        const realHere = recent.filter(
          (e) => e.camera_id === camera_id && isReal(e),
        ).length;
        return {
          camera_id,
          place: list[0].location,
          n: list.length,
          top,
          busyHour,
          realHere,
        };
      })
      .sort((a, b) => b.n - a.n);
  }, [recent]);
  const maxConfused = Math.max(1, ...confused.map((c) => c.n));

  const toggleSports = async (cam: Camera) => {
    const original = cam.zone_type;
    const on = camZone(cam) === sportsZone;
    const next = on ? original : sportsZone;
    const ok = await patchCamera(cam.camera_id, { zone_type: next });
    if (ok) {
      writeZone(cam.camera_id, null);
      setSavedOnApi((s) => ({ ...s, [cam.camera_id]: true }));
      mutateCameras();
    } else {
      writeZone(cam.camera_id, on ? null : sportsZone);
      setSavedOnApi((s) => ({ ...s, [cam.camera_id]: false }));
    }
  };

  // ── 3. Getting better ──
  const weeks = Array.from({ length: 4 }, (_, i) => {
    const a = since + i * 7 * DAY_MS;
    const b = a + 7 * DAY_MS;
    return {
      label: i === 3 ? "Last 7 days" : `Week of ${dm(a)}`,
      n: recent.filter(
        (e) =>
          isFalse(e) &&
          Date.parse(e.start_time) >= a &&
          Date.parse(e.start_time) < b,
      ).length,
    };
  });
  const maxWeek = Math.max(1, ...weeks.map((w) => w.n));
  const trend =
    weeks[3].n < weeks[0].n
      ? `Down from ${weeks[0].n} to ${weeks[3].n}.`
      : weeks[3].n > weeks[0].n
        ? `Up from ${weeks[0].n} to ${weeks[3].n}.`
        : `Level at ${weeks[3].n} a week.`;

  // ── Summary for management ──
  const shareText = [
    `EarlyEye track record, ${site?.name ?? "our site"}, last 4 weeks (${dm(since)} to ${dm(now)}).`,
    enough
      ? `${plural(alarms.length, "alarm")} sounded; the security desk confirmed ${real} as real and ${falseAlarms} as false ${falseAlarms === 1 ? "alarm" : "alarms"}.`
      : `${plural(alarms.length, "alarm")} sounded, but the desk has answered only ${decided}, too few to judge accuracy yet.`,
    ack != null
      ? `Guards were on the way in about ${fmtS(ack)}${there != null ? ` and on the scene in about ${fmtS(there)}` : ""}.`
      : "",
    misses.length
      ? `${misses.length === 1 ? "One fight was" : `${misses.length} fights were`} reported that the system missed (latest: ${wdm(Date.parse(misses[0].start_time))}, ${misses[0].location}).`
      : "No missed fights were reported.",
    `Alerts the desk marked as nothing: ${weeks[0].n} in the first week, ${weeks[3].n} in the last.`,
    "In public test videos it never trained on, it caught about " +
      `${testDots} of every 10 fights. Video never leaves campus and the system does not identify anyone.`,
  ]
    .filter(Boolean)
    .join(" ");

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // clipboard blocked: the text is on screen to select by hand
    }
    setCopied(key);
  };

  // ── Technical table: GET /proof rows + REPORT rows + your campus ──
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const proofRows: TechRow[] = proof ? proofTechRows(proof) : [];
  const campusRow: TechRow = {
    test: "Your campus: the desk's Yes/No, last 4 weeks",
    means: "Real alarms against fights reported with no alarm",
    caught: enough
      ? `${real} of ${real + misses.length} (${pct(real / Math.max(1, real + misses.length))})`
      : null,
    flagged: enough ? `${plural(falseAlarms, "false alarm")}` : null,
    missing: enough ? undefined : "not measured yet",
    ref: "desk labels",
  };
  const techRows = [
    ...TECH_ROWS.slice(0, 1),
    {
      test: "Overall separation (clip AUC)",
      means: "1.0 is perfect, 0.5 is guessing",
      caught: MODEL_REPORT.holdout.auc.toFixed(3),
      flagged: "",
      ref: "V5.3",
    },
    ...proofRows,
    ...TECH_ROWS.slice(1),
    campusRow,
    ...TECH_ROWS_MISSING,
  ];

  return (
    <PageShell
      headerRight={
        synthetic ? (
          <span className={CHIP_DASHED}>SYNTHETIC HISTORY · 8 WEEKS</span>
        ) : undefined
      }
    >
      <div className="flex max-w-[1000px] flex-col gap-2">
        <span className="ee-label text-[12px]">
          Track record · last 4 weeks · from your desk&apos;s yes/no answers
        </span>
        <h1 className="ee-display text-[44px] leading-[0.95] sm:text-[58px]">
          Can you trust the alarms?
        </h1>
        <p className="text-[17px] leading-normal text-ink-2 sm:text-[19px]">
          Every time the desk answers &ldquo;Was this real?&rdquo;, EarlyEye
          learns how it is doing on your cameras. This page turns those answers
          into a track record you can check, act on and share with management.
        </p>
      </div>

      {/* ── The answer ── */}
      <section
        aria-label="The answer"
        className="flex flex-wrap items-center gap-x-8 gap-y-5 rounded-[2px] border-2 border-ink bg-white p-4 sm:p-5"
      >
        <div className="flex flex-[1_1_420px] flex-col gap-2.5">
          <span className="ee-display text-[40px] leading-[0.95] sm:text-[52px]">
            {verdict}
          </span>
          <span className="text-[17px] leading-normal sm:text-[19px]">
            {evidence}
          </span>
          <span className="mt-1 flex flex-wrap gap-2.5">
            <button
              type="button"
              aria-expanded={share}
              onClick={() => {
                setShare((s) => !s);
                setCopied(null);
              }}
              className="min-h-[46px] cursor-pointer rounded-[2px] bg-ink px-[18px] text-[16px] font-extrabold text-white"
            >
              {share ? "Hide the summary" : "Share with management"}
            </button>
          </span>
        </div>
        <div className="flex flex-[1_1_420px] flex-col gap-2.5">
          <span className="text-[15px] font-extrabold">
            Out of every 10 alarms that sounded
          </span>
          {enough ? (
            <>
              <Dots on={realDots} label={["Real", "False alarm"]} />
              <span className="flex flex-wrap gap-x-[18px] gap-y-1.5 text-[14px] text-ink-2">
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-4 rounded-full bg-ink" />
                  Real: the desk said yes
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-4 rounded-full border-[3px] border-[#8B939E]" />
                  False alarm
                </span>
              </span>
            </>
          ) : (
            <NotEnough n={decided} />
          )}
          <div className="mt-1.5 grid grid-cols-3 gap-2">
            {[
              { v: String(alarms.length), k: "alarms sounded" },
              { v: enough ? String(real) : "—", k: "were real" },
              { v: ack != null ? fmtS(ack) : "—", k: "guard on the way" },
            ].map((h) => (
              <div
                key={h.k}
                className="flex flex-col gap-0.5 rounded-[2px] border border-line px-3 py-2.5"
              >
                <span
                  className="ee-display text-[30px] leading-none"
                  style={{ textTransform: "none" }}
                >
                  {h.v}
                </span>
                <span className="text-[13px] text-ink-2">{h.k}</span>
              </div>
            ))}
          </div>
        </div>
        {share && (
          <div className="flex basis-full flex-col gap-2.5 rounded-[2px] border border-line bg-raised px-3.5 py-3">
            <span className="ee-label text-[12px]">Summary for management</span>
            <p className="text-[16px] leading-[1.55]">{shareText}</p>
            <span className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => copy("share", shareText)}
                className="min-h-10 cursor-pointer rounded-[2px] bg-signal px-3.5 text-[14px] font-extrabold text-white"
              >
                Copy summary
              </button>
              <span
                className="text-[14px] font-bold text-signal-ink"
                aria-live="polite"
              >
                {copied === "share"
                  ? "Copied. Paste it into your email or report."
                  : ""}
              </span>
            </span>
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-stretch gap-4">
        {/* ── 1. Misses ── */}
        <section aria-labelledby="miss-h" className={CARD}>
          <span id="miss-h" className="contents">
            <SectionHead n={1} title="Does it miss fights?" />
          </span>
          <div className="flex flex-wrap gap-4">
            <div className="flex flex-[1_1_240px] flex-col gap-2">
              <span className="text-[15px] font-extrabold">
                In public test videos
              </span>
              <Dots on={testDots} label={["Caught", "Missed"]} />
              <span className="text-[15px] leading-[1.45]">
                It caught{" "}
                <span className="font-extrabold">
                  about {testDots} of every 10 fights
                </span>{" "}
                ({(testCaught * 100).toFixed(1)}% of{" "}
                {MODEL_REPORT.holdout.clips} held-out clips). These are videos
                it never trained on.
              </span>
            </div>
            <div className="flex flex-[1_1_240px] flex-col gap-2">
              <span className="text-[15px] font-extrabold">On your campus</span>
              <span
                className="ee-display text-[40px] leading-none"
                style={{ textTransform: "none" }}
              >
                {misses.length} reported
              </span>
              <span className="text-[15px] leading-[1.45]">
                A miss only shows up when the desk marks a fight as real that
                never reached an alarm.{" "}
                {misses.length === 0
                  ? "None in 4 weeks."
                  : misses.length === 1
                    ? "That happened once in 4 weeks."
                    : `That happened ${misses.length} times in 4 weeks.`}
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-1 rounded-[2px] border border-line bg-raised px-3.5 py-3">
            {misses[0] ? (
              <span className="text-[15px] font-extrabold">
                {wdm(Date.parse(misses[0].start_time))} · {misses[0].location}
              </span>
            ) : null}
            <span className="text-[15px] leading-[1.45]">
              {misses[0]?.staff_note ? `${misses[0].staff_note} ` : ""}
              <span className="font-extrabold">Known weak spot:</span> fights
              where mostly the arms move, with little whole-body movement. Found
              on the earlier model; not yet re-checked on this one.
            </span>
          </div>
        </section>

        {/* ── 2. Confused ── */}
        <section aria-labelledby="conf-h" className={CARD}>
          <span id="conf-h" className="contents">
            <SectionHead n={2} title="Where does it get confused?" />
          </span>
          <span className="text-[15px] text-ink-2">
            Alerts the desk said were nothing, by place. Fix the biggest one
            first.
          </span>
          {confused.length === 0 && (
            <p className="text-[15px]">
              The desk hasn&apos;t marked any alert as nothing in 4 weeks.
            </p>
          )}
          {confused.map((c) => {
            const cam = cameras?.find((x) => x.camera_id === c.camera_id);
            const isSports = cam ? camZone(cam) === sportsZone : false;
            const wasSports =
              cam?.zone_type === sportsZone && !localZones[c.camera_id];
            const action: "sports" | "keep" | "ask" | "none" =
              c.top === "play" && cam && !wasSports
                ? "sports"
                : c.realHere >= 3
                  ? "keep"
                  : c.n >= 2
                    ? "ask"
                    : "none";
            const askText = `Please look at ${c.place} (${c.camera_id}): the desk marked ${plural(c.n, "alert")} as nothing in the last 4 weeks, mostly ${c.top === "crowd" ? "crowd gatherings" : c.top} around ${String(c.busyHour).padStart(2, "0")}:00. Can you quiet these without missing real fights?`;
            return (
              <div
                key={c.camera_id}
                className="flex flex-col gap-2 rounded-[2px] border border-line px-3 py-2.5"
              >
                <span className="flex flex-wrap items-center gap-2.5">
                  <span className="min-w-[170px] text-[16px] font-extrabold">
                    {c.place}
                  </span>
                  <span className="flex flex-[1_1_160px] items-center gap-2.5">
                    <span className="h-4 flex-1 overflow-hidden rounded-[1px] bg-ground">
                      <span
                        className="block h-full bg-[#8B939E]"
                        style={{ width: `${(c.n / maxConfused) * 100}%` }}
                      />
                    </span>
                    <span className="ee-display min-w-7 text-right text-[24px]">
                      {c.n}
                    </span>
                  </span>
                </span>
                <span className="text-[14px] leading-[1.45] text-ink-2">
                  {CONFUSED_WHY[c.top]}
                </span>
                <span className="flex flex-wrap items-center gap-2.5">
                  {action === "sports" && cam && (
                    <>
                      <button
                        type="button"
                        aria-pressed={isSports}
                        onClick={() => toggleSports(cam)}
                        className={cn(
                          "min-h-[38px] cursor-pointer rounded-[2px] px-3 text-[14px] font-extrabold",
                          isSports
                            ? "border border-signal bg-white text-signal-ink"
                            : "bg-ink text-white",
                        )}
                      >
                        {isSports
                          ? "Sports zone on · undo"
                          : "Make it a sports zone"}
                      </button>
                      <span className="flex-[1_1_240px] text-[13px] font-bold text-signal-ink">
                        {isSports
                          ? `${savedOnApi[cam.camera_id] ? "Saved" : "Saved on this computer only"}. This camera now counts as a sports zone, which is lower risk. Real fights still sound the alarm.`
                          : "Sports zones count as lower risk. Real fights still sound the alarm."}
                      </span>
                    </>
                  )}
                  {action === "ask" && (
                    <>
                      <button
                        type="button"
                        onClick={() => copy(c.camera_id, askText)}
                        className="min-h-[38px] cursor-pointer rounded-[2px] border border-line-strong bg-white px-3 text-[14px] font-extrabold text-ink"
                      >
                        Copy a request
                      </button>
                      <span className="flex-[1_1_240px] text-[13px] font-bold text-signal-ink">
                        {copied === c.camera_id
                          ? "Copied. Send it to the EarlyEye team."
                          : `Ask the EarlyEye team to quiet ${c.top === "crowd" ? "crowd alerts" : "these alerts"} here around ${String(c.busyHour).padStart(2, "0")}:00.`}
                      </span>
                    </>
                  )}
                  {action === "keep" && (
                    <span className="text-[13px] font-bold text-signal-ink">
                      Keep as is. This is one of your busiest real hotspots (
                      {plural(c.realHere, "real incident")} in 4 weeks).
                    </span>
                  )}
                  {action === "none" && (
                    <span className="text-[13px] font-bold text-signal-ink">
                      Keep as is. Nothing to change for one alert.
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </section>
      </div>

      <div className="flex flex-wrap items-stretch gap-4">
        {/* ── 3. Getting better ── */}
        <section aria-labelledby="better-h" className={CARD}>
          <span id="better-h" className="contents">
            <SectionHead n={3} title="Is it getting better?" />
          </span>
          <span className="text-[15px] text-ink-2">
            Alerts the desk said were nothing, week by week
          </span>
          <div className="flex h-[140px] items-end gap-3.5 border-b-2 border-ink pt-6">
            {weeks.map((w, i) => (
              <span
                key={w.label}
                className={cn(
                  "relative flex-1 rounded-t-[1px]",
                  i === 3 ? "bg-signal" : "bg-[#C9CED6]",
                )}
                style={{ height: `${Math.max(2, (w.n / maxWeek) * 100)}%` }}
              >
                <span className="ee-display absolute inset-x-0 -top-6 text-center text-[22px]">
                  {w.n}
                </span>
              </span>
            ))}
          </div>
          <div className="-mt-1.5 flex gap-3.5">
            {weeks.map((w, i) => (
              <span
                key={w.label}
                className={cn(
                  "flex-1 text-center text-[13px] text-ink-2",
                  i === 3 ? "font-extrabold" : "font-medium",
                )}
              >
                {w.label}
              </span>
            ))}
          </div>
          <span className="text-[15px] leading-[1.45]">
            <span className="font-extrabold">{trend}</span> Each Yes/No the desk
            answers is saved as a label for that camera, and the labels are used
            to retune that camera
            {weeks[3].n < weeks[0].n
              ? ", so the same mistake gets rarer."
              : ". One month is too short to see a trend."}
          </span>
        </section>

        {/* ── 4. Speed ── */}
        <section aria-labelledby="speed-h" className={CARD}>
          <span id="speed-h" className="contents">
            <SectionHead n={4} title="How fast does it react?" />
          </span>
          <div className="mt-1 grid grid-cols-2 gap-y-4 sm:flex">
            {[
              { t: "0 s", what: "A fight starts", dot: "#FFFFFF" },
              {
                t: "Alarm",
                what: `Not timed for this model yet. It needs the fight score to hold for ${MODEL_REPORT.holdS.value} s.`,
                dot: "#C8241B",
              },
              {
                t: ack != null ? `+${fmtS(ack)}` : "—",
                what:
                  ack != null
                    ? 'after the alarm: guard taps "On my way"'
                    : "On my way: no phone answers yet",
                dot: "#2742D9",
              },
              {
                t: there != null ? `+${fmtS(there)}` : "—",
                what:
                  there != null
                    ? "after the alarm: guard is there"
                    : "Guard is there: not measured yet",
                dot: "#0B0D10",
                last: true,
              },
            ].map((sp) => (
              <div key={sp.what} className="flex flex-1 flex-col gap-1.5 pr-2">
                <span className="flex items-center">
                  <span
                    className="size-[18px] flex-none rounded-full border-2 border-ink"
                    style={{ background: sp.dot }}
                  />
                  <span
                    className={cn("h-[3px] flex-1", sp.last ? "" : "bg-ink")}
                  />
                </span>
                <span
                  className="ee-display text-[26px] leading-none"
                  style={{ textTransform: "none" }}
                >
                  {sp.t}
                </span>
                <span className="text-[14px] leading-[1.4]">{sp.what}</span>
              </div>
            ))}
          </div>
          <span className="text-[14px] leading-[1.45] text-ink-2">
            Guard times are medians from the guards&apos; phones on your campus
            over the last 4 weeks.{" "}
            <span className="font-extrabold">
              Warning before a fight starts: not measured yet.
            </span>{" "}
            We will time it on our own recorded clips before claiming it.
          </span>
        </section>
      </div>

      <div className="flex flex-wrap items-stretch gap-4">
        {/* ── 5. Limits ── */}
        <section aria-labelledby="limits-h" className={CARD}>
          <span id="limits-h" className="contents">
            <SectionHead n={5} title="What can't it do?" />
          </span>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-2">
            {LIMITS.map((l) => (
              <IconCard key={l.k} {...l} tone="grey" />
            ))}
          </div>
        </section>

        {/* ── 6. Privacy ── */}
        <section aria-labelledby="privacy-h" className={CARD}>
          <span id="privacy-h" className="contents">
            <SectionHead n={6} title="Is it safe for students’ privacy?" />
          </span>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-2">
            {PRIVACY.map((p) => (
              <IconCard key={p.k} {...p} tone="blue" />
            ))}
          </div>
        </section>
      </div>

      {/* ── Technical details ── */}
      <section
        aria-label="Technical details"
        className="flex flex-col gap-3 rounded-[2px] border border-line bg-raised px-4 py-3.5"
      >
        <button
          type="button"
          aria-expanded={tech}
          onClick={() => setTech((t) => !t)}
          className="flex cursor-pointer items-center justify-between gap-2.5 text-left text-ink"
        >
          <span className="flex flex-col gap-0.5">
            <span className="ee-label text-[12px]">
              For IT teams and judges
            </span>
            <span className="text-[20px] font-extrabold">
              Technical details: how the model was tested
            </span>
            <span className="text-[14px] text-ink-2">
              Test results on public videos next to your campus, the model card
              and known weaknesses.
            </span>
          </span>
          <span className="text-[15px] font-extrabold text-signal">
            {tech ? "Hide" : "Show"}
          </span>
        </button>
        {tech && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border border-line bg-white text-left">
                <thead>
                  <tr className="bg-ground font-mono text-[12px] font-bold">
                    <th className="w-[34%] px-2.5 py-2">TEST</th>
                    <th className="w-[30%] px-2.5 py-2">WHAT IT MEANS</th>
                    <th className="px-2.5 py-2">FIGHTS CAUGHT</th>
                    <th className="px-2.5 py-2">CALM CLIPS FLAGGED</th>
                  </tr>
                </thead>
                <tbody>
                  {techRows.map((t) => (
                    <tr
                      key={t.test}
                      className="border-t border-ground align-top"
                    >
                      <td className="px-2.5 py-2 text-[14px] font-bold">
                        {t.test}
                        <span className="ml-1.5 font-mono text-[11px] font-normal text-muted-foreground">
                          {t.ref}
                        </span>
                      </td>
                      <td className="px-2.5 py-2 text-[13px] text-ink-2">
                        {t.means}
                      </td>
                      {[t.caught, t.flagged].map((v, i) => (
                        <td
                          key={i}
                          className={cn(
                            "px-2.5 py-2 font-mono text-[14px] font-bold",
                            t.missing ? "text-muted-foreground" : "text-ink",
                          )}
                        >
                          {t.missing ? t.missing : (v ?? "—")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-2.5">
              {MODEL_CARD.map((k) => (
                <div
                  key={k.k}
                  className="flex flex-col gap-[3px] rounded-[2px] border border-line bg-white px-3 py-2.5"
                >
                  <span className="font-mono text-[12px] font-bold text-muted-foreground">
                    {k.k}
                  </span>
                  <span className="text-[14px] leading-[1.45]">{k.v}</span>
                </div>
              ))}
            </div>
            <span className="text-[13px] leading-normal text-muted-foreground">
              Lesson from practice: 100% on KTH clips, then zero on a live
              camera until retuned. That is why the campus numbers above come
              from your desk&apos;s answers, not from a test set. Section
              numbers refer to model/REPORT.md.
            </span>
          </>
        )}
      </section>
    </PageShell>
  );
}

/** Rows that come from GET /proof: the phone-video and CCTV hold-out sets. */
function proofTechRows(p: Proof): TechRow[] {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const cctv = p.cctv_domain;
  const phoneSets = p.datasets.filter((d) => !cctv?.datasets.includes(d));
  const rows: TechRow[] = [
    {
      test: `Phone videos (${phoneSets.join(" + ")}), held out`,
      means: `AUC ${p.clip_auc.toFixed(3)}; of the alarms, ${pct(p.clip_precision)} were real fights`,
      caught: pct(p.clip_recall),
      flagged: null,
      ref: "/proof",
    },
  ];
  if (cctv)
    rows.push({
      test: `CCTV angle (${cctv.datasets.join(" + ")}), held out`,
      means: `High, wide cameras. AUC ${cctv.auc.toFixed(3)}. Other CCTV clips were in training; with none at all, AUC was ${MODEL_REPORT.cctvPureAuc.value}`,
      caught: pct(cctv.recall),
      flagged: null,
      ref: "/proof",
    });
  return rows;
}

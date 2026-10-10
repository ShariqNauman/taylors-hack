"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { getProof } from "@/lib/api";
import type { PoseFrame, Proof } from "@/lib/types";
import { fmtPct } from "@/lib/format";
import { MODEL_REPORT } from "@/lib/model-report";
import { cn } from "@/lib/utils";
import { PageShell } from "@/components/chrome/page-shell";
import { CameraFrame, SkeletonView } from "@/components/skeleton/skeleton-view";

const NM = "not measured";

/** What is measured, per brief §6.5: a metric is "not measured" when its source is missing. */
function measured(p: Proof) {
  return {
    lead: p.lead_time_s.length > 0,
    ownFootage: p.own_footage_minutes > 0,
    cctv: !!p.cctv_domain,
    ir: p.ir_check.frames > 0,
    live: p.live_recall != null || p.live_precision != null,
    fa: p.fa_per_camera_hour != null && p.own_footage_minutes > 0,
    latency: p.latency_ms > 0,
  };
}

export function ProofScreen() {
  const { data: proof, error } = useSWR("proof", getProof, {
    revalidateOnFocus: false,
  });
  const [cardOpen, setCardOpen] = useState(false);

  if (!proof) {
    return (
      <PageShell
        kicker="Evidence · what is proven, what is not"
        title="Can we prove it?"
      >
        <p className="text-[15px] text-ink-2">
          {error
            ? "Could not load the proof numbers."
            : "Loading the proof numbers…"}
        </p>
      </PageShell>
    );
  }
  const m = measured(proof);
  const R = MODEL_REPORT;
  const placeholder = proof.note === "placeholder";
  const partly =
    !!proof.note && proof.note !== "placeholder" && proof.note !== "report-v2";

  const proven: { k: string; v: string; sub: string; strong?: boolean }[] = [
    {
      k: "CLIP ROC-AUC",
      v: proof.clip_auc.toFixed(3),
      sub: `Phone-video sets (${proof.datasets.filter((d) => !proof.cctv_domain?.datasets.includes(d)).join(" + ")}), out-of-fold, split by video. Best of 12 settings, so slightly optimistic.`,
      strong: true,
    },
    {
      k: "WHEN IT ALARMS, IT IS RIGHT",
      v: fmtPct(proof.clip_precision),
      sub: `Precision with the 1 s hold. It catches ${fmtPct(proof.clip_recall)} of fight clips (recall).`,
    },
    {
      k: "LIVE LOGIC REPLAY",
      v: fmtPct(R.liveLogicViolent.value),
      sub: `Violent clips that reach fight with the live thresholds, on all ${R.allDatasetsAuc.clips.toLocaleString("en")} clips. Non-violent: ${fmtPct(R.liveLogicNonViolent.value)}.`,
    },
  ];
  if (m.cctv && proof.cctv_domain)
    proven.push({
      k: "CCTV ANGLE, HELD OUT",
      v: proof.cctv_domain.auc.toFixed(3),
      sub: `${proof.cctv_domain.datasets.join(" + ")}, never seen in training. Precision ${fmtPct(proof.cctv_domain.precision)}, recall ${fmtPct(proof.cctv_domain.recall)}. The hardest domain.`,
    });
  if (proof.airtlab_fp_rate > 0)
    proven.push({
      k: "HUGS AND CLAPS FLAGGED",
      v: fmtPct(proof.airtlab_fp_rate),
      sub: "AIRTLab hug, clap and high-five clips that raise an alarm with the 1 s hold. The known weak spot.",
    });
  if (m.latency)
    proven.push({
      k: "LATENCY PER WINDOW",
      v: `${proof.latency_ms} ms`,
      sub: "Pose 22 + features 15 + LightGBM about 1 ms, on the demo laptop.",
    });
  if (m.lead) {
    const mean =
      proof.lead_time_s.reduce((a, b) => a + b, 0) / proof.lead_time_s.length;
    proven.push({
      k: "LEAD TIME BEFORE THE SHOVE",
      v: `${mean.toFixed(1)} s`,
      sub: `Mean over ${proof.lead_time_s.length} escalation clips filmed in the venue.`,
    });
  }
  if (m.ownFootage && proof.fa_per_camera_hour != null)
    proven.push({
      k: "FALSE ALARMS PER CAMERA-HOUR",
      v: proof.fa_per_camera_hour.toFixed(1),
      sub: `On ${proof.own_footage_minutes} min of our own normal footage.`,
    });
  if (m.ir)
    proven.push({
      k: "NIGHT AND IR",
      v: `${proof.ir_check.skeletons_detected}/${proof.ir_check.frames}`,
      sub: proof.ir_check.note,
    });

  const gaps = [
    !m.lead && {
      k: "LEAD TIME BEFORE THE SHOVE",
      need: 'Needs 5 escalation clips filmed in the venue. This is the "predict early" proof.',
    },
    !m.ownFootage && {
      k: "FALSE ALARMS PER CAMERA-HOUR",
      need: "Needs a labelled session on our own camera (live_detector.py --log, then tune_live.py).",
    },
    !m.live && {
      k: "LIVE-ROOM ACCURACY",
      need: "Needs our own labelled fights and hugs in the venue. Dataset clips are 2–5 s long; a camera is continuous.",
    },
    !m.cctv && {
      k: "CCTV-ANGLE ROW",
      need: "Needs keypoints from a CCTV-angle set, held out from training.",
    },
    !m.ir && {
      k: "NIGHT AND IR",
      need: "Needs one real IR frame through the pose model.",
    },
  ].filter(Boolean) as { k: string; need: string }[];

  return (
    <PageShell>
      <div className="flex flex-col gap-2">
        <span className="ee-label text-[12px]">
          Evidence · what is proven, what is not
        </span>
        <h1 className="ee-display text-[52px] sm:text-[60px]">
          Can we prove it?
        </h1>
        <p className="max-w-[900px] text-[18px] leading-normal text-ink-2">
          Proven numbers on the left, honest gaps on the right. A dataset score
          says nothing about your camera until we measure it there.
        </p>
      </div>

      {placeholder ? (
        <div className="rounded-[2px] border-2 border-tense-line bg-tense-tint px-3.5 py-2.5 text-[15px] font-bold text-tense-fg">
          PLACEHOLDER NUMBERS · Model B has not published proof.json yet.
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 rounded-[2px] border border-line bg-white px-3.5 py-2.5">
          <span className="rounded-[1px] bg-ink px-2.5 py-1 font-mono text-[12px] font-bold tracking-[0.08em] text-white">
            SOURCE: MODEL/PROOF.JSON · REPORT {R.version.toUpperCase()}
          </span>
          <span className="text-[15px]">
            Dataset numbers are real, from {proof.n_clips.toLocaleString("en")}{" "}
            public clips. Live room, lead time and night are not measured yet,
            and this page says so.
          </span>
          {partly && (
            <span className="w-full font-mono text-[12px] text-muted-ink">
              MODEL NOTE: {proof.note}
            </span>
          )}
        </div>
      )}

      <div className="grid gap-3.5 min-[1100px]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-labelledby="proven-h" className="flex flex-col gap-2.5">
          <h2 id="proven-h" className="ee-display text-[28px]">
            Proven on public clips
          </h2>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2.5">
            {proven.map((t) => (
              <div
                key={t.k}
                className={cn(
                  "flex flex-col gap-1.5 rounded-[2px] bg-white p-4",
                  t.strong ? "border-2 border-ink" : "border border-line",
                )}
              >
                <span className="ee-label">{t.k}</span>
                <span className="font-mono text-[40px] font-bold leading-none">
                  {t.v}
                </span>
                <span className="text-[13px] leading-snug text-ink-2">
                  {t.sub}
                </span>
              </div>
            ))}
          </div>
          {m.lead && <LeadStrip leads={proof.lead_time_s} />}
        </section>
        <section aria-labelledby="gap-h" className="flex flex-col gap-2.5">
          <h2 id="gap-h" className="ee-display text-[28px]">
            Not measured yet
          </h2>
          {gaps.length ? (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2.5">
              {gaps.map((g) => (
                <div
                  key={g.k}
                  className="ee-hatch flex flex-col gap-1.5 rounded-[2px] border border-dashed border-line-strong bg-white p-4"
                >
                  <span className="ee-label">{g.k}</span>
                  <span className="font-mono text-[18px] font-bold uppercase">
                    {NM}
                  </span>
                  <span className="text-[13px] leading-snug text-ink-2">
                    {g.need}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[15px] text-ink-2">
              Every metric on this page has a source.
            </p>
          )}
        </section>
      </div>

      <Inspector />

      <section
        aria-label="Explain"
        className="grid gap-3.5 min-[1000px]:grid-cols-2"
      >
        <div className="flex flex-col gap-2.5 rounded-[2px] border border-line bg-white p-4">
          <h2 className="ee-display text-[28px]">What the model leans on</h2>
          <span className="text-[14px] text-ink-2">
            Share of LightGBM gain. This is where the reason sentence on each
            alert comes from.
          </span>
          <div className="flex flex-col gap-2" role="list">
            {R.featureGain.map((f) => (
              <div
                key={f.name}
                role="listitem"
                className="grid grid-cols-[minmax(0,180px)_1fr_auto] items-center gap-2.5"
              >
                <span className="truncate font-mono text-[13px]">{f.name}</span>
                <span
                  className="relative h-3 rounded-[1px] bg-raised"
                  aria-hidden
                >
                  <span
                    className="absolute inset-y-0 left-0 rounded-[1px] bg-signal"
                    style={{
                      width: `${(f.share / R.featureGain[0].share) * 100}%`,
                    }}
                  />
                </span>
                <span className="w-12 text-right font-mono text-[14px] font-bold">
                  {f.label}
                </span>
              </div>
            ))}
          </div>
          <span className="text-[14px] font-bold">
            Whole-body motion of the active pair carries a third of the weight,
            less dominated by one feature than v2 (47%).
          </span>
        </div>
        <div className="flex flex-col gap-2.5 rounded-[2px] border border-line bg-white p-4">
          <h2 className="ee-display text-[28px]">Dataset against live room</h2>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-[15px]">
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className="ee-label py-2 pr-3">
                    Test
                  </th>
                  <th scope="col" className="ee-label py-2 pr-3">
                    Fights caught
                  </th>
                  <th scope="col" className="ee-label py-2 pr-3">
                    Alarm is right
                  </th>
                  <th scope="col" className="ee-label py-2">
                    Calm flagged
                  </th>
                </tr>
              </thead>
              <tbody className="[&_td]:py-2 [&_td]:pr-3 [&_td]:font-mono [&_th]:py-2 [&_th]:pr-3 [&_th]:font-bold [&_tr]:border-b [&_tr]:border-line">
                <tr>
                  <th scope="row">Phone-video clips, split by video</th>
                  <td>{fmtPct(proof.clip_recall)}</td>
                  <td>{fmtPct(proof.clip_precision)}</td>
                  <td>—</td>
                </tr>
                <tr>
                  <th scope="row">CCTV angle, held out</th>
                  <td className={cn(!m.cctv && "ee-hatch text-ink-2")}>
                    {proof.cctv_domain ? fmtPct(proof.cctv_domain.recall) : NM}
                  </td>
                  <td className={cn(!m.cctv && "ee-hatch text-ink-2")}>
                    {proof.cctv_domain
                      ? fmtPct(proof.cctv_domain.precision)
                      : NM}
                  </td>
                  <td>—</td>
                </tr>
                <tr>
                  <th scope="row">Live thresholds replayed on all clips</th>
                  <td>{fmtPct(R.liveLogicViolent.value)}</td>
                  <td>—</td>
                  <td>{fmtPct(R.liveLogicNonViolent.value)}</td>
                </tr>
                <tr>
                  <th scope="row">AIRTLab hugs and claps</th>
                  <td>—</td>
                  <td>—</td>
                  <td>{fmtPct(proof.airtlab_fp_rate)}</td>
                </tr>
                <tr>
                  <th scope="row">Our venue, live camera</th>
                  <td className={cn(!m.live && "ee-hatch text-ink-2")}>
                    {m.live ? fmtPct(proof.live_recall) : NM}
                  </td>
                  <td className={cn(!m.live && "ee-hatch text-ink-2")}>
                    {m.live ? fmtPct(proof.live_precision) : NM}
                  </td>
                  <td className={cn(!m.fa && "ee-hatch text-ink-2")}>
                    {m.fa
                      ? `${proof.fa_per_camera_hour.toFixed(1)} / cam-h`
                      : NM}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-1 rounded-[2px] bg-ink p-3 text-white">
            <span className="font-mono text-[11px] font-bold tracking-[0.08em]">
              LESSON
            </span>
            <span className="text-[15px]">
              Practice run: 100% on KTH, zero live until retuned. Dataset clips
              are 2–5 s long; a continuous camera is not. Trained without
              YouTube-style footage, the model over-fires on it: domain shift is
              why thresholds must be tuned on our own camera.
            </span>
          </div>
        </div>
      </section>

      <section
        aria-label="Limits"
        className="grid gap-3.5 min-[1000px]:grid-cols-3"
      >
        <div className="flex flex-col gap-2 rounded-[2px] border border-line bg-white p-4">
          <h2 className="ee-display text-[24px]">Known weaknesses</h2>
          <ol className="m-0 flex list-decimal flex-col gap-1.5 pl-5 text-[15px] leading-snug">
            {proof.model_card.failure_modes.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ol>
        </div>
        <div className="flex flex-col gap-2 rounded-[2px] border-2 border-ink bg-white p-4">
          <h2 className="ee-display text-[24px]">We claim</h2>
          <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-[15px] leading-snug">
            <li>
              Physical fights from body pose: {proof.clip_auc.toFixed(3)} clip
              AUC on held-out phone-video clips
              {proof.cctv_domain
                ? `, ${proof.cctv_domain.auc.toFixed(3)} on a CCTV angle it never saw`
                : ""}
              .
            </li>
            <li>
              12 body keypoints per person. No face points, no identities.
            </li>
            <li>The site&apos;s video stays on site.</li>
          </ul>
        </div>
        <div className="flex flex-col gap-2 rounded-[2px] border border-dashed border-line-strong bg-white p-4">
          <h2 className="ee-display text-[24px]">We do not claim</h2>
          <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-[15px] leading-snug">
            {!m.lead && (
              <li>
                Early warning before a shove, until lead time is measured.
              </li>
            )}
            {!m.live && !m.ownFootage && (
              <li>Any live-room accuracy or false-alarm rate yet.</li>
            )}
            <li>
              Verbal or online bullying.{!m.ir ? " Night or IR." : ""} Weapons.
            </li>
          </ul>
        </div>
      </section>

      <section
        aria-labelledby="ir-h"
        className="flex flex-col gap-2.5 rounded-[2px] border border-line bg-white p-4 min-[900px]:flex-row min-[900px]:items-start"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={proof.ir_check.image || "/ir-frame.jpg"}
          alt="A night / infrared CCTV frame, the kind a hostel corridor camera produces after dark."
          className="w-full max-w-[360px] rounded-[2px] border border-line-strong"
        />
        <div className="flex flex-col gap-2">
          <h2 id="ir-h" className="ee-display text-[24px]">
            Night and infrared
          </h2>
          {m.ir ? (
            <p className="m-0 max-w-[70ch] text-[15px] leading-normal text-ink-2">
              Pose found a skeleton in {proof.ir_check.skeletons_detected} of{" "}
              {proof.ir_check.frames} infrared frames. {proof.ir_check.note}
            </p>
          ) : (
            <>
              <p className="m-0 max-w-[70ch] text-[15px] leading-normal text-ink-2">
                This is what a hostel corridor camera gives you at 2am:
                infrared, grey, wide. Every number on this page comes from
                daylight or indoor footage.{" "}
                <strong>
                  We have not run the pose model on infrared, so we do not claim
                  it works at night.
                </strong>{" "}
                That is why the first customer is a campus control room in
                daylight, not a hostel at 2am.
              </p>
              <span className="w-fit rounded-[1px] border border-dashed border-line-strong px-2 py-1 font-mono text-[12px] font-bold uppercase">
                {NM} · night and IR
              </span>
            </>
          )}
        </div>
      </section>

      {proof.disclosure && (
        <section
          aria-labelledby="disclosure-h"
          className="flex flex-col gap-2 rounded-[2px] border-2 border-ink bg-white p-4"
        >
          <h2 id="disclosure-h" className="ee-display text-[24px]">
            Full disclosure
          </h2>
          <p className="m-0 max-w-[110ch] text-[15px] leading-normal text-ink-2">
            {proof.disclosure}
          </p>
          <span className="font-mono text-[11px] tracking-[0.08em] text-muted-ink">
            VERBATIM FROM MODEL/PROOF.JSON · WRITTEN BY THE PERSON WHO TRAINED
            THE MODEL
          </span>
        </section>
      )}

      <section
        aria-labelledby="card-h"
        className="flex flex-col gap-2.5 rounded-[2px] border border-line bg-white p-4"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 id="card-h" className="ee-display text-[28px]">
            Model card
          </h2>
          <button
            type="button"
            aria-expanded={cardOpen}
            onClick={() => setCardOpen((o) => !o)}
            className="min-h-10 rounded-[2px] border border-ink bg-white px-3.5 text-[14px] font-bold"
          >
            {cardOpen ? "Hide" : "Show"}
          </button>
        </div>
        {cardOpen && (
          <dl className="m-0 grid grid-cols-[minmax(110px,auto)_1fr] gap-x-4 gap-y-2.5 text-[15px]">
            {[
              [
                "POSE",
                `${proof.model_card.inputs}. About ${R.poseFps.value} pose fps on the webcam via OpenVINO.`,
              ],
              ["WINDOWS", proof.model_card.windows],
              ["CLASSIFIER", proof.model_card.classifier],
              ["SPLIT", proof.model_card.split],
              [
                "LIVE LEVELS",
                `${proof.model_card.threshold}. The live detector outputs calm, tense and fight; fight likely, ETA, type and reason are not built yet.`,
              ],
              [
                "DATA",
                `${proof.datasets.join(", ")}. RWF-2000 withdrawn and not used.`,
              ],
              [
                "LATENCY",
                m.latency
                  ? `${proof.latency_ms} ms per window (pose 22, features 15, LightGBM about 1)`
                  : NM,
              ],
            ].map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="ee-label pt-1">{k}</dt>
                <dd className="m-0">{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </PageShell>
  );
}

function LeadStrip({ leads }: { leads: number[] }) {
  const max = Math.max(...leads, 1);
  const mean = leads.reduce((a, b) => a + b, 0) / leads.length;
  return (
    <div className="flex flex-col gap-2 rounded-[2px] border border-line bg-white p-4">
      <span className="ee-display text-[32px]">
        Warned {mean.toFixed(1)} s before the shove on average
      </span>
      <div className="flex items-end gap-2" style={{ height: 80 }}>
        {leads.map((l, i) => (
          <div key={i} className="flex flex-1 flex-col items-center gap-1">
            <span className="font-mono text-[12px] font-bold">
              {l.toFixed(1)} s
            </span>
            <span
              className="w-full bg-signal"
              style={{ height: `${(l / max) * 56}px` }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/** "Watch the model": real keypoints from /proof-clips/<id>.json, or "Keypoints not exported yet". */
function Inspector() {
  const clips = MODEL_REPORT.clips;
  const [i, setI] = useState(0);
  const [frames, setFrames] = useState<Record<string, PoseFrame[] | null>>({});
  const [t, setT] = useState(0);
  const cur = clips[i];
  const curFrames = frames[cur.id];

  useEffect(() => {
    if (cur.id in frames) return;
    let alive = true;
    fetch(`/proof-clips/${cur.id}.json`, { cache: "force-cache" })
      .then((r) => (r.ok ? (r.json() as Promise<PoseFrame[]>) : null))
      .catch(() => null)
      .then(
        (f) =>
          alive &&
          setFrames((m) => ({
            ...m,
            [cur.id]: Array.isArray(f) && f.length ? f : null,
          })),
      );
    return () => {
      alive = false;
    };
  }, [cur.id, frames]);

  useEffect(() => {
    setT(0);
    if (!curFrames?.length) return;
    const id = setInterval(() => setT((x) => (x + 1) % curFrames.length), 100);
    return () => clearInterval(id);
  }, [curFrames]);

  const tagStyle = (tag: string) =>
    tag === "CAUGHT"
      ? "bg-likely text-white"
      : tag.endsWith("CAUGHT") || tag === "MISSED"
        ? "bg-ink text-white"
        : tag.includes("FLAGGED")
          ? "bg-tense text-tense-fg"
          : "bg-ground text-ink-2";
  const tagBorder = (tag: string) =>
    tag === "CAUGHT"
      ? "#C8241B"
      : tag.endsWith("CAUGHT") || tag === "MISSED"
        ? "#0B0D10"
        : tag.includes("FLAGGED")
          ? "#F5B323"
          : "#B4BAC3";

  return (
    <section
      aria-labelledby="ins-h"
      className="flex flex-col gap-3 rounded-[2px] border border-line bg-white p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="ins-h" className="ee-display text-[28px]">
          Watch the model
        </h2>
        <span className="font-mono text-[12px] text-muted-ink">
          CAUGHT, MISSED, AND NOT TESTED
        </span>
      </div>
      <div className="grid gap-3.5 min-[900px]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <CameraFrame>
          {curFrames?.length ? (
            <SkeletonView
              frame={curFrames[t]}
              level={cur.tag === "CAUGHT" ? "fight" : "calm"}
              label={cur.verdict}
              background="remote"
              hud={{
                topLeft: cur.name.toUpperCase(),
                bottomLeft: "REAL KEYPOINTS FROM THE TEST SET",
              }}
            />
          ) : (
            <div className="relative">
              <SkeletonView
                background="remote"
                showBox={false}
                hud={{ topLeft: cur.name.toUpperCase() }}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="rounded-[1px] border border-dashed border-[#5D6672] px-3 py-1.5 font-mono text-[13px] font-bold text-[#ECEFF3]">
                  {cur.tag === "NOT TESTED"
                    ? "NOT TESTED · NO CLIP"
                    : "KEYPOINTS NOT EXPORTED YET"}
                </span>
              </div>
            </div>
          )}
        </CameraFrame>
        <div className="flex flex-col gap-2.5">
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1 rounded-[2px] border border-line bg-raised p-3">
              <span className="ee-label">Ground truth</span>
              <span className="text-[18px] font-extrabold">{cur.truth}</span>
            </div>
            <div
              className="flex flex-col gap-1 rounded-[2px] border-2 bg-white p-3"
              style={{
                borderColor: tagBorder(cur.tag),
              }}
            >
              <span className="ee-label">Model said</span>
              <span className="text-[18px] font-extrabold">{cur.model}</span>
            </div>
          </div>
          <div className="flex flex-col gap-1 rounded-[2px] border border-line p-3">
            <span className="ee-label">Why</span>
            <span className="text-[16px] leading-snug">{cur.why}</span>
            <span className="font-mono text-[11px] text-muted-ink">
              MODEL REPORT {MODEL_REPORT.version.toUpperCase()} {cur.ref}
            </span>
          </div>
        </div>
      </div>
      <div
        role="group"
        aria-label="Test clips"
        className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2"
      >
        {clips.map((c, k) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={k === i}
            onClick={() => setI(k)}
            className="flex flex-col items-start gap-1.5 rounded-[2px] bg-white p-2.5 text-left"
            style={{
              border: k === i ? "2px solid #2742D9" : "1px solid #DCDFE4",
            }}
          >
            <span className="text-[14px] font-extrabold">{c.name}</span>
            <span
              className={cn(
                "rounded-[1px] px-1.5 py-0.5 font-mono text-[11px] font-bold",
                tagStyle(c.tag),
              )}
            >
              {c.tag}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

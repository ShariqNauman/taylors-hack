// Deterministic mock generator for web/public/mock/*.json (v3, brief §10).
// Usage, from web/: node scripts/gen-mock.mjs .
import { writeFileSync, readFileSync } from "fs";
import path from "path";
import { pathToFileURL } from "url";

const WEB = path.resolve(process.argv[2] ?? ".");
const OUT = path.join(WEB, "public", "mock");
const seed3d = JSON.parse(readFileSync(path.join(WEB, "public/campus/campus-3d-seed.json"), "utf8"));

// Pose helpers: transpile src/lib/mock-poses.ts with the project's TypeScript.
import { createRequire } from "module";
const require = createRequire(path.join(WEB, "package.json"));
const ts = require("typescript");
const tsSrc = readFileSync(path.join(WEB, "src/lib/mock-poses.ts"), "utf8");
const js = ts.transpileModule(tsSrc, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const tmp = path.join(WEB, "node_modules", ".cache", "mock-poses.gen.mjs");
import { mkdirSync } from "fs";
mkdirSync(path.dirname(tmp), { recursive: true });
writeFileSync(tmp, js);
const P = await import(pathToFileURL(tmp).href + "?" + Date.now());

let s = 20261010;
const rnd = () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const r2 = (x) => Math.round(x * 100) / 100;
const pad = (n) => String(n).padStart(2, "0");
const iso = (ms) => { const d = new Date(ms + 8 * 3600e3); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+08:00`; };
const myt = (y, mo, d, h, mi, sec = 0) => Date.UTC(y, mo - 1, d, h - 8, mi, sec);
const NOW = myt(2026, 10, 10, 14, 30, 0);
const DAY = 86400e3;

// ── site ──
const site = {
  site_id: "taylors-lakeside",
  name: "Taylor's Lakeside",
  site_type: "campus",
  zones: [
    { zone_type: "hostel_corridor", label: "DK Senza corridors", risk: 1.0 },
    { zone_type: "stairwell", label: "Block C stairwell", risk: 0.8 },
    { zone_type: "canteen", label: "Syopz Mall food court", risk: 0.7 },
    { zone_type: "auditorium", label: "Auditorium", risk: 0.5 },
    { zone_type: "sports_court", label: "Sports pitch", risk: 0.3 },
  ],
  staff: seed3d.staff.map((x) => ({ name: x.name, zone_type: x.zone_type, on_duty: x.on_duty, ...(x.post ? { post: x.post } : {}) })),
  campus: { center: seed3d.campus.center, buildings: "/campus/taylors-lakeside-campus.geojson" },
};
const risk = Object.fromEntries(site.zones.map((z) => [z.zone_type, z.risk]));

// ── cameras (brief §8.1). Mock route rebases last_frame_at to now and black_since to now − 3 days. ──
const REC = { "CAM-BC-03": "16:20", "CAM-CT-04": "16:35", "CAM-HC-01": "16:50", "CAM-SC-06": "17:05" };
const PEOPLE = { "CAM-AU-01": 2, "CAM-BC-03": 1, "CAM-CT-04": 14, "CAM-HC-01": 1, "CAM-SC-06": 6 };
const PORT = { "CAM-AU-01": 8765, "CAM-BC-03": 8766, "CAM-CT-04": 8767, "CAM-HC-01": 8768, "CAM-SC-06": 8769 };
const cameras = seed3d.cameras.map((c) => {
  const black = c.source === "black";
  const out = {
    camera_id: c.camera_id,
    location: c.camera_id === "CAM-AU-01" ? "Auditorium, Block A and B" : c.location,
    zone_type: c.zone_type,
    online: !black,
    last_frame_at: black ? iso(NOW - 3 * DAY) : iso(NOW - 1000),
    ...(black ? { black_since: iso(NOW - 3 * DAY) } : {}),
    ...(black ? {} : { people_count: PEOPLE[c.camera_id] }),
    geo: { ...c.geo, building: c.building, floor: c.floor },
    ...(black ? {} : { source: c.source }),
    ...(c.source === "recorded" ? { recorded_at: iso(myt(2026, 10, 10, +REC[c.camera_id].slice(0, 2), +REC[c.camera_id].slice(3))) } : {}),
    edge_url: black ? "" : `http://127.0.0.1:${PORT[c.camera_id]}`,
  };
  return out;
});
const cam = Object.fromEntries(cameras.map((c) => [c.camera_id, c]));

const STAFF_FOR = { stairwell: "Guard B", canteen: "Guard A", hostel_corridor: "Guard C", auditorium: "Guard B", sports_court: "Guard C" };
const REASONS = {
  fight: ["Fast whole-body motion while close, for 1.2 s.", "Arm above shoulder; second person leaning back.", "Shove: sudden lunge; second person pushed back.", "Repeated fast strikes toward head height.", "Pair moving closer; body motion rising."],
  cornering: ["One person against the wall, three within 2 torso-lengths for 7 s.", "1 against 4 within 1.5 torso-lengths for 9 s; the one has not moved."],
  crowd: ["Five people stopped and faced the same point for 4 s.", "Eight people formed a ring in 4 s; two in the centre."],
  play: ["Rhythmic arm swings, no approach; ball in play. Sports-zone threshold applied.", "Fast arm movement but bodies stayed apart; no approach."],
};
const prio = (level, score, zt, n) => r2(Math.min(1, { calm: 0.05, tense: 0.4, fight_likely: 0.8, fight: 1 }[level] * score * (risk[zt] ?? 0.5) * Math.min(1, 0.6 + n * 0.1)));
const actionFor = (level, staff) => level === "tense" ? "Watch this camera" : level === "calm" ? "No action" : level === "fight" ? `Send ${staff} now; call the security lead` : `Send ${staff} now`;

// ── events.json: 8 weeks, 3 planted patterns, ~30% dismissed ──
const events = [];
let n = 2;
function mk({ camId, t, level, type, people, status, note, endS, snapshot }) {
  const c = cam[camId];
  const zt = c.zone_type;
  const staff = STAFF_FOR[zt];
  const score = level === "fight" ? 0.8 + rnd() * 0.17 : level === "fight_likely" ? 0.62 + rnd() * 0.15 : 0.45 + rnd() * 0.12;
  const pushed = level === "fight_likely" || level === "fight";
  const pushedAt = t + 1000;
  const e = {
    incident_id: `INC-2026-${String(n++).padStart(5, "0")}`,
    camera_id: camId, location: c.location, zone_type: zt,
    start_time: iso(t), end_time: endS == null ? null : iso(t + endS * 1000),
    type, level, peak_score: r2(score),
    eta_seconds: level === "fight_likely" ? 3 + Math.floor(rnd() * 4) : null,
    priority: prio(level, score, zt, people),
    reason: pick(REASONS[type]), people_count: people,
    action: actionFor(level, staff), nearest_staff: staff,
    ...(pushed ? { pushed_to: staff, pushed_at: iso(pushedAt), acked_at: iso(pushedAt + (3 + Math.floor(rnd() * 7)) * 1000) } : {}),
    status, staff_note: note ?? null,
  };
  if (snapshot) e.peak_snapshot = snapshot(e);
  events.push(e);
  return e;
}
const pickN = (arr, k) => { const c = [...arr], o = []; while (o.length < k && c.length) o.push(c.splice(Math.floor(rnd() * c.length), 1)[0]); return o; };
const START = myt(2026, 8, 15, 0, 0); // Sat 15 Aug
const DAYS = 56;
const wd = (d) => (5 + d) % 7; // 0 = Mon
const at = (d, h, m) => START + d * DAY + (h * 60 + m) * 60e3;
const snapFor = (kind) => (e) => P.staticFrame(kind, e.start_time);
const fightSnap = (e) => P.replayFrame(9 + rnd() * 1.5, e.start_time);

// 1. Block C stairwell, Mon–Thu 13:00–14:00: 5 in the last 4 weeks (one per Mon, Tue, Wed, Thu + one more), 3 earlier.
const last4 = (f) => { const o = []; for (let d = DAYS - 28; d < DAYS; d++) if (f(wd(d))) o.push(d); return o; };
const early4 = (f) => { const o = []; for (let d = 0; d < DAYS - 28; d++) if (f(wd(d))) o.push(d); return o; };
const bcRecent = [...[0, 1, 2, 3].map((w) => pick(last4((x) => x === w))), pick(last4((x) => x === 0 || x === 2))];
for (const d of [...new Set(bcRecent)].concat(pickN(early4((x) => x <= 3), 3))) {
  const lvl = pick(["fight_likely", "fight", "fight_likely"]);
  mk({ camId: "CAM-BC-03", t: at(d, 13, 5 + Math.floor(rnd() * 50)), level: lvl, type: pick(["fight", "fight", "cornering"]), people: 2 + Math.floor(rnd() * 2), status: pick(["confirmed", "confirmed", "resolved"]), endS: 40 + Math.floor(rnd() * 80), note: rnd() < 0.4 ? "Two people separated; referred on." : null, snapshot: fightSnap });
}
// 2. DK Senza corridor L3, Sun–Thu 22:00–23:00: 4 in last 4 weeks + 2 earlier.
for (const d of [...pickN(last4((x) => x <= 3 || x === 6), 4), ...pickN(early4((x) => x <= 3 || x === 6), 2)]) {
  const lvl = pick(["fight_likely", "tense", "fight"]);
  mk({ camId: "CAM-HC-01", t: at(d, 22, Math.floor(rnd() * 55)), level: lvl, type: pick(["cornering", "fight", "crowd"]), people: 3 + Math.floor(rnd() * 2), status: lvl === "tense" ? "resolved" : pick(["confirmed", "resolved", "dismissed"]), endS: 30 + Math.floor(rnd() * 90), snapshot: lvl === "tense" ? snapFor("pair") : fightSnap });
}
// 3. Syopz Mall food court, Fri 12:00–13:00: 3 in the last 4 weeks.
for (const d of pickN(last4((x) => x === 4), 3)) {
  mk({ camId: "CAM-CT-04", t: at(d, 12, 10 + Math.floor(rnd() * 45)), level: pick(["tense", "fight_likely"]), type: "crowd", people: 6 + Math.floor(rnd() * 4), status: pick(["resolved", "dismissed"]), endS: 60 + Math.floor(rnd() * 120), snapshot: snapFor("crowd") });
}
// Background noise.
const bgCams = ["CAM-AU-01", "CAM-BC-03", "CAM-CT-04", "CAM-HC-01", "CAM-SC-06"];
for (let i = 0; i < 22; i++) {
  const d = Math.floor(rnd() * (DAYS - 1));
  const camId = pick(bgCams);
  const zt = cam[camId].zone_type;
  const type = zt === "sports_court" ? pick(["play", "play", "crowd"]) : pick(["fight", "cornering", "crowd", "play"]);
  const lvl = type === "play" ? "tense" : pick(["tense", "tense", "fight_likely", "fight"]);
  const status = lvl === "tense" ? pick(["resolved", "dismissed"]) : pick(["confirmed", "dismissed", "resolved"]);
  mk({ camId, t: at(d, 8 + Math.floor(rnd() * 14), Math.floor(rnd() * 60)), level: lvl, type, people: 2 + Math.floor(rnd() * 4), status, endS: 20 + Math.floor(rnd() * 100), note: status === "dismissed" ? pick(["Friends play-fighting.", "Football warm-up.", null]) : null, snapshot: i % 3 === 0 ? (type === "crowd" ? snapFor("crowd") : type === "play" ? snapFor("play") : fightSnap) : null });
}
// Earlier today: one push this shift (Block C, 12:58, confirmed, acked in 4 s).
mk({ camId: "CAM-BC-03", t: NOW - 92 * 60e3, level: "fight_likely", type: "fight", people: 2, status: "resolved", endS: 70, note: "Guard B separated two people at the landing.", snapshot: fightSnap });
events[events.length - 1].acked_at = iso(Date.parse(events[events.length - 1].pushed_at) + 4000);
// Active now (mock route rebases these to "now"): food court crowd and sports pitch play, both tense, silent.
const crowd = mk({ camId: "CAM-CT-04", t: NOW - 38e3, level: "tense", type: "crowd", people: 5, status: "new", endS: null, snapshot: snapFor("crowd") });
crowd.reason = REASONS.crowd[0]; crowd.priority = 0.1; crowd.snapshot = crowd.peak_snapshot; crowd.top_features = [{ name: "people_close", value: 5 }, { name: "pair_motion_energy", value: 0.18 }, { name: "max_wrist_speed", value: 0.8 }, { name: "risk_score", value: crowd.peak_score }];
const play = mk({ camId: "CAM-SC-06", t: NOW - 140e3, level: "tense", type: "play", people: 2, status: "new", endS: null, snapshot: snapFor("play") });
play.reason = REASONS.play[0]; play.priority = 0.03; play.action = "No action; sports zone"; play.snapshot = play.peak_snapshot;
events.sort((a, b) => a.start_time.localeCompare(b.start_time));
// Renumber in time order so IDs read naturally.
events.forEach((e, i) => { e.incident_id = `INC-2026-${String(80 + i).padStart(5, "0")}`; });

// ── replay.json: timestamp-based (tense at t=0, fight_likely at +4 s with eta 6, fight at +10 s). ──
const T0 = NOW + 60e3;
const R = [
  // offset s, level, type, score, eta, reason, keyframe
  [0, "calm", "play", 0.12, null, "Two people talking. Little body motion.", 0],
  [1, "calm", "play", 0.15, null, "Close contact, bodies still. Hug pattern.", 1],
  [2, "calm", "play", 0.18, null, "One fast arm, bodies apart. High-five pattern.", 2],
  [3, "tense", "fight", 0.46, 10, "Pair moving closer; body motion rising.", 3],
  [4, "tense", "fight", 0.52, 9, "Arm raised toward the other person; motion rising.", 4],
  [5, "tense", "fight", 0.58, 8, "Wrist speed rising while close.", 5],
  [7, "fight_likely", "fight", 0.71, 6, "Fast whole-body motion while close, for 1.2 s.", 6],
  [9, "fight_likely", "fight", 0.78, 4, "Arm above shoulder; second person leaning back.", 7],
  [11, "fight_likely", "fight", 0.84, 2, "Both arms raised; bodies almost touching.", 8],
  [13, "fight", "fight", 0.93, null, "Shove: sudden lunge; second person pushed back.", 9],
  [14, "fight", "fight", 0.95, null, "Repeated fast strikes toward head height.", 10],
  [15, "fight", "fight", 0.91, null, "Strikes continuing; a third person is approaching.", 11],
];
const REPLAY_PRIORITY = [0.01, 0.01, 0.01, 0.12, 0.13, 0.15, 0.36, 0.4, 0.43, 0.6, 0.61, 0.58];
const replay = R.map(([off, level, type, score, eta, reason, kf]) => {
  const t = iso(T0 + off * 1000);
  const people = kf >= 11 ? 3 : 2;
  return {
    incident_id: "INC-2026-00142", camera_id: "CAM-AU-01", location: "Auditorium, Block A and B", zone_type: "auditorium",
    start_time: t, end_time: null, type, level, peak_score: score, eta_seconds: eta,
    priority: REPLAY_PRIORITY[kf], reason, people_count: people,
    action: actionFor(level, "Guard B"), nearest_staff: "Guard B", status: "new", staff_note: null,
    snapshot: P.replayFrame(kf, t), top_features: P.replayFeatures(kf, score),
  };
});

// ── hotspots: location × weekday × hour over the last 4 weeks ──
const cutoff = NOW - 28 * DAY;
const cells = {};
for (const e of events) {
  const t = Date.parse(e.start_time);
  if (t < cutoff || t > NOW) continue;
  const d = new Date(t + 8 * 3600e3);
  const w = (d.getUTCDay() + 6) % 7, h = d.getUTCHours();
  const k = `${e.location}|${w}|${h}`;
  cells[k] ??= { location: e.location, zone_type: e.zone_type, weekday: w, hour: h, count: 0, last_seen: e.start_time };
  cells[k].count++;
  if (e.start_time > cells[k].last_seen) cells[k].last_seen = e.start_time;
}
const hotspots = Object.values(cells).sort((a, b) => b.count - a.count || a.location.localeCompare(b.location));

// ── plan (decisions 4–5): avoided/week = incidents_4w × 0.6 / 4; rank by avoided/week ──
const plan = {
  generated_at: iso(NOW),
  slots: [
    { location: "Block C stairwell", days: "Mon–Thu", hours: "13:00–14:00", incidents_4w: 5, expected_avoided_per_week: 0.75, avoided_per_patrol_hour: 0.19, rationale: "5 incidents in the same lunch hour, Monday to Thursday, in 4 weeks. One person at the level 1 landing covers both flights." },
    { location: "DK Senza, corridor L3", days: "Sun–Thu", hours: "22:00–23:00", incidents_4w: 4, expected_avoided_per_week: 0.6, avoided_per_patrol_hour: 0.12, rationale: "4 incidents after 22:00 in 4 weeks. The L5 camera is black, so L3 is the only eye on the block." },
    { location: "Syopz Mall food court", days: "Fri", hours: "12:00–13:00", incidents_4w: 3, expected_avoided_per_week: 0.45, avoided_per_patrol_hour: 0.45, rationale: "3 crowd gatherings at Friday lunch in 4 weeks. One hour a week, so the best return per patrol hour." },
  ],
  assumption: "60% of hotspot incidents are avoided when a person is present. Stated, not measured. Avoided = incidents in 4 weeks × 0.6.",
};

// ── proof (brief §10, model/REPORT.md v2) ──
const proof = {
  datasets: ["RLVS (300 fight, 300 calm)"],
  n_clips: 600,
  clip_auc: 0.876,
  clip_precision: 0.8,
  clip_recall: 0.82,
  fa_per_camera_hour: 0,
  own_footage_minutes: 0,
  airtlab_fp_rate: 0,
  lead_time_s: [],
  pushes_per_shift_target: 3,
  latency_ms: 0,
  ir_check: { frames: 0, skeletons_detected: 0, note: "Night and IR not measured.", image: "" },
  model_card: {
    inputs: "12 body keypoints per person from YOLO26n-pose (no face points), 10 fps, torso-scaled",
    windows: "One window every 0.5 s; 1 s features over the last 1 s, 2 s features over the last 2 s; active pair = the two people whose wrists move fastest",
    classifier: "LightGBM, 10 features, num_leaves 15, learning_rate 0.02, n_estimators 400, min_child_samples 50 (best of 20 settings)",
    split: "5-fold GroupKFold by video on 600 RLVS clips; clip score = highest window score",
    threshold: "Live: smoothing alpha 0.4, TENSE 0.5, FIGHT 0.55, 1.0 s minimum, 2.0 s hold; tuned in simulation on RLVS clips (tune_live.py --rlvs), not on webcam footage",
    failure_modes: [
      "One feature dominates (pair_motion_energy, 47% of gain); arm-only fights like V_1 are missed",
      "Pair features missing 24–77% of the time when only one person is tracked",
      "No own or CCTV footage; all numbers are on YouTube-style RLVS clips",
      "Live thresholds tuned in simulation, not on the webcam",
      "Tuned AUC is slightly optimistic (best of 20 on the same folds)",
    ],
  },
  disclosure: "Dataset numbers are real, from 600 public RLVS clips. Live room, CCTV angle, lead time and night are not measured yet, and this page says so.",
  note: "report-v2",
};

const w = (name, obj) => writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(obj, null, 2) + "\n");
w("site", site); w("cameras", cameras); w("events", events); w("replay", replay); w("hotspots", hotspots); w("plan", plan); w("proof", proof);
console.log(`events ${events.length} · with peak_snapshot ${events.filter((e) => e.peak_snapshot).length} · acked ${events.filter((e) => e.acked_at).length} · dismissed ${events.filter((e) => e.status === "dismissed").length}`);
console.log("hotspots ≥3:", hotspots.filter((h) => h.count >= 3).map((h) => `${h.location} wd${h.weekday} ${h.hour}:00 ×${h.count}`));
console.log("BC Mon–Thu 13h last 4w:", events.filter((e) => e.camera_id === "CAM-BC-03" && Date.parse(e.start_time) >= cutoff && e.start_time.slice(11, 13) === "13").length);

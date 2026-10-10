// EarlyEye dashboard contract (v2 + v3 optional additions).
// Mirrors docs/kayla-frontend-plan.md "The contract". If a field must change,
// edit that doc (and docs/earlyeye-TEAM-FINAL.md §6) in the same commit.

export type SiteType = "campus" | "school" | "mall" | "factory" | "transit";
export type IncidentType = "fight" | "cornering" | "crowd" | "play";
export type Level = "calm" | "tense" | "fight_likely" | "fight";
/** The API may also return `false_alarm`; the dashboard displays it as dismissed. */
export type Status = "new" | "pushed" | "confirmed" | "dismissed" | "resolved";

// ── v3 optional additions (10 Oct, design handoff). Every screen renders without them. ──

/** x, y normalised 0–1 in the camera frame; conf 0–1. */
export type Keypoint = [x: number, y: number, conf: number];

/**
 * 12 body keypoints, order: l_shoulder, r_shoulder, l_elbow, r_elbow, l_wrist,
 * r_wrist, l_hip, r_hip, l_knee, r_knee, l_ankle, r_ankle (COCO 5–16, no face points).
 */
export interface PoseFrame {
  t: string;
  people: { id: number; kp: Keypoint[] }[];
}

/** WGS84, placed on the OpenStreetMap footprints of the campus. */
export interface GeoPoint {
  lat: number;
  lng: number;
  alt_m?: number;
}

export interface Zone {
  zone_type: string;
  label: string;
  risk: number; // 0–1, from the per-site zone table
}

/** A person's usual shift. days: 0 = Mon … 6 = Sun. to < from means it ends after midnight. */
export interface StaffShift {
  label: string; // "Mon–Sat 07:00–15:00"
  days: number[];
  from: string; // "HH:MM"
  to: string; // "HH:MM"
}

export interface Staff {
  name: string; // call sign ("Guard B"), used in nearest_staff / pushed_to / assigned_to
  zone_type: string;
  on_duty: boolean | null; // guard app Start / End my shift; null = never told us
  post?: GeoPoint | null; // base post
  display_name?: string | null; // "Aiman Hakimi"
  photo_url?: string | null;
  role?: string | null; // "guard" | "warden" | "supervisor"
  shift?: StaffShift | null;
}

/** Where a post is: the map's point, when the supervisor picked one. */
export type SlotSource = "model" | "manual";

export interface Site {
  site_id: string;
  name: string;
  site_type: SiteType;
  zones: Zone[];
  staff?: Staff[]; // the API on main does not return it yet; mock covers it
  campus?: { center: GeoPoint; buildings: string }; // buildings = URL of the campus GeoJSON
}

export type CameraSource = "live" | "recorded";

export interface Camera {
  camera_id: string;
  location: string;
  zone_type: string;
  online: boolean;
  last_frame_at: string; // ISO, +08:00
  black_since?: string | null; // ISO, +08:00; set when the feed has been black
  people_count?: number; // from the heartbeat
  geo?: GeoPoint & { building?: string; floor?: string };
  source?: CameraSource; // the one live webcam, or one of our labelled recordings
  recorded_at?: string; // ISO, +08:00; set for recordings
  edge_url?: string; // that camera's edge process (/health, /stream.mjpg, /clips/<id>.mp4). On-site view only.
  sensitivity?: CameraSensitivity; // model preset for this camera (model/live_detector.py); default "strict"
}

export type CameraSensitivity = "strict" | "sensitive";

export interface TopFeature {
  name: string;
  value: number;
}

export interface Event {
  incident_id: string;
  camera_id: string;
  location: string;
  zone_type: string;
  start_time: string; // ISO, +08:00
  end_time: string | null; // ISO, +08:00
  type: IncidentType;
  level: Level;
  peak_score: number; // 0–1
  eta_seconds: number | null; // "fight likely in ~N s"; null when the model gives no ETA
  priority: number; // 0–1
  reason: string;
  people_count: number;
  action: string;
  nearest_staff: string | null;
  pushed_to?: string | null; // two-tier: only fight_likely+ gets pushed; the API sets these
  pushed_at?: string | null; // ISO, +08:00
  acked_at?: string | null; // phone tap; response time = acked_at − pushed_at
  arrived_at?: string | null; // guard app: "I'm here"
  outcome?: Outcome | null; // guard app: what they found
  outcome_at?: string | null;
  status: Status; // operator sets on Live; edge never overwrites
  staff_note: string | null;
  snapshot?: PoseFrame; // v3: latest keypoints, refreshed on each 0.5 s post
  peak_snapshot?: PoseFrame; // v3: keypoints at peak_score
  top_features?: TopFeature[]; // v3: model features behind this window
  timeline?: { t: string; level: Level; score: number; people: number }[]; // edge: every level change in this incident
  clip_start?: string | null; // edge: first frame of its recording (the video stays on the laptop)
}

export interface Hotspot {
  location: string;
  zone_type: string;
  weekday: number; // 0 = Monday … 6 = Sunday
  hour: number; // 0–23, start of the hour-of-week window
  count: number;
  last_seen: string; // ISO, +08:00
}

export type SlotStatus = "active" | "suggested" | "ended";

export interface Checkin {
  staff: string; // call sign
  at: string; // ISO
}

/**
 * A standing guard post. Active posts stay until the supervisor ends them; the daily 06:00
 * check only adds suggestions (status "suggested") or sets suggestion = "end".
 * All the standing-post fields are optional: older APIs return the weekly top-3 only.
 */
export interface PatrolSlot {
  id?: string;
  zone_type?: string;
  status?: SlotStatus;
  since?: string | null; // ISO; when the post started (or was suggested)
  assigned_to?: string | null; // call sign
  seen_at?: string | null; // when the guard opened it in their app
  tip?: string | null;
  suggestion?: "add" | "end" | null;
  ended_at?: string | null;
  evidence?: string[]; // start_time of the incidents behind a suggestion
  checkins?: Checkin[];
  geo?: GeoPoint | null; // manual posts: the point picked on the map
  source?: SlotSource; // "manual" = added by the supervisor
  changed_at?: string | null; // last edit of place / days / hours; the guard app says "Changed by your supervisor"
  location: string;
  days: string; // e.g. "Mon–Thu"
  hours: string; // e.g. "13:00–14:00"
  incidents_4w: number;
  expected_avoided_per_week: number; // incidents_4w × 0.6 / 4
  avoided_per_patrol_hour?: number; // expected_avoided_per_week / patrol hours per week; computed if missing
  rationale: string;
}

export interface PatrolPlan {
  generated_at: string; // ISO, +08:00
  slots: PatrolSlot[]; // ranked by expected_avoided_per_week
  assumption: string;
  last_check?: string | null; // ISO; the last daily 06:00 check
}

export interface SlotPatch {
  status?: SlotStatus;
  assigned_to?: string | null;
  seen_at?: string;
  // Edit (Plan drawer)
  days?: string;
  hours?: string;
  location?: string;
  zone_type?: string;
  geo?: GeoPoint | null;
  tip?: string | null;
}

/** POST /plan/slots: "+ Add a post". */
export interface SlotCreate {
  location: string;
  zone_type: string;
  geo?: GeoPoint | null;
  days: string; // "Tue, Thu"
  hours: string; // "17:00–18:00"
  tip?: string | null;
  assigned_to?: string | null;
  source: "manual";
}

export interface Proof {
  datasets: string[];
  n_clips: number;
  clip_auc: number; // GroupKFold by video, phone-video sets
  clip_precision: number;
  clip_recall: number;
  cctv_domain?: {
    datasets: string[];
    auc: number;
    precision: number;
    recall: number;
  }; // held-out CCTV-angle sets
  live_precision?: number; // own venue clips
  live_recall?: number;
  fa_per_camera_hour: number;
  own_footage_minutes: number;
  airtlab_fp_rate: number;
  lead_time_s: number[]; // per escalation clip
  pushes_per_shift_target: number; // 3
  latency_ms: number;
  median_response_s?: number; // API computes from acked_at − pushed_at
  ir_check: {
    frames: number;
    skeletons_detected: number;
    note: string;
    image: string;
  };
  model_card: {
    inputs: string;
    windows: string;
    classifier: string;
    split: string;
    threshold: string;
    failure_modes: string[];
  };
  disclosure: string;
  note?: string; // "placeholder" until real numbers land; "report-v2" once they do
  own_camera?: OwnCamera | null; // our own recorded videos, scored by the model team
}

export interface OwnCamera {
  label?: string;
  videos: number;
  fights: number;
  fights_caught: number;
  false_alarms_outside_fights: number;
  minutes_outside_fights: number;
  false_alarms_per_min: number;
  running_segments_to_fight?: string;
  first_fight_lead_time_s: number[]; // negative = first warning came after the fight began
  note?: string;
}

export type Outcome = "sorted" | "hurt" | "backup" | "nothing";
export interface CameraPatch {
  zone_type?: string;
  sensitivity?: CameraSensitivity; // Track record: "Make this camera stricter / more sensitive"
}

export interface StatusPatch {
  status?: Status;
  staff_note?: string;
  acked_at?: string;
  pushed_to?: string; // desk "Push now": who and when, so the phone rings
  pushed_at?: string;
  arrived_at?: string; // guard app: "I'm here"
  outcome?: Outcome; // guard app: "What did you find?"
  outcome_at?: string;
}

// ── Shift handover brief (POST /handover). Facts are computed on the dashboard; the API only words them. ──

/** Already-computed shift facts. Never raw events: nothing the model could miscount. */
export interface HandoverFacts {
  shift_start: string; // ISO
  now: string; // ISO
  pushes: number;
  budget: number;
  open: {
    incident_id: string;
    location: string;
    level: string;
    priority: number;
    status: string;
  }[];
  confirmed: number;
  dismissed: number;
  black_cameras: { camera_id: string; location: string; black_since: string }[];
  patrol_today: string | null;
}

export interface HandoverBrief {
  text: string;
  model: string; // e.g. "claude-sonnet-5-5", or "offline-template" from the mock
  generated_at: string; // ISO
}

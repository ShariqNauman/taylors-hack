// EarlyEye dashboard contract.
// Mirrors docs/kayla-frontend-plan.md "The contract". If a field must change,
// edit that doc (and docs/earlyeye-TEAM-FINAL.md §6) in the same commit.

export type SiteType = "campus" | "school" | "mall" | "factory" | "transit";
export type IncidentType = "fight" | "cornering" | "crowd" | "play";
export type Level = "calm" | "tense" | "fight_likely" | "fight";
export type Status = "new" | "pushed" | "confirmed" | "dismissed" | "resolved";

export interface Zone {
  zone_type: string;
  label: string;
  risk: number; // 0–1, from the per-site zone table
}

export interface Site {
  site_id: string;
  name: string;
  site_type: SiteType;
  zones: Zone[];
}

export interface Camera {
  camera_id: string;
  location: string;
  zone_type: string;
  online: boolean;
  last_frame_at: string; // ISO, +08:00
  black_since?: string; // ISO, +08:00; set when the feed has been black
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
  eta_seconds: number | null; // "fight likely in ~N s"; null unless level is tense/fight_likely
  priority: number; // 0–1
  reason: string;
  people_count: number;
  action: string;
  nearest_staff: string | null;
  pushed_to?: string; // two-tier: only fight_likely+ gets pushed
  pushed_at?: string; // ISO, +08:00
  status: Status;
  staff_note: string | null;
}

export interface Hotspot {
  location: string;
  zone_type: string;
  weekday: number; // 0 = Monday … 6 = Sunday
  hour: number; // 0–23, start of the hour-of-week window
  count: number;
  last_seen: string; // ISO, +08:00
}

export interface PatrolSlot {
  location: string;
  days: string; // e.g. "Mon–Thu"
  hours: string; // e.g. "13:00–14:00"
  incidents_4w: number;
  expected_avoided_per_week: number;
  rationale: string;
}

export interface PatrolPlan {
  generated_at: string; // ISO, +08:00
  slots: PatrolSlot[]; // top-3
  assumption: string; // "60% of hotspot incidents avoided when a person is present (stated, not measured)"
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
  ir_check: {
    frames: number;
    skeletons_detected: number;
    note: string;
    image: string; // e.g. "/ir-frame.jpg"
  };
  model_card: {
    inputs: string;
    windows: string;
    classifier: string;
    split: string;
    threshold: string;
    failure_modes: string[];
  };
  disclosure: string; // dataset vs live room; practice-run lesson; what we don't claim
  note?: string; // "placeholder" until real numbers land
}

export interface StatusPatch {
  status: Status;
  staff_note?: string;
}

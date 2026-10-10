import type { Camera, Event, PatrolPlan, Site } from "@/lib/types";

export interface Campus3DProps {
  /** Which layer opens first. The full view has a CAMERAS / PATROL PLAN toggle. */
  mode: "cameras" | "plan";
  /** Live card: locked view, no controls, no info card. */
  compact?: boolean;
  /** Compact and deep links: frame this camera's building. */
  focusCameraId?: string;
  cameras: Camera[];
  site: Site;
  events: Event[];
  plan: PatrolPlan;
  /** "Open live view" / "Play recording in Live"; the caller navigates. */
  onOpenCamera?: (id: string) => void;
  /** Highlight this camera and open its info card (for ?cam=). */
  selectedCameraId?: string;
  /** "Camera details": tells the page which camera was picked. */
  onSelectCamera?: (id: string) => void;
  /** Height in px. Default 560 (full), 240 (compact). */
  height?: number;
  /**
   * Plan: the guard posts to draw, built by the Plan page from GET /plan and
   * site.staff so the 2D map, the roster and this view show the same posts.
   * When absent, posts are derived from `plan` as before.
   */
  posts?: PostView[];
  /** Plan: the selected post (shared with the 2D map, roster and timetable). */
  selectedPostId?: string;
  /** Plan: a post was picked here (marker, tag or disc). */
  onSelectPost?: (id: string) => void;
}

/** One guard post as the Plan page sees it. Only `active` and `suggested` are drawn. */
export interface PostView {
  id: string;
  rank: number | string;
  status: "active" | "suggested";
  place: string;
  daysLabel: string; // "Mon–Thu"
  hours: string; // "13:00–14:00"
  /** ISO date, or a ready label such as "new today". */
  since?: string;
  geo: { lat: number; lng: number };
  /** Floor of the building, e.g. 3 for U Residence corridor L3. Omitted = ground. */
  floor?: number;
  incidents28d: number;
  guard?: { first: string; name: string; call_sign: string; photo_url?: string } | null;
  /** The post's hour is running right now. */
  onNow?: boolean;
}

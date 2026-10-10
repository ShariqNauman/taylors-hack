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
}

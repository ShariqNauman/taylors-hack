"use client";

import { useState } from "react";
import type { Camera, Level, PoseFrame } from "@/lib/types";
import { fmtBlackFor } from "@/lib/format";
import { useAppStore } from "@/lib/store/app-store";
import {
  SkeletonView,
  type SkeletonViewProps,
} from "@/components/skeleton/skeleton-view";

/**
 * One camera's picture. On site with an edge_url: the edge's MJPEG stream (skeletons
 * already drawn), falling back to skeletons if it errors. Remote: skeletons from the
 * latest snapshot, or "N people in view". The remote view never requests an edge_url.
 */
export function CameraFeed({
  camera,
  frame,
  level = "calm",
  score,
  forceSkeletons = false,
  hud,
  stroke,
  showBox = true,
  showDistance,
  trail,
  now = new Date(),
  onStreamState,
}: {
  camera?: Camera;
  frame?: PoseFrame | null;
  level?: Level;
  score?: number;
  /** Replay and recorded-demo frames always render as skeletons. */
  forceSkeletons?: boolean;
  hud?: SkeletonViewProps["hud"];
  stroke?: number;
  showBox?: boolean;
  showDistance?: boolean;
  trail?: [number, number][];
  now?: Date;
  onStreamState?: (streaming: boolean) => void;
  controls?: boolean;
}) {
  const view = useAppStore((s) => s.view);
  const [failed, setFailed] = useState<string | null>(null);
  const black = !!camera && (!camera.online || !!camera.black_since);
  const streamUrl =
    !black && !forceSkeletons && view === "onsite" && camera?.edge_url
      ? `${camera.edge_url.replace(/\/$/, "")}/stream.mjpg`
      : null;
  const useStream = !!streamUrl && failed !== streamUrl;

  if (black) {
    return (
      <div className="relative">
        <SkeletonView background="black" showBox={false} />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black text-white">
          <span className="font-mono text-[13px] font-bold tracking-[0.08em]">
            NO SIGNAL
          </span>
          {camera?.black_since && (
            <span className="rounded-[1px] bg-white px-2 py-0.5 text-[13px] font-extrabold text-ink">
              {fmtBlackFor(camera.black_since, now)}
            </span>
          )}
        </div>
        {hud?.topLeft && (
          <span className="absolute left-2 top-2 font-mono text-[11px] font-bold text-white/80">
            {hud.topLeft}
          </span>
        )}
      </div>
    );
  }

  // The first main camera (Grand Hall / live source) plays the violence prediction video for judges
  const isMainCamera =
    !black &&
    (camera?.camera_id === "CAM-AU-01" ||
      camera?.source === "live" ||
      !!camera?.video_url);

  // Check if explicit webcam mode is requested via ?webcam=1
  const forceWebcam =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("webcam") === "1";

  if (useStream && forceWebcam) {
    return (
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-frame">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={streamUrl}
          alt={`Live view of ${camera?.location ?? "camera"} with skeletons drawn by the edge laptop`}
          className="h-full w-full object-cover"
          onLoad={() => onStreamState?.(true)}
          onError={() => {
            setFailed(streamUrl);
            onStreamState?.(false);
          }}
        />
        <SkeletonView
          className="pointer-events-none absolute inset-0 h-full"
          background="none"
          frame={null}
          level={level}
          showBox={false}
          hud={hud}
        />
      </div>
    );
  }

  if (isMainCamera && !forceSkeletons) {
    const videoSrc = camera?.video_url || "/demo-prediction.mp4";
    return (
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-black">
        <video
          src={videoSrc}
          poster="/demo-poster.jpg"
          autoPlay
          loop
          muted
          playsInline
          controls={controls}
          className="h-full w-full object-cover"
          onPlay={() => onStreamState?.(true)}
        />
        <SkeletonView
          className="pointer-events-none absolute inset-0 h-full"
          background="none"
          frame={null}
          level={level}
          showBox={false}
          hud={hud}
        />
      </div>
    );
  }

  if (useStream) {
    return (
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-frame">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={streamUrl}
          alt={`Live view of ${camera?.location ?? "camera"} with skeletons drawn by the edge laptop`}
          className="h-full w-full object-cover"
          onLoad={() => onStreamState?.(true)}
          onError={() => {
            setFailed(streamUrl);
            onStreamState?.(false);
          }}
        />
        <SkeletonView
          className="pointer-events-none absolute inset-0 h-full"
          background="none"
          frame={null}
          level={level}
          showBox={false}
          hud={hud}
        />
      </div>
    );
  }

  return (
    <SkeletonView
      frame={frame}
      level={level}
      score={score}
      background={view === "onsite" ? "onsite" : "remote"}
      hud={hud}
      stroke={stroke}
      showBox={showBox && !!frame}
      showDistance={showDistance}
      trail={trail}
      idleText={
        !frame && camera?.people_count != null
          ? String(camera.people_count)
          : undefined
      }
      idleSub={
        !frame && camera?.people_count != null
          ? "people in view · from heartbeat"
          : undefined
      }
    />
  );
}

"use client";

// Camera rig: narrow-FOV perspective orbit within limits (never under the
// base, never far out), 800 ms fly-to, locked framing in compact mode, and
// the imperative API the view buttons use.
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { XY } from "./geo";

export const FOV = 28;
const MIN_POLAR = 0.14; // almost top-down
const MAX_POLAR = 1.28; // 73°, well above the base
const MIN_DIST = 70;
const MAX_DIST = 1500;
const FLY_MS = 800;

export interface View {
  target: [number, number, number];
  distance: number;
  polar: number; // radians from straight down… 0 = top, π/2 = horizon
  azimuth: number; // radians, 0 = camera south of the target looking north
}

export interface RigApi {
  rotate(deg: number): void;
  tilt(dir: "top" | "tilt"): void;
  zoom(delta: number): void;
  flyTo(view: Partial<View>, animate?: boolean): void;
  current(): View;
}

export function homeView(extent: { minX: number; minY: number; maxX: number; maxY: number }, aspect: number): View {
  const w = extent.maxX - extent.minX;
  const h = extent.maxY - extent.minY;
  const polar = Math.PI / 4;
  const azimuth = 0.3; // from the south-south-west, so the lake sits in front and Syopz is on the left
  const half = (FOV / 2) * (Math.PI / 180);
  const hHalf = Math.atan(Math.tan(half) * aspect);
  // Across the view (roughly east–west) and along it (north–south, foreshortened by the tilt).
  const across = w * Math.cos(azimuth) + h * Math.sin(azimuth);
  const along = (h * Math.cos(azimuth) + w * Math.sin(azimuth)) * Math.cos(polar) + 60;
  // The tilt foreshortens the island more than cos(polar) suggests at this FOV; 0.74 was tuned on screenshots.
  const distance = Math.max(across / 2 / Math.tan(hHalf), along / 2 / Math.tan(half)) * 0.74 + 30;
  return {
    target: [(extent.minX + extent.maxX) / 2, 0, -((extent.minY + extent.maxY) / 2) + 10],
    distance: Math.min(MAX_DIST, distance),
    polar,
    azimuth,
  };
}

export function focusView(at: XY, height: number, aspect: number, compact: boolean): Partial<View> {
  const v: Partial<View> = {
    target: [at[0], Math.min(height, 24) * 0.5, -at[1]],
    distance: compact ? 190 + 60 / Math.max(0.8, aspect) : 330,
  };
  if (compact) v.polar = 0.9;
  return v;
}

function place(camera: THREE.Camera, v: View) {
  const [tx, ty, tz] = v.target;
  camera.position.set(tx + v.distance * Math.sin(v.polar) * Math.sin(v.azimuth), ty + v.distance * Math.cos(v.polar), tz + v.distance * Math.sin(v.polar) * Math.cos(v.azimuth));
  camera.lookAt(tx, ty, tz);
}

export interface FlyRequest {
  id: number;
  view: Partial<View>;
}

export const CameraRig = forwardRef<RigApi, { initial: View; initialKey: string; fly?: FlyRequest | null; locked: boolean; reducedMotion: boolean; onChange?: (v: View) => void }>(function CameraRig(
  { initial, initialKey, fly, locked, reducedMotion, onChange },
  ref,
) {
  const controls = useRef<OrbitControlsImpl>(null);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const anim = useRef<{ from: View; to: View; t0: number } | null>(null);
  const viewRef = useRef<View>(initial);

  const read = (): View => {
    const c = controls.current;
    if (!c) return viewRef.current;
    const off = new THREE.Vector3().subVectors(camera.position, c.target);
    const sph = new THREE.Spherical().setFromVector3(off);
    return { target: [c.target.x, c.target.y, c.target.z], distance: sph.radius, polar: sph.phi, azimuth: sph.theta };
  };

  const apply = (v: View) => {
    viewRef.current = v;
    place(camera, v);
    if (controls.current) {
      controls.current.target.set(v.target[0], v.target[1], v.target[2]);
      controls.current.update();
    }
    invalidate();
    onChange?.(v);
  };

  // Apply the opening view once per key (home, or the focused camera in compact mode), not on every resize.
  const appliedKey = useRef<string | null>(null);
  useEffect(() => {
    if (appliedKey.current === initialKey) return;
    appliedKey.current = initialKey;
    anim.current = null;
    apply(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialKey]);

  const startFly = (partial: Partial<View>, animate = true) => {
    const from = read();
    const to: View = {
      target: partial.target ?? from.target,
      distance: partial.distance ?? from.distance,
      polar: partial.polar ?? from.polar,
      azimuth: partial.azimuth ?? from.azimuth,
    };
    if (!animate || reducedMotion) {
      apply(to);
      return;
    }
    anim.current = { from, to, t0: performance.now() };
    invalidate();
  };

  // Fly requests arrive as a prop so they work even if they were issued before this rig mounted.
  const flownId = useRef<number>(0);
  useEffect(() => {
    if (!fly || fly.id === flownId.current) return;
    flownId.current = fly.id;
    startFly(fly.view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fly]);

  useImperativeHandle(ref, () => ({
    rotate: (deg) => {
      const v = read();
      apply({ ...v, azimuth: v.azimuth + (deg * Math.PI) / 180 });
    },
    tilt: (dir) => {
      const v = read();
      apply({ ...v, polar: THREE.MathUtils.clamp(v.polar + (dir === "top" ? -0.22 : 0.22), MIN_POLAR, MAX_POLAR) });
    },
    zoom: (delta) => {
      const v = read();
      apply({ ...v, distance: THREE.MathUtils.clamp(v.distance * (delta > 0 ? 0.7 : 1 / 0.7), MIN_DIST, MAX_DIST) });
    },
    flyTo: (partial, animate = true) => startFly(partial, animate),
    current: read,
  }));

  useFrame(() => {
    const a = anim.current;
    if (!a) return;
    const k = Math.min(1, (performance.now() - a.t0) / FLY_MS);
    const e = k < 0.5 ? 2 * k * k : -1 + (4 - 2 * k) * k; // ease in-out
    const lerp = (x: number, y: number) => x + (y - x) * e;
    apply({
      target: [lerp(a.from.target[0], a.to.target[0]), lerp(a.from.target[1], a.to.target[1]), lerp(a.from.target[2], a.to.target[2])],
      distance: lerp(a.from.distance, a.to.distance),
      polar: lerp(a.from.polar, a.to.polar),
      azimuth: lerp(a.from.azimuth, a.to.azimuth),
    });
    if (k >= 1) anim.current = null;
    else invalidate();
  });

  return (
    <OrbitControls
      ref={controls}
      enabled={!locked}
      enablePan={false}
      enableDamping={false}
      minPolarAngle={MIN_POLAR}
      maxPolarAngle={MAX_POLAR}
      minDistance={MIN_DIST}
      maxDistance={MAX_DIST}
      rotateSpeed={0.6}
      zoomSpeed={0.8}
      makeDefault
      onChange={() => {
        viewRef.current = read();
        onChange?.(viewRef.current);
      }}
    />
  );
});

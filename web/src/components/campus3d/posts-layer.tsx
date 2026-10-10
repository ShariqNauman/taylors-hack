"use client";

// The guard-post layer of the 3D campus (Plan, section 1 "Where are the posts?").
// It tells the same story as the 2D map: a numbered blue marker per post on a
// translucent ground disc sized by incidents in 28 days, the guard's picture and
// first name, dashed for "nobody yet" and for the suggested post. Blue and ink
// only: colour means severity elsewhere, never here.
import { useMemo } from "react";
import * as THREE from "three";
import { Line } from "@react-three/drei";
import { discRadius, type PlacedPost } from "./post-tags";

export { Avatar, discRadius, PostInfoCard, PostsLegend, PostTag, type PlacedPost } from "./post-tags";

const BLUE = "#2742D9";
const BLUE_INK = "#1F35B3";
const INK = "#0B0D10";

const OVERLAY = { depthTest: false, depthWrite: false, transparent: true } as const;

/** Flat ring geometry (a thin annulus) in the XZ plane. */
function ringGeom(r: number, w: number) {
  const g = new THREE.RingGeometry(Math.max(0.1, r - w), r, 64);
  g.rotateX(-Math.PI / 2);
  return g;
}

/** Points for a dashed circle outline. */
function circlePts(r: number, y: number, n = 72): [number, number, number][] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [Math.cos(a) * r, y, Math.sin(a) * r];
  });
}

/**
 * The 3D part of one post: the translucent disc on the ground, a drop line up to
 * the marker for posts on an upper floor, and a figure at the post (a blue guard,
 * or a dashed outline when nobody is assigned). Drawn as an overlay layer so a
 * post inside a building still reads, like the circles on the 2D map.
 */
export function PostMarker3D({ post, selected, onPick }: { post: PlacedPost; selected: boolean; onPick: () => void }) {
  const r = discRadius(post.incidents28d);
  const suggested = post.status === "suggested";
  const dashed = suggested || !post.guard;
  const [x, z] = [post.at[0], -post.at[1]];
  const fill = useMemo(() => {
    const g = new THREE.CircleGeometry(r, 64);
    g.rotateX(-Math.PI / 2);
    return g;
  }, [r]);
  const solidRing = useMemo(() => ringGeom(r, selected ? 1.6 : 0.7), [r, selected]);
  const outer = useMemo(() => ringGeom(r + 2.6, 0.9), [r]);
  const click = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    onPick();
  };
  return (
    <group position={[x, post.discY, z]} renderOrder={30}>
      {/* disc */}
      <mesh geometry={fill} position={[0, 0.35, 0]} renderOrder={30} onClick={click}>
        <meshBasicMaterial color={BLUE} opacity={suggested ? 0.08 : 0.16} {...OVERLAY} />
      </mesh>
      {dashed ? (
        <Line points={circlePts(r, 0.4)} color={BLUE} lineWidth={selected ? 3.5 : 2} dashed dashSize={3.2} gapSize={2.2} renderOrder={31} {...OVERLAY} />
      ) : (
        <mesh geometry={solidRing} position={[0, 0.4, 0]} renderOrder={31}>
          <meshBasicMaterial color={BLUE} {...OVERLAY} />
        </mesh>
      )}
      {selected && (
        <mesh geometry={outer} position={[0, 0.4, 0]} renderOrder={31}>
          <meshBasicMaterial color={INK} {...OVERLAY} />
        </mesh>
      )}
      {/* drop line from the disc up to a marker on an upper floor */}
      {post.y - post.discY > 1 && <Line points={[[0, 0.4, 0], [0, post.y - post.discY, 0]]} color={BLUE_INK} lineWidth={1.5} dashed dashSize={1.6} gapSize={1.2} renderOrder={31} {...OVERLAY} />}
      {/* the person at the post */}
      {!suggested && (
        <group position={[0, post.y - post.discY, 0]} scale={1.6} onClick={click}>
          {post.guard ? <GuardFigure selected={selected} /> : <EmptyFigure />}
        </group>
      )}
    </group>
  );
}

/** A small low-poly guard (about 7 m at diorama scale) in patrol blue. */
function GuardFigure({ selected }: { selected: boolean }) {
  const c = selected ? BLUE_INK : BLUE;
  const mat = <meshBasicMaterial color={c} {...OVERLAY} opacity={0.95} />;
  return (
    <group renderOrder={32}>
      <mesh position={[-0.5, 1.2, 0]} renderOrder={32}>
        <cylinderGeometry args={[0.38, 0.42, 2.4, 8]} />
        {mat}
      </mesh>
      <mesh position={[0.5, 1.2, 0]} renderOrder={32}>
        <cylinderGeometry args={[0.38, 0.42, 2.4, 8]} />
        {mat}
      </mesh>
      <mesh position={[0, 3.7, 0]} renderOrder={32}>
        <capsuleGeometry args={[0.95, 1.6, 4, 10]} />
        {mat}
      </mesh>
      <mesh position={[0, 5.9, 0]} renderOrder={32}>
        <sphereGeometry args={[0.85, 14, 10]} />
        <meshBasicMaterial color="#F3E3CF" {...OVERLAY} />
      </mesh>
      <mesh position={[0, 6.35, 0]} renderOrder={33}>
        <sphereGeometry args={[0.88, 14, 6, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
        {mat}
      </mesh>
    </group>
  );
}

/** "Nobody yet": the dashed outline of a person, in ink, so the gap is visible. */
function EmptyFigure() {
  const outline = useMemo<[number, number, number][]>(() => {
    // Front-facing silhouette: legs, body, shoulders, head, traced once.
    const head: [number, number][] = Array.from({ length: 17 }, (_, i) => {
      const a = -Math.PI / 2 + (i / 16) * Math.PI * 2;
      return [Math.cos(a) * 0.9, 5.9 + Math.sin(a) * 0.9];
    });
    const body: [number, number][] = [
      [-0.9, 0], [-0.15, 0], [-0.15, 2.3], [0.15, 2.3], [0.15, 0], [0.9, 0], [0.95, 2.6], [1.25, 4.6], [0.9, 5.0], [0.2, 5.0],
      ...head,
      [-0.2, 5.0], [-0.9, 5.0], [-1.25, 4.6], [-0.95, 2.6], [-0.9, 0],
    ];
    return body.map(([px, py]) => [px, py, 0]);
  }, []);
  return (
    <group renderOrder={32}>
      <Line points={outline} color={INK} lineWidth={2} dashed dashSize={0.5} gapSize={0.35} renderOrder={32} {...OVERLAY} />
      <Line points={outline} color={INK} lineWidth={2} dashed dashSize={0.5} gapSize={0.35} rotation={[0, Math.PI / 2, 0]} renderOrder={32} {...OVERLAY} />
    </group>
  );
}

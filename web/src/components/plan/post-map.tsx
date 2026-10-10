"use client";

// Section 1, 2D: kept for callers of the old API. The map itself is the shared
// <CampusMap2D layer="posts"> in components/map2d.
import type { PostView } from "@/components/campus3d/types";
import { CampusMap2D } from "@/components/map2d";

export function PostMap({
  posts,
  selectedId,
  onSelect,
  picking,
  onPickPoint,
}: {
  /** Unused: the map reads the campus GeoJSON itself. */
  url?: string;
  posts: PostView[];
  selectedId?: string;
  onSelect: (id: string) => void;
  picking?: boolean;
  onPickPoint?: (p: { lat: number; lng: number }) => void;
}) {
  return <CampusMap2D layer="posts" posts={posts} selectedPostId={selectedId} onSelectPost={onSelect} picking={picking} onPickPoint={onPickPoint} />;
}

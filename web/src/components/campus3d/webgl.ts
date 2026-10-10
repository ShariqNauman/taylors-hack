"use client";

// WebGL check shared by the 3D campus and the pages' Map | 3D toggle. No three.js here.
import { useEffect, useState } from "react";

export function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

/** null until checked (first client render), then whether this browser can draw the 3D campus. */
export function useWebGL(): boolean | null {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => setOk(hasWebGL()), []);
  return ok;
}

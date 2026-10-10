"use client";

// Phone-side capabilities for the guard app: sound, vibration, screen wake lock, full screen.
import { useCallback, useEffect, useRef, useState } from "react";

interface WakeLockLike {
  release: () => Promise<void>;
  addEventListener?: (n: string, f: () => void) => void;
}

export function useGuardDevice() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const wake = useRef<WakeLockLike | null>(null);
  const buzz = useRef<ReturnType<typeof setInterval> | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const [awake, setAwake] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [canVibrate, setCanVibrate] = useState(false);

  useEffect(() => {
    audio.current = new Audio("/alarm.mp3");
    audio.current.preload = "auto";
    setCanVibrate(typeof navigator !== "undefined" && "vibrate" in navigator);
    const mq = window.matchMedia("(display-mode: standalone)");
    const nav = navigator as Navigator & { standalone?: boolean };
    setInstalled(mq.matches || nav.standalone === true);
  }, []);

  const requestWake = useCallback(async () => {
    try {
      const wl = (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<WakeLockLike> } }).wakeLock;
      if (!wl) return;
      wake.current = await wl.request("screen");
      setAwake(true);
      wake.current.addEventListener?.("release", () => {
        wake.current = null;
        setAwake(false);
      });
    } catch {
      setAwake(false);
    }
  }, []);

  /** Start my shift: must run inside the tap so the browser allows sound and full screen. */
  const unlock = useCallback(async () => {
    const a = audio.current;
    if (a) {
      try {
        a.muted = true;
        await a.play();
        a.pause();
        a.currentTime = 0;
        a.muted = false;
        setSoundOn(true);
      } catch {
        setSoundOn(false);
      }
    }
    await requestWake();
    try {
      await document.documentElement.requestFullscreen?.();
    } catch {
      // not allowed here (iPhone Safari); the installed app is full screen anyway
    }
  }, [requestWake]);

  // The wake lock drops when the tab is hidden; take it again on return.
  const wantAwake = useRef(false);
  useEffect(() => {
    const again = () => {
      if (document.visibilityState === "visible" && wantAwake.current && !wake.current) void requestWake();
    };
    document.addEventListener("visibilitychange", again);
    return () => document.removeEventListener("visibilitychange", again);
  }, [requestWake]);
  const keepAwake = useCallback((on: boolean) => {
    wantAwake.current = on;
    if (!on) {
      void wake.current?.release();
      wake.current = null;
      setAwake(false);
    }
  }, []);

  const ring = useCallback(() => {
    const a = audio.current;
    if (a) {
      a.loop = true;
      a.currentTime = 0;
      a.play().then(() => setSoundOn(true)).catch(() => setSoundOn(false));
    }
    navigator.vibrate?.([600, 250, 600, 250, 900]);
    if (buzz.current) clearInterval(buzz.current);
    buzz.current = setInterval(() => navigator.vibrate?.([600, 250, 600]), 2600);
  }, []);

  const silence = useCallback(() => {
    const a = audio.current;
    if (a) {
      a.pause();
      a.currentTime = 0;
    }
    if (buzz.current) clearInterval(buzz.current);
    buzz.current = null;
    navigator.vibrate?.(0);
  }, []);

  useEffect(() => silence, [silence]);

  return { unlock, ring, silence, keepAwake, soundOn, awake, installed, canVibrate };
}

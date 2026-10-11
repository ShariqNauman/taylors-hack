"use client";

import { useEffect, useRef } from "react";

interface DemoVideoModalProps {
  open: boolean;
  onClose: () => void;
}

export function DemoVideoModal({ open, onClose }: DemoVideoModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open && videoRef.current) {
      videoRef.current.play().catch(() => {});
    }
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="demo-video-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm animate-in fade-in-0 duration-200"
      onClick={onClose}
    >
      <div
        className="relative flex w-full max-w-4xl flex-col overflow-hidden rounded-[4px] border border-line-strong bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line bg-raised px-4 py-3">
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <span className="size-2.5 rounded-full bg-[#FF453A] animate-pulse" aria-hidden />
              <h3 id="demo-video-title" className="font-mono text-[14px] font-extrabold uppercase tracking-[0.06em] text-ink">
                EarlyEye Physical Violence Prediction Demo
              </h3>
            </div>
            <p className="text-[12px] text-ink-2">
              17-Keypoint YOLO26 Pose Estimation + LightGBM Temporal Escalation Detector on Real Surveillance Footage
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-[2px] border border-line-strong bg-white font-mono text-[16px] font-bold text-ink hover:bg-raised"
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        {/* Video Player */}
        <div className="relative aspect-[16/9] w-full bg-black">
          <video
            ref={videoRef}
            src="/demo-prediction.mp4"
            poster="/demo-poster.jpg"
            controls
            autoPlay
            loop
            playsInline
            className="h-full w-full object-contain"
          />
        </div>

        {/* Footer Metrics */}
        <div className="grid grid-cols-2 gap-2 border-t border-line bg-white p-3.5 sm:grid-cols-4">
          <div className="flex flex-col">
            <span className="font-mono text-[11px] font-bold text-ink-2">ROC-AUC SCORE</span>
            <span className="font-mono text-[15px] font-extrabold text-ink">0.887</span>
          </div>
          <div className="flex flex-col">
            <span className="font-mono text-[11px] font-bold text-ink-2">INFERENCE LATENCY</span>
            <span className="font-mono text-[15px] font-extrabold text-signal">38 ms / frame</span>
          </div>
          <div className="flex flex-col">
            <span className="font-mono text-[11px] font-bold text-ink-2">KEYPOINT TRACKING</span>
            <span className="font-mono text-[15px] font-extrabold text-ink">17-Pt + Head Halo</span>
          </div>
          <div className="flex flex-col">
            <span className="font-mono text-[11px] font-bold text-ink-2">DATA PRIVACY</span>
            <span className="font-mono text-[15px] font-extrabold text-[#10B981]">0% Face Data / Edge-Only</span>
          </div>
        </div>
      </div>
    </div>
  );
}

# EarlyEye Frontend Deployment Guide (Vercel)

This document provides step-by-step instructions for deploying the **EarlyEye Dashboard** (`web/`) to **Vercel** and linking it with the **Render Backend** and the **GraphiLab NVIDIA RTX 5090 GPU**.

---

## 1. Repository & Branch
* **Repository:** `https://github.com/ShariqNauman/taylors-hack`
* **Production Branch:** `main`

---

## 2. Vercel Project Import & Settings

1. Log in to [Vercel](https://vercel.com) and click **"Add New..."** $\rightarrow$ **"Project"**.
2. Select the repository **`ShariqNauman/taylors-hack`**.
3. In **Project Configuration**, configure the following:

| Setting | Value | Notes |
|---|---|---|
| **Framework Preset** | `Next.js` | Automatically detected |
| **Root Directory** | **`web`** | ⚠️ **Critical:** Click "Edit" and set to `web` (Next.js is in the `web/` subfolder) |
| **Build Command** | `next build` | Default |
| **Output Directory** | `.next` | Default |
| **Install Command** | `npm install` | Default |

---

## 3. Environment Variables

Under **Environment Variables**, add the following key-value pairs:

| Variable Name | Production Value | Purpose |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `https://earl-eye-backend.onrender.com` | Connects to the live FastAPI backend on Render |
| `NEXT_PUBLIC_EDGE_URL` | `https://collaboration-isolation-bar-hull.trycloudflare.com` | Connects to the GraphiLab RTX 5090 Cloud URL for live video & skeletons |
| `NEXT_PUBLIC_API_RESOURCES` | `events` | Syncs real-time events and alert triage with Render |

### Optional Environment Variables:
* `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`: *(Optional)* If provided, Deck.gl renders Google Photorealistic 3D Tiles. If omitted, the dashboard gracefully uses the built-in 3D flat campus map.

---

## 4. Deploy

Click **"Deploy"**. Vercel will build and deploy the Next.js 15 App Router application in ~1–2 minutes.

---

## 5. Post-Deployment Verification Checklist

Verify the following pages on your new Vercel URL:

- [ ] **Campus 3D View (`/`):** Renders the 3D campus map and live camera preview thumbnail.
- [ ] **Cameras Screen (`/cameras`):** `CAM-AU-01` displays `ONLINE` with the live MJPEG stream (body skeletons drawn by the RTX 5090).
- [ ] **Incidents Log (`/incidents`):** Loads incident triage records connected to Render & Supabase.
- [ ] **Patrol Plan (`/plan`):** Displays recommended security guard patrol schedules and high-risk hotspots.
- [ ] **Proof Card (`/proof`):** Shows model benchmark metrics, latency, and false alarm data.
- [ ] **Mobile Guard Simulator (`/push`):** Shows the guard push alert response interface.

---

## 6. Architecture & Data Flow

```
┌─────────────────────────────────┐
│  GraphiLab (NVIDIA RTX 5090)    │
│  - YOLO26n-Pose (250+ FPS)      │
│  - LightGBM Tension Scorer      │
│  - MJPEG Stream & Telemetry     │
└────────────────┬────────────────┘
                 │
                 │ Live Video (/stream.mjpg) & Telemetry (/live.json)
                 ▼
┌─────────────────────────────────┐         Alerts (POST /events)         ┌─────────────────────────────────┐
│     Vercel Frontend Dashboard   │ ────────────────────────────────────► │     Render Backend API          │
│     (Next.js 15 App Router)     │ ◄──────────────────────────────────── │     (FastAPI + Supabase)        │
└─────────────────────────────────┘          Triage & Status Sync         └─────────────────────────────────┘
```

* **Live Demo Webcam:** When presenting live, run `python stream_laptop_webcam.py` on the demo laptop. The RTX 5090 will seamlessly switch from recorded demo clips to the live webcam.
* **Offline Resiliency:** If the backend on Render is waking from cold start, the frontend automatically falls back to local data gracefully so the demo never crashes.

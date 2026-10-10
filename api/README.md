# EarlyEye Backend API (Web A)

FastAPI backend and analytics engine for EarlyEye — physical-aggression early warning system.

## 🛠️ Stack
- **FastAPI** + **Uvicorn**
- **Supabase Postgres** (database & storage)
- **Render** (deployment)

---

## ⚡ Quickstart

### 1. Install Dependencies
```bash
pip install -r api/requirements.txt
```

### 2. Configure Environment
Create `.env` in the project root or set environment variables:
```bash
cp api/.env.example .env
# Fill in your SUPABASE_URL and SUPABASE_KEY
```

### 3. Setup Database Schema
In your Supabase project dashboard:
1. Go to **SQL Editor**.
2. Paste and run the contents of [`api/sql/schema.sql`](./sql/schema.sql).

### 4. Seed Data (Site + History + Proof)
Run the master seed runner:
```bash
python -m api.seed.run_all
```
This populates:
- **Demo Site:** Taylor's Lakeside Campus (5 zones, 6 cameras including 1 inactive, 5 staff)
- **Proof:** Baseline ML evaluation metrics (marked with `note: "placeholder"`)
- **8-Week History:** 350+ realistic incidents with planted patterns:
  - *Hotspot 1:* Block C stairwell (Mon–Thu 13:00–14:00, 5 incidents in last 4w)
  - *Hotspot 2:* Asrama Puteri corridor (weeknights 22:00–00:00)
  - *Hotspot 3:* Car Park A (Fri 17:00–18:00)

### 5. Run API Locally
```bash
uvicorn api.main:app --reload --port 8000
```
Interactive API docs: `http://localhost:8000/docs`

---

## 📡 API Endpoints

### Core Endpoints (MUST)
| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Render uptime & health check |
| `GET` | `/site` | Site metadata, risk zones and the team (`staff`: call sign, display_name, photo_url, role, shift) |
| `GET` | `/cameras` | Camera status, online check, "black for 3 days" inactive detection |
| `POST` | `/events` | Ingest edge alert, compute priority, 2-tier staff auto-push |
| `GET` | `/events?since=<iso>` | Live incident queue for dashboard polling (2s) |
| `PATCH` | `/events/{incident_id}` | Desk: confirm / dismiss / resolve. Guard phone: `acked_at`, `arrived_at`, `outcome` (sorted / hurt / backup / nothing) + `outcome_at` |
| `GET` | `/hotspots` | Aggregated temporal/spatial incident clusters (>= 3) |
| `GET` | `/plan` | Standing guard posts (active + suggested) with this week's check-ins. First call after 06:00 MYT runs the daily recheck |
| `POST` | `/plan/recheck` | Run the recheck now: last 28 days, new patterns → `suggested`, posts quiet 14 days → `suggestion: "end"`. Never changes an active post |
| `PATCH` | `/plan/slots/{id}` | `{status}` accept / end / "Not now", `{assigned_to}` pick a guard (null = nobody; resets `seen_at`), `{seen_at}` |
| `POST` | `/plan/slots/{id}/checkins` | `{staff}` guard checked in at an active post |
| `GET` | `/proof` | Model metrics, latency, CCTV-domain, IR check |
| `PUT` | `/proof` | Update proof metrics (used by ML team) |

### Advanced Analytics & Copilot (SHOULD & CUT List)
| Method | Path | Description |
|---|---|---|
| `POST` | `/report` | Weekly executive security audit report in EN & BM citing incident IDs |
| `GET` | `/knowledge` | Browse safety standards, KPM guidelines, and Penal Code statutes |
| `POST` | `/knowledge/search` | **pgvector Semantic Search** over de-escalation protocols and SOPs |
| `POST` | `/agent/chat` | **AI Security Desk Copilot** with automated tool-calling loop |
| `GET` | `/agent/tools` | Inspect registered agent tools (cameras, incidents, RAG, dispatch) |
| `POST` | `/notifications/dispatch` | Push alert to warden with **instant 1-click WhatsApp dispatch URL** |
| `GET` | `/notifications` | Immutable audit log of all sent alerts and webhooks |
| `POST` | `/events/{id}/clip` | Register/store 10s incident video buffer & thumbnail keyframe |
| `GET` | `/events/{id}/clip` | Retrieve video playback URL and metadata for an incident |
| `GET` | `/sites` | **Multi-Site Catalog** (Universities, Boarding Hostels, Malls) |
| `POST` | `/auth/login` | **JWT Role-Based Auth** (`operator`, `warden`, `manager`, `admin`) |
| `GET` | `/auth/me` | Fetch authenticated staff profile and active sector |

### Standing guard posts (migration_plan_guard.sql)
Run `api/sql/migration_plan_guard.sql` once in the Supabase SQL editor. Until then `GET /plan` answers
with posts generated from hotspots and the slot write routes return 503. Rules live in
`api/services/plan_logic.py` (tests: `python api/test_plan_logic.py`).

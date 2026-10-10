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

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Render uptime & health check |
| `GET` | `/site` | Site metadata and configured risk zones |
| `GET` | `/cameras` | Camera status, online check, inactive warnings |
| `POST` | `/events` | Ingest edge alert, compute priority, 2-tier push |
| `GET` | `/events?since=<iso>` | Live incident queue for dashboard polling (2s) |
| `PATCH` | `/events/{incident_id}` | Operator confirm / dismiss / resolve action |
| `GET` | `/hotspots` | Aggregated temporal/spatial incident clusters (>= 3) |
| `GET` | `/plan` | Weekly automated patrol plan (Decide screen) |
| `GET` | `/proof` | Model metrics, latency, CCTV-domain, IR check |
| `PUT` | `/proof` | Update proof metrics (used by ML team) |

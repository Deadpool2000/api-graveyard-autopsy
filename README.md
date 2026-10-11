# API Graveyard Autopsy

**Find API endpoints that may be ready for retirement—with evidence, not guesses.**

API Graveyard Autopsy is an evidence-based API lifecycle investigator that compares an API's **declared contract** (OpenAPI 3.x), **implemented backend routes** (CSV/JSON route inventory), and **observed runtime traffic** (CSV/JSON request logs) to identify endpoint mismatches, shadow/undocumented routes, broken contracts, and quiet endpoints needing human review.

It combines deterministic Python rule evaluation and heuristic review-priority scoring with **Google Gemini** for evidence-grounded investigation, cross-source reasoning, natural-language Q&A, and safe human verification planning—with automatic Redis caching and deterministic fallback when Gemini is unconfigured or rate-limited.

---

## Architecture & Container Topology

The project runs in Docker Compose with **5 dedicated containers** optimized behind **Nginx**:

```text
Browser (http://localhost or http://localhost:8088)
  │
  ▼
[aga-nginx] (Nginx 1.27 Reverse Proxy & Optimization Layer)
  ├── Gzip compression (JSON, Markdown, JS, CSS)
  ├── Immutable static asset caching (/_next/static/*)
  ├── Rate limiting (general API & Gemini AI endpoints)
  ├── Upstream keepalive connection pooling & security headers
  │
  ├──────────────────────────────► [aga-frontend] (Next.js 14 App Router UI, port 3000)
  │
  └─ /api/* & /health ───────────► [aga-backend]  (FastAPI REST Service, port 8000)
                                        │
                                        ├────────► [aga-redis] (Redis 7 — Job Queue, State & AI Cache)
                                        │               ▲
                                        │               │
                                        │          [aga-worker] (Dedicated Python Analysis Worker)
                                        │
                                        └────────► Google Gemini API (Server-side only, validated via Pydantic)
```

---

## Prerequisites

- **Docker** (24.0+) and **Docker Compose** (v2+)
- Optional: A **Google Gemini API Key** from [Google AI Studio](https://aistudio.google.com/) (free tier supported; the entire application and demo dataset also work offline with deterministic fallback if no key is configured).

---

## Quick Start & `.env` Configuration

### 1. Configure Your API Key in `.env`

A local `.env` file is already created in the repository root (and excluded from Git via `.gitignore`). Open `.env` and paste your Google Gemini API key:

```env
GEMINI_API_KEY=your_actual_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-flash
GEMINI_ENABLED=true
GEMINI_TIMEOUT_SECONDS=15
GEMINI_MAX_OUTPUT_TOKENS=1024
```

> **Note:** Because `.env` is bind-mounted read-only into `aga-backend` and `aga-worker` and read dynamically per request, you can even paste or update `GEMINI_API_KEY` in `.env` while the containers are already running!
>
> **Model Availability Note:** Free-tier availability and quotas depend on the selected model (`gemini-2.5-flash`, `gemini-2.0-flash`, etc.) and your Google AI Studio account limits. You can change `GEMINI_MODEL` in `.env` at any time without code changes.

### 2. Start All Containers with Docker Compose

```bash
docker compose up --build -d
```

Check container health:

```bash
docker compose ps
```

### 3. Open the Application

- **Via Optimized Nginx Proxy (Recommended):** [http://localhost](http://localhost) or [http://localhost:8088](http://localhost:8088)
- **Direct Next.js Frontend:** [http://localhost:3000](http://localhost:3000)
- **FastAPI Backend Health & OpenAPI Docs:** [http://localhost:8000/health](http://localhost:8000/health) and [http://localhost:8000/docs](http://localhost:8000/docs)

---

## 90-Second Demo Walkthrough

1. Open [http://localhost:8088](http://localhost:8088) (or [http://localhost](http://localhost)).
2. Click **Try Built-in Demo Dataset**.
   - Loads `sample-data/openapi.json`, `sample-data/routes.csv`, and `sample-data/access-logs.csv`.
3. Inspect the **Summary Metric Cards** and **Prioritized Findings Queue**:
   - **Documented but not implemented (`High`):** `DELETE /api/v1/users/{param}/gdpr-purge` and `POST /api/v2/webhooks/test-delivery`.
   - **Observed / Implemented but undocumented (`Medium`):** `GET /api/v1/admin/debug-config`, `GET /api/v1/legacy/v0/status`, `POST /api/v1/internal/metrics/flush`.
   - **Implemented / Documented but not observed (`Review`):** `GET /api/v1/reports/export` and `GET /api/v1/reports/annual-tax-export` (demonstrates why *"not observed in a 14-day log sample"* does **not** mean *"safe to delete"*).
   - **Data-quality issue (`Informational`):** Duplicate route registration for `GET /api/v1/reports/export`, malformed log timestamp/verb warnings, and automatic query token redaction.
   - **Conservative Path Normalization:** Notice `GET /api/v1/users/me` is preserved as a distinct static route and never merged into `GET /api/v1/users/{param}`.
4. Click any finding and press **Investigate with AI** to view the evidence-grounded interpretation, uncertainties, and verification checklist.
5. Click **Generate Executive Summary** or **Generate Investigation Plan**, or ask a question in **Ask This Analysis** (e.g., *"Which findings should I investigate first, and why?"*).
6. Click **Export .MD** or **Export .JSON** in the top navigation bar to download the complete audit report.

---

## Input File Formats

### 1. OpenAPI Specification (`openapi.json` / `openapi.yaml`)
Standard OpenAPI 3.x JSON or YAML document containing a `paths` object.

### 2. Backend Route Inventory (`routes.csv` or `routes.json`)
CSV columns (minimum `method,path`):
```csv
method,path,framework,source_file,line_number
GET,/api/v1/users,fastapi,app/routers/users.py,18
GET,/api/v1/users/{id},fastapi,app/routers/users.py,52
```

### 3. Request Logs (`access-logs.csv` or `access-logs.json`)
CSV columns (minimum `timestamp,method,path,status_code`):
```csv
timestamp,method,path,status_code,request_id,latency_ms,environment
2026-10-05T11:30:00Z,GET,/api/v1/users/42,200,req-1006,31,prod
```

---

## Running Automated Tests

Run the test suite inside the backend container:

```bash
docker compose exec backend pytest -v
```

Or run locally with Python 3.12+:

```bash
PYTHONPATH=backend pytest backend/tests -v
```

---

## Troubleshooting

- **AI Status shows `AI Fallback Mode`:** Ensure `GEMINI_API_KEY` in `.env` is set to a valid key from Google AI Studio (not empty or `replace_me`) and `GEMINI_ENABLED=true`.
- **Port 80 conflict on host:** `docker-compose.yml` exposes Nginx on both `NGINX_PORT` (default `80`) and `NGINX_ALT_PORT` (default `8088`). Update `NGINX_PORT` in `.env` if port `80` is already bound on your machine.
- **Quota / HTTP 429 Errors:** The Gemini free tier has rate limits per minute/day. Repeated requests for the same finding or question are served from Redis cache (`aga-redis`), and any rate-limited call gracefully falls back to deterministic templates without breaking the dashboard.


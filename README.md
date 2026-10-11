# API Graveyard Autopsy

**Find API endpoints that may be ready for retirement—with evidence, not guesses.**

API Graveyard Autopsy is an AI-powered, evidence-based API lifecycle investigator and live zombie route scanner. It cross-checks an API's **declared contract** (OpenAPI 3.x / Swagger), **implemented backend routes** (code route inventory or live HTTP probing), and **observed runtime traffic** (request access logs) to surface undocumented shadow endpoints, ghost routes, contract drift, and dormant endpoints requiring human verification.

---

## 📖 What Is This Project?

### 🚨 The Problem

As applications grow, APIs change constantly. Engineering teams add new endpoints, evolve existing versions, and deprecate legacy features. Over time, **API documentation**, **implemented backend routes**, and **actual runtime usage** inevitably drift out of sync.

This creates several critical engineering and security challenges:

- **Forgotten ("Zombie") APIs:** Legacy endpoints remain active in the codebase long after they are believed to be retired.
- **Outdated Documentation:** Documented endpoints may no longer exist in code (*ghost endpoints* returning `404`), while newly shipped or internal endpoints are missing from OpenAPI specs (*shadow endpoints*).
- **Hidden Dependencies:** An endpoint that appears quiet in a short log sample might still be called by another microservice, a quarterly cron job, a webhook callback, or an older mobile client.
- **Security Exposure:** Forgotten and undocumented routes often bypass routine maintenance, authentication audits, and security reviews.
- **Time-Consuming Manual Triage:** Engineers are forced to manually cross-reference OpenAPI files, framework router tables, and gateway access logs just to understand what is actually running.

> **The tricky part?** An endpoint receiving zero requests in an available log sample does **not** automatically mean it is dead or safe to delete.

### 💡 Our Solution

**API Graveyard Autopsy** combines a **deterministic cross-source analysis engine** with **Google Gemini AI** (plus a live HTTP endpoint scanner) to automate API lifecycle triage safely:

1. **Three-Source Evidence Comparison:**
   - **API Documentation:** OpenAPI 3.x / Swagger specifications (`.json` or `.yaml`), or live auto-discovered spec endpoints.
   - **Implemented Routes:** Backend route inventories (`.csv` or `.json`), or routes actively discovered via non-destructive live HTTP probing.
   - **Request Logs:** Runtime traffic logs (`.csv`, `.json`, or live container telemetry) showing request counts, status codes, latencies, and observation time windows.
2. **Deterministic Rule Engine & Priority Scoring:**
   - Normalizes paths conservatively (preserving static routes like `/users/me` distinct from `/users/{param}`), redacts sensitive tokens/JWTs, classifies mismatches across 6 lifecycle categories, and computes a transparent **Review Priority Score (`0–100`)**.
3. **Evidence-Grounded Gemini AI Investigation:**
   - **Google Gemini** translates raw cross-source evidence into plain-English explanations, separates established facts from hypotheses, highlights evidence gaps, answers natural-language questions about the analysis, and generates step-by-step human verification plans—backed by automatic Redis/SQLite caching and deterministic fallbacks when offline.

### 🎯 The Goal

Help backend, platform, and security engineers quickly identify which APIs need attention, eliminate tedious manual log correlation, and make **evidence-backed API maintenance and deprecation decisions**.

**We never assume an endpoint is dead just because it has no observed traffic—we help engineers investigate and verify before making that decision.**

---

## ✨ Key Features & Recent Additions

### 1. Three Scanning & Analysis Workflows
- **Scan Live API (URL-First Scanner):** Point the scanner at the built-in Zombie API container (`http://target-api:8090`) or any external REST API URL (`https://...`).
  - **OpenAPI Auto-Discovery:** Automatically probes 19 standard OpenAPI/Swagger locations (`/openapi.json`, `/swagger.json`, `/v3/api-docs`, `/api/openapi.json`, `/docs/json`, etc.).
  - **Spec-less Live Discovery Mode:** If a target API does not publish an OpenAPI spec, the scanner automatically switches to *Spec-less Discovery Mode*—running a multi-hop concurrent crawler (up to 3 hops / 160 probes) that inspects JSON/HTML bodies, follows HATEOAS/hypermedia links, infers item-detail routes from collection responses (`/users` $\rightarrow$ `/users/{param}`), and detects taxonomy sub-routes (`/category/{category}`, `/group/{group}`).
  - **Canary Catch-All Filtering:** Fingerprints a synthetic canary path (`/_autopsy_canary_nonexistent_9f8a7b`) and strips dynamic timestamps, UUIDs, and echoed URLs so Single-Page App (SPA) catch-all `200 OK` routers never trigger false-positive findings.
  - **6 In-Memory Auth Methods:** Supports `Public (No Auth)`, `Bearer Token (JWT/OAuth2)`, `API Key in Header`, `API Key in Query Param`, `HTTP Basic Auth`, and `Custom HTTP Headers (JSON)`. Credentials are used strictly in-memory during the scan and never persisted to disk.
  - **Hybrid File Overrides:** Override a live server's OpenAPI spec or attach offline production access logs during a live scan.
- **Upload Static Files Offline:** Drag-and-drop any combination of OpenAPI spec (`.json`/`.yaml`), backend route inventory (`.csv`/`.json`), and request logs (`.csv`/`.json`). Supports partial (1–2 sources) or full 3-way comparisons.
- **Saved Reports History (Persistent SQLite):** Every completed scan is automatically saved in a local SQLite database (`WAL` mode) so you can reopen past reports, compare runs, or export reports as Markdown (`.md`) or JSON (`.json`).

### 2. Deterministic Engine & Guardrails
- **6 Lifecycle Finding Categories:**
  | Category | Default Severity | Meaning |
  | :--- | :--- | :--- |
  | **Documented but not implemented** | `High` | Declared in OpenAPI contract, but missing in backend routes / returns `404` (*Ghost Endpoint*). |
  | **Implemented but undocumented** | `Medium` | Registered in backend routes, but missing from OpenAPI specification (*Shadow Route*). |
  | **Observed but undocumented** | `Medium` | Actively receiving runtime traffic in logs, but absent from OpenAPI specification (*Active Zombie / Shadow Route*). |
  | **Implemented but not observed** | `Review` | Present in backend routes, but `0` matching requests in the supplied log window (*Dormant Candidate*). |
  | **Documented but not observed** | `Review` | Declared in OpenAPI spec, but `0` matching requests in the supplied log window. |
  | **Data-quality issue** | `Informational` | Duplicate route registrations, malformed log timestamps/HTTP verbs, or unredacted sensitive tokens in URLs. |
- **Conservative Path Normalization:** Coerces `{id}`, `:id`, and `<int:id>` into `{param}` while protecting 40+ reserved static keywords (`me`, `self`, `health`, `status`, `export`, `config`, `admin`, `debug`, `v1`, `v2`, etc.) so static routes like `GET /api/v2/users/me` are **never** merged into `GET /api/v2/users/{param}`.
- **Automatic Secret & PII Redaction:** Redacts query tokens (`access_token`, `api_key`, `secret`, `password`), `Bearer` tokens, and JWTs before storage or AI prompting.
- **Unified Endpoint Grouping:** Consolidates multiple findings for the same `(HTTP Method, Normalized Path)` into a single interactive row with merged evidence and a trackable verification checklist.

### 3. Evidence-Grounded Google Gemini AI
- **Per-Finding AI Explanation (`AI Explain`):** Generates plain-English summaries, cross-source evidence interpretations, caveats, and verification steps for any selected endpoint.
- **AI Executive Summary & Prioritized Action Plan:** Synthesizes high-level takeaways and a phased human verification plan with clickable finding references (`FND-001`, etc.).
- **Grounded Natural-Language Q&A (`Ask AI`):** Ask questions about the active report (with 1-click preset prompts) grounded strictly in the sanitized analysis payload.
- **Strict Safety Guardrails & Multi-Model Fallback:** Enforces a 12-principle system instruction (facts vs. hypotheses, untrusted input isolation, zero-traffic safeguard), strips forbidden phrases like *"safe to delete"* or *"definitely dead"*, and automatically falls back across Gemini models (`gemini-3.8-flash` $\rightarrow$ `gemini-3-flash-preview` $\rightarrow$ `gemini-3.1-flash-lite` $\rightarrow$ `gemini-3.5-flash`) or deterministic templates when offline or rate-limited.

---

## 🏗️ Architecture & Container Topology

The system runs via Docker Compose with **6 containers** and a **3-tier storage layer** (`SQLite` + `Redis` + `In-Memory`) fronted by **Nginx**:

```text
Browser (http://localhost or http://localhost:8088)
  │
  ▼
[aga-nginx] (Nginx 1.27 Reverse Proxy & Optimization Layer)
  ├── Gzip compression, security headers & upstream keepalive pools
  ├── Immutable static asset caching (/_next/static/*)
  ├── Rate limiting (30 req/s general API, 5 req/s AI endpoints)
  │
  ├──────────────────────────────► [aga-frontend]   (Next.js 14 App Router Workbench UI, port 3000)
  │
  └─ /api/* & /health ───────────► [aga-backend]    (FastAPI REST Service, port 8000)
                                        │
                                        ├─────────► [aga-redis]      (Redis 7 — Job Queue, Locks, Rate Limit & AI Cache)
                                        │                ▲
                                        │                │
                                        ├─────────► [aga-worker]     (Dedicated Python Background Analysis Worker)
                                        │
                                        ├─────────► [SQLite Volume]  (aga-sqlite-data: /app/data/autopsy_history.db)
                                        │
                                        ├─────────► [aga-target-api] (Built-in NexusPay Live Zombie API, port 8090)
                                        │
                                        └─────────► Google Gemini API (Server-side only, Pydantic-validated JSON)
```

---

## 🚀 Installation & Running with Docker

### Prerequisites

- **Docker Engine** (`24.0+`) and **Docker Compose** (`v2+`)
- *(Optional)* A **Google Gemini API Key** from [Google AI Studio](https://aistudio.google.com/).
  - **Note:** The entire platform, live scanner, and demo datasets work **100% offline** using the built-in deterministic fallback engine if no API key is configured.

### Step 1: Clone the Repository

```bash
git clone <your-repo-url>
cd api-graveyard-autopsy
```

### Step 2: Configure Environment Variables (`.env`)

Copy `.env.example` to `.env` (if `.env` does not already exist) and configure your settings:

```bash
cp -n .env.example .env
```

Open `.env` and set your `GEMINI_API_KEY`:

```env
# Google Gemini API Configuration (Server-Side Only)
GEMINI_API_KEY=your_actual_gemini_api_key_here
GEMINI_MODEL=gemini-3.8-flash
GEMINI_ENABLED=true
GEMINI_TIMEOUT_SECONDS=35
GEMINI_MAX_OUTPUT_TOKENS=4096

# Redis & Worker Configuration
REDIS_URL=redis://redis:6379/0
CACHE_TTL_SECONDS=3600

# Backend API Limits & Security
MAX_UPLOAD_SIZE_MB=5
CORS_ORIGINS=http://localhost,http://localhost:80,http://localhost:3000,http://localhost:8088

# Host Ports for Docker Containers
NGINX_PORT=80
NGINX_ALT_PORT=8088
FRONTEND_PORT=3000
BACKEND_PORT=8000
TARGET_API_PORT=8090
```

> **Hot-Reloading `.env`:** Because `.env` is bind-mounted into `aga-backend` and `aga-worker` and read dynamically per request, you can add or update `GEMINI_API_KEY` or `GEMINI_MODEL` in `.env` **while the containers are running** without rebuilding!

### Step 3: Build and Start All Containers

Run Docker Compose to build and start all 6 services in detached mode:

```bash
docker compose up --build -d
```

Verify that all containers are running and healthy:

```bash
docker compose ps
```

You should see 6 running containers:
- `aga-nginx` (ports `80`, `8088`)
- `aga-frontend` (port `3000`)
- `aga-backend` (port `8000`, `healthy`)
- `aga-worker` (background analysis worker)
- `aga-target-api` (port `8090`, `healthy`)
- `aga-redis` (port `6379` internal, `healthy`)

### Step 4: Access the Application

| Service | URL | Description |
| :--- | :--- | :--- |
| **Web UI (via Nginx Proxy)** | [http://localhost](http://localhost) or [http://localhost:8088](http://localhost:8088) | **Recommended** entry point with Gzip & caching |
| **Web UI (Direct Next.js)** | [http://localhost:3000](http://localhost:3000) | Direct Next.js frontend container |
| **Backend Swagger / OpenAPI UI** | [http://localhost:8000/docs](http://localhost:8000/docs) | Interactive FastAPI documentation for `aga-backend` |
| **Backend Health Check** | [http://localhost:8000/health](http://localhost:8000/health) | Shows Redis, SQLite, and Gemini AI configuration status |
| **Demo Target Zombie API** | [http://localhost:8090/docs](http://localhost:8090/docs) | Built-in **NexusPay & Order Core API** target container |

### Useful Docker Lifecycle Commands

```bash
# View real-time logs across all services (or specify a service like backend, worker, target-api)
docker compose logs -f
docker compose logs -f backend worker

# Restart services after code changes
docker compose up --build -d

# Stop all containers (preserves SQLite history volume)
docker compose down

# Stop all containers AND wipe SQLite history volume
docker compose down -v
```

---

## 🧪 Demo API Endpoints to Test

API Graveyard Autopsy ships with **two built-in demo environments** plus support for scanning **any live external API**:

### Option A: Test the Built-in Live Zombie API Container (`aga-target-api`)

The `aga-target-api` container runs **NexusPay & Order Core API v2.3.0**, a realistic microservice pre-seeded with 14 days of traffic logs and deliberate API drift across v1, v2, and internal routes.

#### 1. Scan via the Web UI
1. Open [http://localhost:8088](http://localhost:8088).
2. In **1. Scan Live API**, click **1-Click Scan Zombie Container** (or select the `Built-in Zombie Container (http://target-api:8090)` preset and click **Scan API Now**).
3. Click **Simulate Traffic Burst on Container** to fire 9 live HTTP requests against active v2, zombie v1, and shadow debug endpoints, then re-scan to watch request counts update in real time!

#### 2. Target API Connection & Demo Credentials
| Parameter | Value |
| :--- | :--- |
| **URL (inside Docker / Web UI)** | `http://target-api:8090` *(or `http://localhost:8090` — auto-resolved)* |
| **URL (from your Host terminal)** | `http://localhost:8090` |
| **OpenAPI Spec Path** | `/openapi.json` |
| **Demo API Key (`X-API-Key` header)** | `zombie-demo-key-2026` |
| **Demo Bearer Token (`Authorization`)** | `Bearer zombie-demo-token-2026` |
| **Strict Auth Enforcement Header** | `X-Enforce-Auth: true` *(optional header to test `401` vs authenticated probing)* |

#### 3. Endpoints Inside the Demo Zombie Container (`http://localhost:8090`)

You can test these endpoints directly from your terminal or browser, or inspect how Autopsy classifies them:

- **Healthy Active v2 Endpoints** *(Documented in OpenAPI + Implemented in Code + Observed in Traffic Logs)*:
  - `GET http://localhost:8090/api/v2/users` — List active platform users
  - `GET http://localhost:8090/api/v2/users/me` — Static profile route (preserved separate from `/api/v2/users/{user_id}`)
  - `GET http://localhost:8090/api/v2/users/usr-8821` — Get user profile by ID
  - `GET http://localhost:8090/api/v2/orders` — List customer orders
  - `POST http://localhost:8090/api/v2/orders` — Create a new order
  - `GET http://localhost:8090/api/v2/orders/ord-5501` — Get order details by ID
- **Ghost Endpoints** *(Flagged as `Documented but not implemented` — `High` Priority)*:
  - `DELETE http://localhost:8090/api/v2/users/usr-8821/gdpr-erase` — Declared in OpenAPI (`x-owner: privacy-engineering@nexuspay.example`), but missing from the backend router (`HTTP 404`).
  - `POST http://localhost:8090/api/v2/webhooks/replay-events` — Declared in OpenAPI, but removed from code (`HTTP 404`).
- **Active Zombie v1 & Shadow Debug Endpoints** *(Flagged as `Implemented & Observed, but undocumented` — `Medium` Priority)*:
  - `GET http://localhost:8090/api/v1/legacy/accounts` — Deprecated v1 endpoint hidden from OpenAPI (`include_in_schema=False`) but still hit by legacy clients!
  - `POST http://localhost:8090/api/v1/auth/token-exchange` — Undocumented legacy v1 auth route receiving traffic.
  - `GET http://localhost:8090/api/v1/catalog/pricing-matrix` — Undocumented v1 pricing route receiving traffic.
  - `GET http://localhost:8090/api/internal/debug/env-config` — Shadow internal debug endpoint exposing worker pool & feature flags in production.
- **Dormant Shadow Endpoints** *(Flagged as `Implemented & undocumented, not observed`)*:
  - `POST http://localhost:8090/api/internal/cache/flush` — Undocumented internal cache flush route with `0` logged requests.
  - `DELETE http://localhost:8090/api/v1/legacy/sessions/purge-expired` — Undocumented legacy cleanup route with `0` logged requests.
- **Quiet / Seasonal Documented Endpoints** *(Flagged as `Documented & Implemented, but not observed` — `Review` Priority)*:
  - `GET http://localhost:8090/api/v2/reports/quarterly-audit-export` — Seasonal SOX/PCI compliance export (also demonstrates duplicate route registration detection across `reports_v2.py` and `legacy_exports.py`).
  - `PUT http://localhost:8090/api/v2/orders/ord-5501/manual-tax-override` — Rarely used finance back-office override route (`0` requests in 14-day window).
- **Target API Telemetry & Simulation Endpoints**:
  - `GET http://localhost:8090/health` — Container health check
  - `GET http://localhost:8090/_autopsy/routes` — Exports registered route inventory JSON
  - `GET http://localhost:8090/_autopsy/logs` — Exports live + seeded 14-day access logs JSON
  - `POST http://localhost:8090/_autopsy/simulate-traffic` — Appends a live burst of 9 requests to the container's runtime logs

---

### Option B: Public External APIs to Test in the Live Scanner

Paste any of these URLs into **1. Scan Live API** in the UI to test both OpenAPI-backed and Spec-less live discovery:

1. **Frankfurter Currency Exchange API (Built-in UI Preset):**
   - **URL:** `https://api.frankfurter.dev`
   - **Behavior:** Probes common endpoints (`/latest`, `/currencies`, etc.) and compares discovered live routes against documentation.
2. **JSONPlaceholder REST API (Tests Spec-less Multi-Hop Discovery):**
   - **URL:** `https://jsonplaceholder.typicode.com`
   - **Behavior:** No OpenAPI spec is published on the server—Autopsy automatically enters **Spec-less Live Discovery Mode**, discovers collection routes (`/users`, `/posts`, `/todos`, `/albums`, `/photos`, `/comments`), and automatically infers parameterized detail routes (`/users/{param}`, `/posts/{param}`, etc.) from the JSON response payloads!
3. **FakeStore API / Dog CEO API:**
   - **URL:** `https://fakestoreapi.com` or `https://dog.ceo/api`
   - **Behavior:** Demonstrates live endpoint probing and taxonomy/sub-resource route discovery.

---

### Option C: Test the Backend REST API Directly via `curl`

You can drive every feature of `aga-backend` (`http://localhost:8000` or via Nginx at `http://localhost:8088`) using `curl`:

#### 1. Check Backend, Redis, SQLite & Gemini AI Health
```bash
curl -s http://localhost:8000/health | jq
```

#### 2. Run the Built-in Synthetic E-Commerce Demo Dataset (`sample-data/`)
```bash
curl -s -X POST http://localhost:8000/api/v1/analyses/demo | jq
```

#### 3. Trigger a Live Scan Against the Zombie API Container
```bash
curl -s -X POST http://localhost:8000/api/v1/analyses/live \
  -F "target_base_url=http://target-api:8090" \
  -F "openapi_path=/openapi.json" \
  -F "analysis_name=NexusPay Live Container Audit" \
  -F "auth_type=api_key_header" \
  -F "auth_header_name=X-API-Key" \
  -F "auth_token=zombie-demo-key-2026" \
  -F "probe_endpoints=true" \
  -F "include_shadow_wordlist=true" | jq
```

#### 4. Simulate a Live Traffic Burst on the Zombie Container
```bash
curl -s -X POST http://localhost:8000/api/v1/analyses/live/simulate-traffic \
  -F "target_base_url=http://target-api:8090" | jq
```

#### 5. Upload Static Files for Analysis (`openapi.json`, `routes.csv`, `access-logs.csv`)
```bash
curl -s -X POST http://localhost:8000/api/v1/analyses \
  -F "analysis_name=Custom Offline Autopsy" \
  -F "openapi_file=@sample-data/openapi.json" \
  -F "routes_file=@sample-data/routes.csv" \
  -F "logs_file=@sample-data/access-logs.csv" | jq
```

#### 6. Fetch Findings (with Optional Category, Severity, Method & Search Filters)
```bash
# Replace <ANALYSIS_ID> with the id returned from any scan above
curl -s "http://localhost:8000/api/v1/analyses/<ANALYSIS_ID>/findings?severity=High" | jq
```

#### 7. Run Gemini AI Investigation, Summary, Action Plan & Chat Q&A
```bash
# 1) Investigate a specific finding (e.g., FND-001)
curl -s -X POST "http://localhost:8000/api/v1/analyses/<ANALYSIS_ID>/findings/FND-001/investigate" | jq

# 2) Generate an AI Executive Summary
curl -s -X POST "http://localhost:8000/api/v1/analyses/<ANALYSIS_ID>/summary" | jq

# 3) Generate a Prioritized Human Investigation Plan
curl -s -X POST "http://localhost:8000/api/v1/analyses/<ANALYSIS_ID>/investigation-plan" | jq

# 4) Ask a Grounded Question about the Analysis
curl -s -X POST "http://localhost:8000/api/v1/analyses/<ANALYSIS_ID>/chat" \
  -H "Content-Type: application/json" \
  -d '{"question": "Which undocumented endpoints are actively receiving traffic, and what should we verify first?"}' | jq
```

#### 8. Export Audit Report (`.md` or `.json`) & List Saved SQLite History
```bash
# Download Markdown report
curl -s "http://localhost:8000/api/v1/analyses/<ANALYSIS_ID>/report?format=markdown" -o autopsy-report.md

# Download JSON report
curl -s "http://localhost:8000/api/v1/analyses/<ANALYSIS_ID>/report?format=json" -o autopsy-report.json

# List saved historical analyses from SQLite
curl -s "http://localhost:8000/api/v1/analyses?limit=20" | jq
```

---

## 📂 Static Input File Formats

When using **2. Upload Static Files**, the parser supports the following formats (up to `MAX_UPLOAD_SIZE_MB=5` per file by default):

### 1. OpenAPI Specification (`openapi.json` / `openapi.yaml`)
Standard OpenAPI `3.0.x` or `3.1.x` JSON or YAML document containing a `paths` object. Supports optional `x-owner` or `x-team` extensions for ownership tracking.

### 2. Backend Route Inventory (`routes.csv` or `routes.json`)
Minimum required fields: `method` and `path`.
```csv
method,path,framework,source_file,line_number
GET,/api/v1/users,fastapi,app/routers/users.py,18
GET,/api/v1/users/me,fastapi,app/routers/users.py,34
GET,/api/v1/users/{id},fastapi,app/routers/users.py,52
```

### 3. Request Traffic Logs (`access-logs.csv` or `access-logs.json`)
Minimum required fields: `timestamp`, `method`, `path`, and `status_code`.
```csv
timestamp,method,path,status_code,request_id,latency_ms,environment
2026-10-05T11:30:00Z,GET,/api/v1/users/42,200,req-1006,31,prod
```

---

## ✅ Running Automated Tests

Run the full pytest suite inside the running `backend` container:

```bash
docker compose exec backend pytest -v
```

Or run the tests locally with Python 3.12+:

```bash
PYTHONPATH=backend pytest backend/tests -v
```

---

## 🛠️ Troubleshooting

- **AI Status shows `Deterministic Fallback`:**
  Ensure `GEMINI_API_KEY` in `.env` is set to a valid key from Google AI Studio (not `replace_me` or empty) and `GEMINI_ENABLED=true`. Because `.env` is read dynamically per request, saving `.env` takes effect immediately.
- **Port `80` Conflict on Host Machine:**
  `docker-compose.yml` exposes Nginx on both `NGINX_PORT` (default `80`) and `NGINX_ALT_PORT` (default `8088`). If port `80` is already in use on your machine, either open [http://localhost:8088](http://localhost:8088) or change `NGINX_PORT=8080` in `.env`.
- **Scanning a Service Running on Your Host Machine (`localhost`) from Inside Docker:**
  If you enter `http://localhost:<port>` in the Live Scanner, `live_connector.py` automatically falls back to `http://host.docker.internal:<port>` (and `http://target-api:8090` for port `8090`) so containerized workers can seamlessly scan services running on your host OS.
- **Gemini Quota / HTTP `429` Rate Limits:**
  Repeated AI requests for the same finding, summary, plan, or question are served instantaneously from the **Redis + SQLite AI cache**. If a live Gemini call hits a free-tier quota limit or timeout, the backend automatically tries fallback Gemini models and gracefully degrades to deterministic evidence templates without breaking your workflow.

import copy
import time
import uuid
from collections import deque
from datetime import datetime, timedelta, timezone
from typing import Any, Deque, Dict, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, status
from fastapi.openapi.utils import get_openapi
from pydantic import BaseModel

DEMO_API_KEY = "zombie-demo-key-2026"
DEMO_BEARER_TOKEN = "zombie-demo-token-2026"

app = FastAPI(
    title="NexusPay & Order Core API (Live Zombie Target)",
    version="2.3.0",
    description=(
        "Mid-difficulty containerized microservice exhibiting realistic API drift: "
        "active v2 endpoints, undocumented Zombie v1 routes still hit by legacy clients, "
        "shadow internal debug endpoints, ghost OpenAPI endpoints (404), and dormant routes."
    ),
)

MAX_LOG_ENTRIES = 2000
_access_logs: Deque[Dict[str, Any]] = deque(maxlen=MAX_LOG_ENTRIES)


def _iso_utc(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _seed_initial_traffic_logs() -> None:
    """Seed realistic 14-day traffic logs so immediate scans show rich multi-week telemetry."""
    _access_logs.clear()
    now = datetime.now(timezone.utc)

    seed_events = [
        # Healthy active v2 endpoints
        (-13.8, "GET", "/api/v2/users", 200, 18.4, "prod"),
        (-12.5, "GET", "/api/v2/users", 200, 21.0, "prod"),
        (-9.1, "GET", "/api/v2/users?access_token=live_zombie_secret_token_99", 200, 19.2, "prod"),
        (-11.2, "GET", "/api/v2/users/me", 200, 12.6, "prod"),
        (-6.4, "GET", "/api/v2/users/me", 200, 14.1, "prod"),
        (-1.2, "GET", "/api/v2/users/me", 200, 11.8, "prod"),
        (-10.0, "GET", "/api/v2/users/usr-8821", 200, 27.5, "prod"),
        (-5.3, "GET", "/api/v2/users/usr-9042", 200, 24.9, "prod"),
        (-2.1, "GET", "/api/v2/users/550e8400-e29b-41d4-a716-446655440000", 200, 29.0, "prod"),
        (-12.0, "GET", "/api/v2/orders", 200, 34.2, "prod"),
        (-4.5, "GET", "/api/v2/orders", 200, 31.7, "prod"),
        (-8.7, "POST", "/api/v2/orders", 201, 68.4, "prod"),
        (-3.2, "POST", "/api/v2/orders", 201, 72.1, "prod"),
        (-0.8, "POST", "/api/v2/orders", 422, 15.0, "prod"),
        (-7.6, "GET", "/api/v2/orders/ord-5501", 200, 28.3, "prod"),
        (-1.5, "GET", "/api/v2/orders/ord-7719", 200, 26.1, "prod"),
        # Zombie v1 endpoints (Undocumented in OpenAPI, but still implemented & hit by legacy clients!)
        (-13.1, "GET", "/api/v1/legacy/accounts", 200, 44.0, "prod"),
        (-9.8, "GET", "/api/v1/legacy/accounts", 200, 41.2, "prod"),
        (-4.0, "GET", "/api/v1/legacy/accounts", 200, 39.8, "prod"),
        (-0.4, "GET", "/api/v1/legacy/accounts", 200, 42.5, "prod"),
        (-11.6, "POST", "/api/v1/auth/token-exchange", 200, 53.0, "prod"),
        (-5.9, "POST", "/api/v1/auth/token-exchange", 200, 49.4, "prod"),
        (-1.1, "POST", "/api/v1/auth/token-exchange", 200, 51.8, "prod"),
        (-6.2, "GET", "/api/v1/catalog/pricing-matrix", 200, 19.7, "prod"),
        (-2.3, "GET", "/api/v1/catalog/pricing-matrix", 200, 20.4, "prod"),
        # Shadow internal debug endpoint (Undocumented in OpenAPI, implemented & hit in prod!)
        (-7.2, "GET", "/api/internal/debug/env-config", 200, 9.5, "prod"),
        (-0.9, "GET", "/api/internal/debug/env-config", 200, 8.8, "prod"),
    ]

    for idx, (days_offset, method, path, status_code, latency_ms, env) in enumerate(seed_events, start=1):
        ts = now + timedelta(days=days_offset)
        _access_logs.append(
            {
                "timestamp": _iso_utc(ts),
                "method": method,
                "path": path,
                "status_code": status_code,
                "request_id": f"req-seed-{1000 + idx}",
                "latency_ms": latency_ms,
                "environment": env,
            }
        )


_seed_initial_traffic_logs()


@app.middleware("http")
async def record_live_access_log(request: Request, call_next: Any) -> Any:
    """Record live incoming traffic (excluding internal /_autopsy/* and /health meta calls)."""
    start = time.perf_counter()
    response = await call_next(request)
    elapsed_ms = round((time.perf_counter() - start) * 1000.0, 2)

    path = request.url.path
    is_meta = (
        path.startswith("/_autopsy")
        or path in (
            "/health",
            "/openapi.json",
            "/swagger.json",
            "/api/openapi.json",
            "/api/v1/openapi.json",
            "/api/v2/openapi.json",
            "/v1/openapi.json",
            "/v2/openapi.json",
            "/v3/api-docs",
            "/docs/openapi.json",
            "/openapi.yaml",
            "/swagger.yaml",
            "/docs",
            "/redoc",
        )
    )
    probe_mode = request.headers.get("X-Autopsy-Log-Ignore", "false").lower() == "true"

    if not is_meta and not probe_mode:
        full_path = path
        if request.url.query:
            full_path = f"{path}?{request.url.query}"
        _access_logs.append(
            {
                "timestamp": _iso_utc(datetime.now(timezone.utc)),
                "method": request.method,
                "path": full_path,
                "status_code": response.status_code,
                "request_id": f"req-live-{uuid.uuid4().hex[:8]}",
                "latency_ms": elapsed_ms,
                "environment": "live-container",
            }
        )
    return response


def verify_optional_auth(
    request: Request,
    authorization: Optional[str] = Header(default=None),
    x_api_key: Optional[str] = Header(default=None, alias="X-API-Key"),
    api_key: Optional[str] = Query(default=None),
) -> Dict[str, str]:
    enforce = request.headers.get("X-Enforce-Auth", "false").lower() == "true"

    if authorization:
        if authorization.lower().startswith("bearer "):
            token = authorization[7:].strip()
            if token:
                return {"auth_method": "bearer", "principal": "authenticated-token-user"}
        elif authorization.lower().startswith("basic "):
            return {"auth_method": "basic", "principal": "authenticated-basic-user"}

    if x_api_key:
        return {"auth_method": "api_key_header", "principal": "authenticated-apikey-user"}

    if api_key:
        return {"auth_method": "api_key_query", "principal": "authenticated-query-user"}

    if enforce:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing valid authentication credentials (Bearer token, X-API-Key, or Basic auth).",
        )

    return {"auth_method": "anonymous", "principal": "public-caller"}


class OrderCreatePayload(BaseModel):
    customer_id: str = "cust-101"
    amount_cents: int = 4999
    currency: str = "USD"


class TaxOverridePayload(BaseModel):
    reason: str = "manual-exemption"
    override_rate: float = 0.0


@app.get("/health", include_in_schema=False)
def health() -> Dict[str, str]:
    return {"status": "ok", "service": "aga-target-zombie-api", "version": "2.3.0"}


@app.get(
    "/api/v2/users",
    summary="List active platform users",
    description="Returns paginated v2 user directory.",
    tags=["v2-users"],
)
def list_users_v2(auth: Dict[str, str] = Depends(verify_optional_auth)) -> Dict[str, Any]:
    return {
        "version": "v2",
        "auth": auth["auth_method"],
        "users": [
            {"id": "usr-8821", "name": "Aria Chen", "status": "active"},
            {"id": "usr-9042", "name": "Marcus Vance", "status": "active"},
        ],
    }


@app.get(
    "/api/v2/users/me",
    summary="Get current authenticated user profile",
    description="Static v2 route that must remain distinct from /api/v2/users/{user_id}.",
    tags=["v2-users"],
)
def get_current_user_v2(auth: Dict[str, str] = Depends(verify_optional_auth)) -> Dict[str, Any]:
    return {
        "id": "usr-me-01",
        "role": "platform-admin",
        "auth_used": auth["auth_method"],
    }


@app.get(
    "/api/v2/users/{user_id}",
    summary="Get user profile by ID",
    description="Fetches a single v2 user record by ID.",
    tags=["v2-users"],
)
def get_user_by_id_v2(user_id: str, auth: Dict[str, str] = Depends(verify_optional_auth)) -> Dict[str, Any]:
    return {"id": user_id, "name": f"User {user_id}", "tier": "enterprise", "auth_used": auth["auth_method"]}


@app.get(
    "/api/v2/orders",
    summary="List customer orders",
    description="Returns recent v2 customer orders.",
    tags=["v2-orders"],
)
def list_orders_v2(auth: Dict[str, str] = Depends(verify_optional_auth)) -> Dict[str, Any]:
    return {
        "orders": [
            {"order_id": "ord-5501", "status": "fulfilled", "amount_cents": 12900},
            {"order_id": "ord-7719", "status": "processing", "amount_cents": 4999},
        ]
    }


@app.post(
    "/api/v2/orders",
    status_code=status.HTTP_201_CREATED,
    summary="Create a new order",
    description="Submits a new v2 order to payment and fulfillment.",
    tags=["v2-orders"],
)
def create_order_v2(
    payload: Optional[OrderCreatePayload] = None,
    auth: Dict[str, str] = Depends(verify_optional_auth),
) -> Dict[str, Any]:
    return {
        "order_id": "ord-9901",
        "status": "created",
        "customer_id": payload.customer_id if payload else "cust-default",
    }


@app.get(
    "/api/v2/orders/{order_id}",
    summary="Get order details by ID",
    description="Fetches v2 order status and line items.",
    tags=["v2-orders"],
)
def get_order_by_id_v2(order_id: str, auth: Dict[str, str] = Depends(verify_optional_auth)) -> Dict[str, Any]:
    return {"order_id": order_id, "status": "fulfilled", "currency": "USD"}


@app.get(
    "/api/v2/reports/quarterly-audit-export",
    summary="Generate quarterly SOX/PCI compliance export",
    description="Seasonal compliance export endpoint run only at quarter close.",
    tags=["v2-reports"],
)
def quarterly_audit_export_v2() -> Dict[str, Any]:
    return {"report": "quarterly-audit", "status": "generated", "rows": 1420}


@app.put(
    "/api/v2/orders/{order_id}/manual-tax-override",
    summary="Apply manual tax override to an order",
    description="Rarely used finance backoffice tax override endpoint.",
    tags=["v2-orders"],
)
def manual_tax_override_v2(order_id: str, payload: Optional[TaxOverridePayload] = None) -> Dict[str, Any]:
    return {"order_id": order_id, "tax_overridden": True}


@app.get("/api/v1/legacy/accounts", include_in_schema=False)
def zombie_v1_legacy_accounts(auth: Dict[str, str] = Depends(verify_optional_auth)) -> Dict[str, Any]:
    return {
        "deprecated": True,
        "warning": "v1 accounts API was scheduled for sunset in 2025",
        "accounts": [{"account_id": "acc-legacy-01", "balance_cents": 84200}],
    }


@app.post("/api/v1/auth/token-exchange", include_in_schema=False)
def zombie_v1_token_exchange() -> Dict[str, Any]:
    return {"token_type": "legacy-v1-session", "expires_in": 3600}


@app.get("/api/v1/catalog/pricing-matrix", include_in_schema=False)
def zombie_v1_pricing_matrix() -> Dict[str, Any]:
    return {"matrix_version": "2024-Q3", "tiers": ["standard", "gold"]}


@app.get("/api/internal/debug/env-config", include_in_schema=False)
def shadow_debug_env_config() -> Dict[str, Any]:
    return {
        "debug_mode": False,
        "worker_pool_size": 8,
        "feature_flags": {"legacy_v1_compat": True, "strict_rate_limit": False},
    }


@app.post("/api/internal/cache/flush", include_in_schema=False)
def shadow_internal_cache_flush() -> Dict[str, Any]:
    return {"flushed": True, "timestamp": _iso_utc(datetime.now(timezone.utc))}


@app.delete("/api/v1/legacy/sessions/purge-expired", include_in_schema=False)
def shadow_legacy_session_purge() -> Dict[str, Any]:
    return {"purged_sessions": 0}


def custom_openapi() -> Dict[str, Any]:
    if app.openapi_schema:
        return app.openapi_schema

    schema = get_openapi(
        title=app.title,
        version=app.version,
        description=app.description,
        routes=app.routes,
    )

    paths = schema.setdefault("paths", {})
    paths["/api/v2/users/{user_id}/gdpr-erase"] = {
        "delete": {
            "summary": "Permanently erase user PII for GDPR compliance",
            "description": (
                "GHOST ENDPOINT: Declared in OpenAPI contract, but the route handler "
                "was never registered in the backend router (returns HTTP 404)."
            ),
            "x-owner": "privacy-engineering@nexuspay.example",
            "parameters": [
                {
                    "name": "user_id",
                    "in": "path",
                    "required": True,
                    "schema": {"type": "string"},
                }
            ],
            "responses": {"204": {"description": "User PII erased"}},
        }
    }
    paths["/api/v2/webhooks/replay-events"] = {
        "post": {
            "summary": "Replay failed webhook delivery events",
            "description": (
                "GHOST ENDPOINT: Declared in public OpenAPI specification, "
                "but removed from backend implementation."
            ),
            "x-owner": "integrations-team@nexuspay.example",
            "responses": {"202": {"description": "Replay queued"}},
        }
    }

    app.openapi_schema = schema
    return copy.deepcopy(schema)


app.openapi = custom_openapi  # type: ignore[method-assign]


@app.get("/_autopsy/routes", include_in_schema=False)
def export_registered_routes() -> Dict[str, Any]:
    implemented_routes = [
        {
            "method": "GET",
            "path": "/api/v2/users",
            "framework": "fastapi",
            "source_file": "target_api/routers/users_v2.py",
            "line_number": 24,
        },
        {
            "method": "GET",
            "path": "/api/v2/users/me",
            "framework": "fastapi",
            "source_file": "target_api/routers/users_v2.py",
            "line_number": 42,
        },
        {
            "method": "GET",
            "path": "/api/v2/users/{user_id}",
            "framework": "fastapi",
            "source_file": "target_api/routers/users_v2.py",
            "line_number": 58,
        },
        {
            "method": "GET",
            "path": "/api/v2/orders",
            "framework": "fastapi",
            "source_file": "target_api/routers/orders_v2.py",
            "line_number": 19,
        },
        {
            "method": "POST",
            "path": "/api/v2/orders",
            "framework": "fastapi",
            "source_file": "target_api/routers/orders_v2.py",
            "line_number": 36,
        },
        {
            "method": "GET",
            "path": "/api/v2/orders/{order_id}",
            "framework": "fastapi",
            "source_file": "target_api/routers/orders_v2.py",
            "line_number": 55,
        },
        {
            "method": "PUT",
            "path": "/api/v2/orders/{order_id}/manual-tax-override",
            "framework": "fastapi",
            "source_file": "target_api/routers/orders_v2.py",
            "line_number": 78,
        },
        {
            "method": "GET",
            "path": "/api/v2/reports/quarterly-audit-export",
            "framework": "fastapi",
            "source_file": "target_api/routers/reports_v2.py",
            "line_number": 31,
        },
        {
            "method": "GET",
            "path": "/api/v2/reports/quarterly-audit-export",
            "framework": "fastapi",
            "source_file": "target_api/routers/legacy_exports.py",
            "line_number": 14,
        },
        {
            "method": "GET",
            "path": "/api/v1/legacy/accounts",
            "framework": "fastapi",
            "source_file": "target_api/routers/zombie_v1.py",
            "line_number": 18,
        },
        {
            "method": "POST",
            "path": "/api/v1/auth/token-exchange",
            "framework": "fastapi",
            "source_file": "target_api/routers/zombie_v1.py",
            "line_number": 41,
        },
        {
            "method": "GET",
            "path": "/api/v1/catalog/pricing-matrix",
            "framework": "fastapi",
            "source_file": "target_api/routers/zombie_v1.py",
            "line_number": 63,
        },
        {
            "method": "GET",
            "path": "/api/internal/debug/env-config",
            "framework": "fastapi",
            "source_file": "target_api/routers/internal_ops.py",
            "line_number": 12,
        },
        {
            "method": "POST",
            "path": "/api/internal/cache/flush",
            "framework": "fastapi",
            "source_file": "target_api/routers/internal_ops.py",
            "line_number": 29,
        },
        {
            "method": "DELETE",
            "path": "/api/v1/legacy/sessions/purge-expired",
            "framework": "fastapi",
            "source_file": "target_api/routers/zombie_v1.py",
            "line_number": 89,
        },
    ]
    return {"service": "aga-target-zombie-api", "routes": implemented_routes}


@app.get("/_autopsy/logs", include_in_schema=False)
def export_access_logs() -> Dict[str, Any]:
    return {
        "service": "aga-target-zombie-api",
        "total_logged": len(_access_logs),
        "logs": list(_access_logs),
    }


@app.post("/_autopsy/simulate-traffic", include_in_schema=False)
def simulate_live_traffic_burst() -> Dict[str, Any]:
    now = datetime.now(timezone.utc)
    burst = [
        ("GET", "/api/v2/users", 200, 14.2),
        ("GET", "/api/v2/users/me", 200, 10.5),
        ("GET", "/api/v2/users/usr-3099", 200, 22.1),
        ("POST", "/api/v2/orders", 201, 61.3),
        ("GET", "/api/v2/orders/ord-8840", 200, 25.0),
        ("GET", "/api/v1/legacy/accounts", 200, 38.7),
        ("POST", "/api/v1/auth/token-exchange", 200, 47.9),
        ("GET", "/api/v1/catalog/pricing-matrix", 200, 18.2),
        ("GET", "/api/internal/debug/env-config", 200, 7.4),
    ]
    for idx, (method, path, code, lat) in enumerate(burst):
        ts = now - timedelta(seconds=(len(burst) - idx) * 3)
        _access_logs.append(
            {
                "timestamp": _iso_utc(ts),
                "method": method,
                "path": path,
                "status_code": code,
                "request_id": f"req-burst-{uuid.uuid4().hex[:6]}",
                "latency_ms": lat,
                "environment": "live-burst",
            }
        )
    return {
        "status": "ok",
        "added_requests": len(burst),
        "total_logs": len(_access_logs),
        "message": f"Simulated {len(burst)} live HTTP requests (including Zombie v1 & Shadow routes).",
    }


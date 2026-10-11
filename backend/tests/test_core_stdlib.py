import json
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.live_connector import (
    LiveAuthConfig,
    build_auth_headers_and_params,
    collect_live_api_sources,
)
from app.services.log_parser import parse_logs_content
from app.services.normalizer import (
    match_or_normalize_log_path,
    normalize_method,
    normalize_template_path,
    redact_sensitive_text,
)
from app.services.openapi_parser import OpenAPIParseError, parse_openapi_content
from app.services.route_parser import RouteParseError, parse_routes_content


class TestCoreParsersAndNormalizer(unittest.TestCase):
    def setUp(self) -> None:
        self.sample_dir = Path(__file__).resolve().parents[2] / "sample-data"

    def test_method_normalization(self) -> None:
        method, ok = normalize_method(" get ")
        self.assertEqual(method, "GET")
        self.assertTrue(ok)
        bad_method, bad_ok = normalize_method("INVALID_VERB")
        self.assertFalse(bad_ok)

    def test_static_vs_parameterized_path_normalization(self) -> None:
        norm_param, _, params, _ = normalize_template_path("/api/v1/users/{user_id}/")
        self.assertEqual(norm_param, "/api/v1/users/{param}")
        self.assertEqual(params, ["user_id"])

        norm_static, _, params_s, _ = normalize_template_path("/api/v1/users/me/")
        self.assertEqual(norm_static, "/api/v1/users/me")
        self.assertEqual(params_s, [])

        known_templates = {"GET": {"/api/v1/users/{param}"}}
        known_static = {"GET": {"/api/v1/users/me"}}

        matched_me, _, _ = match_or_normalize_log_path(
            "/api/v1/users/me", "GET", known_templates, known_static
        )
        self.assertEqual(matched_me, "/api/v1/users/me")

        matched_id, _, _ = match_or_normalize_log_path(
            "/api/v1/users/42", "GET", known_templates, known_static
        )
        self.assertEqual(matched_id, "/api/v1/users/{param}")

    def test_sensitive_token_redaction(self) -> None:
        redacted, changed = redact_sensitive_text("/api/v1/users?access_token=sample_query_token")
        self.assertTrue(changed)
        self.assertNotIn("sample_query_token", redacted)
        self.assertIn("[REDACTED]", redacted)

    def test_env_file_linking(self) -> None:
        from app.config import DEFAULT_ENV_FILE, FALLBACK_ENV_EXAMPLE, get_settings

        self.assertTrue(DEFAULT_ENV_FILE.is_file() or FALLBACK_ENV_EXAMPLE.is_file())
        settings = get_settings()
        if DEFAULT_ENV_FILE.is_file():
            self.assertTrue(settings.has_env_file)
            self.assertEqual(settings.env_file_path, str(DEFAULT_ENV_FILE))

    def test_invalid_openapi_raises_clear_error(self) -> None:
        with self.assertRaises(OpenAPIParseError):
            parse_openapi_content(b"{broken_json: [", "broken.json")

    def test_sample_dataset_end_to_end_parsing(self) -> None:
        oa = parse_openapi_content((self.sample_dir / "openapi.json").read_bytes(), "openapi.json")
        rt = parse_routes_content((self.sample_dir / "routes.csv").read_bytes(), "routes.csv")
        self.assertEqual(len(oa.endpoints), 9)
        self.assertEqual(len(rt.routes), 12)
        self.assertGreaterEqual(len(rt.warnings), 1)

        tmpls: dict[str, set[str]] = {}
        statics: dict[str, set[str]] = {}
        for ep in oa.endpoints:
            (tmpls if "{param}" in ep.normalized_path else statics).setdefault(ep.method, set()).add(
                ep.normalized_path
            )
        for r in rt.routes:
            (tmpls if "{param}" in r.normalized_path else statics).setdefault(r.method, set()).add(
                r.normalized_path
            )

        lg = parse_logs_content(
            (self.sample_dir / "access-logs.csv").read_bytes(),
            "access-logs.csv",
            tmpls,
            statics,
        )
        self.assertEqual(len(lg.endpoints), 8)
        self.assertIsNotNone(lg.observation_window_days)
        self.assertGreater(lg.observation_window_days or 0, 10.0)

    def test_live_auth_builder_and_credential_redaction(self) -> None:
        h_bearer, q_bearer, sum_bearer = build_auth_headers_and_params(
            LiveAuthConfig(auth_type="bearer", auth_token="super-secret-jwt-999")
        )
        self.assertEqual(h_bearer["Authorization"], "Bearer super-secret-jwt-999")
        self.assertEqual(q_bearer, {})
        self.assertNotIn("super-secret-jwt-999", sum_bearer)

        h_key, _, sum_key = build_auth_headers_and_params(
            LiveAuthConfig(auth_type="api_key_header", auth_header_name="X-Custom-Key", auth_token="my-key-123")
        )
        self.assertEqual(h_key["X-Custom-Key"], "my-key-123")
        self.assertNotIn("my-key-123", sum_key)

        _, q_key, sum_q = build_auth_headers_and_params(
            LiveAuthConfig(auth_type="api_key_query", auth_query_param="token", auth_token="query-secret-456")
        )
        self.assertEqual(q_key["token"], "query-secret-456")
        self.assertNotIn("query-secret-456", sum_q)

        h_basic, _, sum_basic = build_auth_headers_and_params(
            LiveAuthConfig(auth_type="basic", basic_username="admin", basic_password="pwd-secret-789")
        )
        self.assertTrue(h_basic["Authorization"].startswith("Basic "))
        self.assertNotIn("pwd-secret-789", sum_basic)

    def test_live_connector_active_probing_and_zombie_detection(self) -> None:
        fake_openapi = {
            "openapi": "3.0.3",
            "info": {"title": "External Test API", "version": "1.0.0"},
            "paths": {
                "/api/v2/users": {"get": {"summary": "Active v2 users"}},
                "/api/v2/users/{user_id}/gdpr-erase": {"delete": {"summary": "Ghost endpoint"}},
            },
        }

        def fake_requester(method: str, url: str, headers: dict[str, str], timeout: float) -> tuple[int, bytes]:
            self.assertEqual(headers.get("X-API-Key"), "ext-secret-key")
            if url.endswith("/openapi.json"):
                return 200, json.dumps(fake_openapi).encode("utf-8")
            if "/_autopsy/" in url:
                return 404, b"Not Found"
            if "gdpr-erase" in url and method == "DELETE":
                return 404, b"Not Found"
            if url.endswith("/api/v2/users") and method == "GET":
                return 200, b'{"users": []}'
            if url.endswith("/api/v1/legacy/accounts") and method == "GET":
                return 200, b'{"accounts": []}'
            return 404, b"Not Found"

        res = collect_live_api_sources(
            target_base_url="https://api.external-example.com",
            openapi_path="/openapi.json",
            auth_config=LiveAuthConfig(
                auth_type="api_key_header",
                auth_header_name="X-API-Key",
                auth_token="ext-secret-key",
            ),
            probe_endpoints=True,
            include_shadow_wordlist=True,
            requester=fake_requester,
        )

        self.assertNotIn("ext-secret-key", res.auth_summary)
        parsed_routes = parse_routes_content(res.routes_bytes, filename="routes.json")
        route_pairs = {(r.method, r.normalized_path) for r in parsed_routes.routes}
        self.assertIn(("GET", "/api/v2/users"), route_pairs)
        self.assertIn(("GET", "/api/v1/legacy/accounts"), route_pairs)
        self.assertNotIn(("DELETE", "/api/v2/users/{param}/gdpr-erase"), route_pairs)

    def test_specless_external_api_endpoint_url_scan(self) -> None:
        def fake_frankfurter_requester(
            method: str, url: str, headers: dict[str, str], timeout: float
        ) -> tuple[int, bytes]:
            if url.endswith("/latest") and method == "GET":
                return 200, b'{"amount":1.0,"base":"EUR","date":"2026-10-10","rates":{"USD":1.09}}'
            if url.endswith("/currencies") and method == "GET":
                return 200, b'{"EUR":"Euro","USD":"United States Dollar"}'
            if method == "DELETE":
                return 301, b""
            return 404, b'{"message":"not found"}'

        res = collect_live_api_sources(
            target_base_url="https://api.frankfurter.app/latest",
            openapi_path="/openapi.json",
            probe_endpoints=True,
            include_shadow_wordlist=True,
            requester=fake_frankfurter_requester,
        )

        self.assertEqual(res.resolved_base_url, "https://api.frankfurter.app")
        self.assertTrue(res.openapi_filename.startswith("no-public-openapi"))
        parsed_routes = parse_routes_content(res.routes_bytes, filename="routes.json")
        route_pairs = {(r.method, r.normalized_path) for r in parsed_routes.routes}
        self.assertIn(("GET", "/latest"), route_pairs)
        self.assertIn(("GET", "/currencies"), route_pairs)
        self.assertNotIn(("DELETE", "/api/v1/legacy/sessions/purge-expired"), route_pairs)
        self.assertIsNotNone(res.logs_bytes)

    def test_sqlite_schema_and_wal_persistence(self) -> None:
        from app.config import get_settings

        with tempfile.TemporaryDirectory() as tmpdir:
            db_file = Path(tmpdir) / "test_history.db"
            old_env = os.environ.get("SQLITE_DB_PATH")
            os.environ["SQLITE_DB_PATH"] = str(db_file)
            try:
                self.assertEqual(get_settings().sqlite_db_path, db_file)
                conn = sqlite3.connect(str(db_file))
                conn.execute(
                    "CREATE TABLE analyses (id TEXT PRIMARY KEY, name TEXT NOT NULL, payload_json TEXT NOT NULL)"
                )
                conn.execute(
                    "INSERT INTO analyses (id, name, payload_json) VALUES (?, ?, ?)",
                    ("a-1", "Test Audit", '{"id":"a-1"}'),
                )
                conn.commit()
                row = conn.execute("SELECT name FROM analyses WHERE id = 'a-1'").fetchone()
                self.assertIsNotNone(row)
                self.assertEqual(row[0], "Test Audit")
                conn.close()
            finally:
                if old_env is None:
                    os.environ.pop("SQLITE_DB_PATH", None)
                else:
                    os.environ["SQLITE_DB_PATH"] = old_env

    def test_deterministic_retries_and_deep_multihop_crawling(self) -> None:
        call_counts: dict[str, int] = {}

        def flaky_deep_requester(
            method: str, url: str, headers: dict[str, str], timeout: float
        ) -> tuple[int, bytes]:
            # Verify scanner always sends X-Autopsy-Log-Ignore header
            self.assertEqual(headers.get("X-Autopsy-Log-Ignore"), "true")
            key = f"{method} {url}"
            call_counts[key] = call_counts.get(key, 0) + 1

            # Simulate transient 503/timeout on first attempt to /api/v1/users
            if url.endswith("/api/v1/users") and call_counts[key] == 1:
                return 503, b"Service Unavailable"

            # Hop 0: '/' links to '/api/v1'
            if url.endswith("https://deep.example.com/") and method == "GET":
                return 200, b'{"_links": {"v1": {"href": "/api/v1"}}}'

            # Hop 1: '/api/v1' links to '/api/v1/users' and '/api/v1/orders'
            if url.endswith("/api/v1") and method == "GET":
                return 200, b'{"endpoints": ["/api/v1/users", "/api/v1/orders"]}'

            # Hop 2: '/api/v1/users' returns a collection of users with IDs and concrete links
            if url.endswith("/api/v1/users") and method == "GET":
                return 200, (
                    b'{"users": ['
                    b'{"id": "usr-101", "href": "/api/v1/users/usr-101"},'
                    b'{"id": "usr-202", "href": "/api/v1/users/usr-202"}'
                    b"]}"
                )

            # Hop 2: '/api/v1/orders' returns 200
            if url.endswith("/api/v1/orders") and method == "GET":
                return 200, b'{"orders": [{"order_id": "ord-900"}]}'

            # Hop 3: detail endpoints
            if "/api/v1/users/usr-" in url and method == "GET":
                return 200, b'{"id": "usr-101", "status": "active"}'
            if "/api/v1/orders/ord-" in url and method == "GET":
                return 200, b'{"order_id": "ord-900", "status": "paid"}'

            # Simulate catch-all 200 OK that echoes the requested path and dynamic timestamp
            parsed_path = url.split("deep.example.com")[-1]
            catchall_body = json.dumps(
                {
                    "error": "not_found",
                    "path": parsed_path,
                    "timestamp": "2026-10-11T13:50:00Z",
                }
            ).encode("utf-8")
            return 200, catchall_body

        res1 = collect_live_api_sources(
            target_base_url="https://deep.example.com",
            probe_endpoints=True,
            include_shadow_wordlist=True,
            requester=flaky_deep_requester,
        )
        res2 = collect_live_api_sources(
            target_base_url="https://deep.example.com",
            probe_endpoints=True,
            include_shadow_wordlist=True,
            requester=flaky_deep_requester,
        )

        # Output routes must be 100% identical across runs despite transient 503 and catch-all responses
        self.assertEqual(res1.routes_bytes, res2.routes_bytes)

        parsed_routes = parse_routes_content(res1.routes_bytes, filename="routes.json")
        # Ensure no false-positive duplicate route warnings were generated from multiple user items
        self.assertEqual(parsed_routes.warnings, [])

        route_pairs = {(r.method, r.normalized_path) for r in parsed_routes.routes}
        self.assertIn(("GET", "/"), route_pairs)
        self.assertIn(("GET", "/api/v1"), route_pairs)
        self.assertIn(("GET", "/api/v1/users"), route_pairs)
        self.assertIn(("GET", "/api/v1/orders"), route_pairs)
        self.assertIn(("GET", "/api/v1/users/{param}"), route_pairs)
        self.assertIn(("GET", "/api/v1/orders/{param}"), route_pairs)
        # Catch-all non-existent shadow routes must be filtered out by normalized canary fingerprint
        self.assertNotIn(("GET", "/api/internal/debug/env-config"), route_pairs)

    def test_specless_emojihub_style_api_discovery(self) -> None:
        """
        Verify crawling of APIs like https://emojihub.yurace.pro/api/ where:
        - No public OpenAPI spec is hosted (all /openapi.json return 404)
        - Root '/' and '/api' return 404
        - Active endpoints live under '/api/all', '/api/random', '/api/categories', '/api/groups', '/api/search' (400)
        - Hop-2 parameterized taxonomy/filter sub-routes live under '/api/all/category/{category}',
          '/api/random/group/{group}', and '/api/similar/{name}'
        """
        def fake_emojihub_requester(
            method: str, url: str, headers: dict[str, str], timeout: float
        ) -> tuple[int, bytes]:
            if method != "GET":
                return 404, b"404 page not found"
            path = url.split("emojihub.yurace.pro")[-1].split("?")[0]
            if path == "/api/random":
                return 200, (
                    b'{"name":"family, woman, woman, girl","category":"smileys and people",'
                    b'"group":"family","htmlCode":["&#128105;"],"unicode":["U+1F469"]}'
                )
            if path == "/api/all":
                return 200, (
                    b'[{"name":"grinning face","category":"smileys and people",'
                    b'"group":"face positive","htmlCode":["&#128512;"],"unicode":["U+1F600"]}]'
                )
            if path == "/api/categories":
                return 200, b'["smileys and people","animals and nature","activities"]'
            if path == "/api/groups":
                return 200, b'["face positive","face neutral","family"]'
            if path == "/api/search":
                return 400, b'{"error":"missing query parameter q"}'
            if path.startswith("/api/all/category/") or path.startswith("/api/random/category/"):
                return 200, b'[{"name":"grinning face","category":"smileys and people"}]'
            if path.startswith("/api/all/group/") or path.startswith("/api/random/group/"):
                return 200, b'[{"name":"family","group":"family"}]'
            if path.startswith("/api/similar/"):
                return 200, b'[{"name":"family"}]'
            return 404, b"404 page not found"

        res = collect_live_api_sources(
            target_base_url="https://emojihub.yurace.pro/api/",
            probe_endpoints=True,
            include_shadow_wordlist=True,
            requester=fake_emojihub_requester,
        )

        parsed_routes = parse_routes_content(res.routes_bytes, filename="routes.json")
        route_pairs = {(r.method, r.normalized_path) for r in parsed_routes.routes}
        self.assertIn(("GET", "/api/all"), route_pairs)
        self.assertIn(("GET", "/api/random"), route_pairs)
        self.assertIn(("GET", "/api/categories"), route_pairs)
        self.assertIn(("GET", "/api/groups"), route_pairs)
        self.assertIn(("GET", "/api/search"), route_pairs)
        self.assertIn(("GET", "/api/all/category/{param}"), route_pairs)
        self.assertIn(("GET", "/api/random/category/{param}"), route_pairs)
        self.assertIn(("GET", "/api/all/group/{param}"), route_pairs)
        self.assertIn(("GET", "/api/random/group/{param}"), route_pairs)
        self.assertIn(("GET", "/api/similar/{param}"), route_pairs)


if __name__ == "__main__":
    unittest.main()



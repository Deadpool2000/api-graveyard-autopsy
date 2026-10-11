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


if __name__ == "__main__":
    unittest.main()

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

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
        redacted, changed = redact_sensitive_text("/api/v1/users?access_token=secret123")
        self.assertTrue(changed)
        self.assertNotIn("secret123", redacted)
        self.assertIn("[REDACTED]", redacted)

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


if __name__ == "__main__":
    unittest.main()


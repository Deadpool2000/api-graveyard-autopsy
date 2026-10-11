import json
import os
from unittest.mock import patch
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.schemas.models import (
    AIExplanationSchema,
    ChatResponseSchema,
    InvestigationPlanSchema,
    InvestigationPlanStep,
)
from app.services.log_parser import parse_logs_content
from app.services.normalizer import match_or_normalize_log_path, normalize_template_path, redact_sensitive_text
from app.services.openapi_parser import OpenAPIParseError, parse_openapi_content
from app.services.route_parser import parse_routes_content

client = TestClient(app)


def test_health_endpoint_does_not_expose_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "AIzaSySecretTestKeyDoNotLeak999")
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert "AIzaSySecretTestKeyDoNotLeak999" not in json.dumps(body)


def test_valid_openapi_json_and_yaml_parse() -> None:
    valid_yaml = b"""
openapi: 3.0.1
info:
  title: Test API
  version: 1.0.0
paths:
  /users/{user_id}:
    get:
      summary: Get user
  /users/me:
    get:
      summary: Get current user
"""
    res = parse_openapi_content(valid_yaml, filename="spec.yaml")
    assert res.format_detected == "yaml"
    assert len(res.endpoints) == 2
    paths = {(e.method, e.normalized_path) for e in res.endpoints}
    assert ("GET", "/users/{param}") in paths
    assert ("GET", "/users/me") in paths


def test_invalid_openapi_produces_clear_validation_error() -> None:
    with pytest.raises(OpenAPIParseError) as exc_info:
        parse_openapi_content(b"{not_valid_json_or_yaml: [", filename="broken.json")
    assert "Malformed OpenAPI file" in str(exc_info.value)

    response = client.post(
        "/api/v1/analyses",
        files={"openapi_file": ("broken.json", b"{bad json", "application/json")},
    )
    assert response.status_code == 400
    assert "Malformed OpenAPI file" in response.json()["detail"]


def test_static_path_users_me_not_merged_with_parameterized_route() -> None:
    norm_tmpl, _, params, _ = normalize_template_path("/api/v1/users/{user_id}/")
    assert norm_tmpl == "/api/v1/users/{param}"
    assert params == ["user_id"]

    norm_static, _, params_static, _ = normalize_template_path("/api/v1/users/me/")
    assert norm_static == "/api/v1/users/me"
    assert params_static == []

    known_templates = {"GET": {"/api/v1/users/{param}"}}
    known_static = {"GET": {"/api/v1/users/me"}}

    matched_me, _, _ = match_or_normalize_log_path(
        "/api/v1/users/me", "GET", known_templates, known_static
    )
    assert matched_me == "/api/v1/users/me"

    matched_id, _, _ = match_or_normalize_log_path(
        "/api/v1/users/42", "GET", known_templates, known_static
    )
    assert matched_id == "/api/v1/users/{param}"


def test_sensitive_query_tokens_redacted() -> None:
    redacted, changed = redact_sensitive_text("/api/v1/users?access_token=super_secret_123&page=1")
    assert changed is True
    assert "super_secret_123" not in redacted
    assert "[REDACTED]" in redacted


def test_demo_flow_and_all_p0_finding_categories(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "replace_me")
    res = client.post("/api/v1/analyses/demo")
    assert res.status_code == 201
    data = res.json()
    analysis_id = data["id"]
    assert data["status"] == "completed"
    assert data["summary"]["total_findings"] >= 6

    findings_res = client.get(f"/api/v1/analyses/{analysis_id}/findings")
    assert findings_res.status_code == 200
    findings = findings_res.json()["findings"]
    categories = {f["category"] for f in findings}

    assert "Documented but not implemented" in categories
    assert "Implemented but undocumented" in categories
    assert "Observed but undocumented" in categories
    assert "Implemented but not observed" in categories
    assert "Documented but not observed" in categories
    assert "Data-quality issue" in categories

    # Verify guardrail: no finding claims an endpoint is "dead" or "safe to delete"
    for f in findings:
        serialized = json.dumps(f).lower()
        assert "safe to delete" not in serialized
        assert "definitely dead" not in serialized


def test_exports_contain_findings_and_caveats() -> None:
    demo = client.post("/api/v1/analyses/demo").json()
    analysis_id = demo["id"]

    md_res = client.get(f"/api/v1/analyses/{analysis_id}/report?format=markdown")
    assert md_res.status_code == 200
    assert "API Graveyard Autopsy Report" in md_res.text
    assert "Important Interpretation Caveat" in md_res.text
    assert "FND-001" in md_res.text

    json_res = client.get(f"/api/v1/analyses/{analysis_id}/report?format=json")
    assert json_res.status_code == 200
    report_data = json_res.json()
    assert len(report_data["findings"]) > 0
    assert len(report_data["global_caveats"]) > 0


def test_gemini_fallback_and_configured_mock_preserve_deterministic_scores(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # 1. Test fallback when Gemini is disabled/unconfigured
    monkeypatch.setenv("GEMINI_API_KEY", "replace_me")
    demo = client.post("/api/v1/analyses/demo").json()
    analysis_id = demo["id"]

    findings = client.get(f"/api/v1/analyses/{analysis_id}/findings").json()["findings"]
    first_finding = findings[0]
    fid = first_finding["id"]
    orig_score = first_finding["review_priority_score"]
    orig_category = first_finding["category"]

    inv_fallback = client.post(f"/api/v1/analyses/{analysis_id}/findings/{fid}/investigate")
    assert inv_fallback.status_code == 200
    fb_payload = inv_fallback.json()
    assert fb_payload["explanation"]["is_fallback"] is True
    assert fb_payload["finding"]["review_priority_score"] == orig_score
    assert fb_payload["finding"]["category"] == orig_category

    # 2. Test with Gemini configured (mocked SDK call)
    monkeypatch.setenv("GEMINI_API_KEY", "AIzaSyTestConfiguredKeyForUnitTestsOnly")
    mock_ai = AIExplanationSchema(
        summary="Grounded explanation from Gemini based on supplied metadata.",
        evidence_interpretation=["Route is present in OpenAPI but missing from route inventory."],
        recommended_checks=["Check backend routers and API gateway mappings."],
        caveats=["Absence of logs does not prove the endpoint is unused."],
    )
    with patch("app.services.gemini_service._call_gemini_structured", return_value=(mock_ai, None)):
        second_fid = findings[1]["id"]
        second_score = findings[1]["review_priority_score"]
        second_cat = findings[1]["category"]
        inv_live = client.post(f"/api/v1/analyses/{analysis_id}/findings/{second_fid}/investigate")
        assert inv_live.status_code == 200
        live_data = inv_live.json()
        assert live_data["explanation"]["is_fallback"] is False
        assert live_data["explanation"]["provider"] == "gemini"
        # Ensure AI never changes deterministic score or category (Check #18)
        assert live_data["finding"]["review_priority_score"] == second_score
        assert live_data["finding"]["category"] == second_cat

    # 3. Test grounded chat with mocked Gemini
    mock_chat = ChatResponseSchema(
        answer="You should prioritize FND-001 and FND-002 first based on their review priority scores.",
        referenced_finding_ids=["FND-001", "FND-002"],
        supporting_evidence=["FND-001 has the highest deterministic review priority."],
        caveats=["Verify logs across all environments before retiring any endpoint."],
    )
    with patch("app.services.gemini_service._call_gemini_structured", return_value=(mock_chat, None)):
        chat_res = client.post(
            f"/api/v1/analyses/{analysis_id}/chat",
            json={"question": "Which findings should I investigate first?"},
        )
        assert chat_res.status_code == 200
        chat_body = chat_res.json()["response"]
        assert "FND-001" in chat_body["referenced_finding_ids"]

    # 4. Test investigation plan endpoint
    mock_plan = InvestigationPlanSchema(
        overview="Prioritized human verification plan.",
        steps=[
            InvestigationPlanStep(
                priority_order=1,
                title="Verify undocumented active endpoints",
                rationale="Active traffic on undocumented endpoints requires contract and auth review.",
                finding_ids=["FND-001"],
                verification_criteria=["Confirm handler auth middleware and owner."],
            )
        ],
        general_caveats=["Never delete endpoints automatically without owner sign-off."],
    )
    with patch("app.services.gemini_service._call_gemini_structured", return_value=(mock_plan, None)):
        plan_res = client.post(f"/api/v1/analyses/{analysis_id}/investigation-plan")
        assert plan_res.status_code == 200
        assert len(plan_res.json()["investigation_plan"]["steps"]) == 1


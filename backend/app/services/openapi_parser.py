import json
from dataclasses import dataclass, field
from typing import Any, Dict, List
import yaml

from app.services.normalizer import VALID_HTTP_METHODS, normalize_method, normalize_template_path


OPENAPI_HTTP_METHODS = {m.lower() for m in VALID_HTTP_METHODS}


@dataclass
class ParsedOpenAPIEndpoint:
    method: str
    normalized_path: str
    original_path: str
    param_names: List[str] = field(default_factory=list)
    summary: str = ""
    description: str = ""
    owner: str = ""
    operation_id: str = ""
    deprecated: bool = False
    has_metadata_fields: bool = False
    warnings: List[str] = field(default_factory=list)


@dataclass
class OpenAPIParseResult:
    endpoints: List[ParsedOpenAPIEndpoint]
    warnings: List[str]
    format_detected: str
    title: str = ""
    version: str = ""


class OpenAPIParseError(ValueError):
    """Raised when the uploaded OpenAPI document is malformed or unsupported."""


def parse_openapi_content(content: bytes, filename: str = "openapi.json") -> OpenAPIParseResult:
    """
    Parse an OpenAPI 3.x (or Swagger 2.0 compatible paths) specification in JSON or YAML format.
    """
    if not content or not content.strip():
        raise OpenAPIParseError("Uploaded OpenAPI file is empty.")

    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise OpenAPIParseError("OpenAPI file must be valid UTF-8 encoded JSON or YAML.") from exc

    format_detected = "json" if filename.lower().endswith(".json") else "yaml"
    data: Any = None

    try:
        data = json.loads(text)
        format_detected = "json"
    except json.JSONDecodeError:
        try:
            data = yaml.safe_load(text)
            format_detected = "yaml"
        except yaml.YAMLError as yaml_exc:
            raise OpenAPIParseError(
                f"Malformed OpenAPI file '{filename}': could not parse as JSON or YAML ({yaml_exc})."
            ) from yaml_exc

    if not isinstance(data, dict):
        raise OpenAPIParseError(
            f"Invalid OpenAPI structure in '{filename}': root element must be a JSON/YAML object."
        )

    openapi_version = str(data.get("openapi", data.get("swagger", ""))).strip()
    if not openapi_version:
        raise OpenAPIParseError(
            f"Missing 'openapi' version field in '{filename}'. Expected OpenAPI 3.x specification."
        )
    if not (openapi_version.startswith("3.") or openapi_version.startswith("2.")):
        raise OpenAPIParseError(
            f"Unsupported OpenAPI version '{openapi_version}' in '{filename}'. Expected OpenAPI 3.x."
        )

    paths_obj = data.get("paths")
    if not isinstance(paths_obj, dict):
        raise OpenAPIParseError(
            f"Invalid OpenAPI specification in '{filename}': missing or invalid 'paths' object."
        )

    info_obj = data.get("info") if isinstance(data.get("info"), dict) else {}
    title = str(info_obj.get("title", "")).strip()
    version = str(info_obj.get("version", "")).strip()

    endpoints: List[ParsedOpenAPIEndpoint] = []
    global_warnings: List[str] = []
    seen_structural: Dict[Tuple[str, str], List[str]] = {}

    # Check if any operation in the spec supplies owner/description metadata
    spec_provides_metadata = False
    for raw_path, path_item in paths_obj.items():
        if isinstance(path_item, dict):
            for k, v in path_item.items():
                if k.lower() in OPENAPI_HTTP_METHODS and isinstance(v, dict):
                    if v.get("description") or v.get("x-owner") or v.get("x-team"):
                        spec_provides_metadata = True
                        break

    for raw_path, path_item in paths_obj.items():
        if not isinstance(path_item, dict):
            global_warnings.append(f"OpenAPI path '{raw_path}' does not map to an object; skipped.")
            continue

        for key, operation in path_item.items():
            if key.startswith("x-") or key in ("parameters", "summary", "description", "servers", "$ref"):
                continue

            norm_method, is_valid_method = normalize_method(key)
            if not is_valid_method:
                global_warnings.append(
                    f"OpenAPI path '{raw_path}' has unsupported HTTP method '{key}'; skipped."
                )
                continue

            if not isinstance(operation, dict):
                operation = {}

            norm_path, sanitized_orig, param_names, path_warnings = normalize_template_path(str(raw_path))
            summary = str(operation.get("summary", "")).strip()
            description = str(operation.get("description", "")).strip()
            owner = str(
                operation.get("x-owner", operation.get("x-team", operation.get("x-service", "")))
            ).strip()
            operation_id = str(operation.get("operationId", "")).strip()
            deprecated = bool(operation.get("deprecated", False))

            ep_warnings = list(path_warnings)
            structural_key = (norm_method, norm_path)
            if structural_key in seen_structural:
                prev_paths = seen_structural[structural_key]
                msg = (
                    f"Conflicting/duplicate OpenAPI structural route for {norm_method} {norm_path}: "
                    f"'{sanitized_orig}' conflicts with {prev_paths}"
                )
                ep_warnings.append(msg)
                global_warnings.append(msg)
            seen_structural.setdefault(structural_key, []).append(sanitized_orig)

            endpoints.append(
                ParsedOpenAPIEndpoint(
                    method=norm_method,
                    normalized_path=norm_path,
                    original_path=sanitized_orig,
                    param_names=param_names,
                    summary=summary,
                    description=description,
                    owner=owner,
                    operation_id=operation_id,
                    deprecated=deprecated,
                    has_metadata_fields=spec_provides_metadata,
                    warnings=ep_warnings,
                )
            )

    return OpenAPIParseResult(
        endpoints=endpoints,
        warnings=global_warnings,
        format_detected=format_detected,
        title=title,
        version=version,
    )


import os
from pathlib import Path
from typing import List


PLACEHOLDER_KEYS = {
    "",
    "replace_me",
    "your_api_key_here",
    "your_gemini_api_key",
    "changeme",
    "none",
    "null",
}


def _read_dotenv_values() -> dict[str, str]:
    """Read key-value pairs from .env file dynamically if present on disk."""
    candidates = [
        os.environ.get("ENV_FILE_PATH", ""),
        "/app/.env",
        str(Path(__file__).resolve().parents[2] / ".env"),
    ]
    values: dict[str, str] = {}
    for candidate in candidates:
        if not candidate:
            continue
        path = Path(candidate)
        if path.is_file():
            try:
                for raw_line in path.read_text(encoding="utf-8").splitlines():
                    line = raw_line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, val = line.split("=", 1)
                    key = key.strip()
                    val = val.strip().strip("'").strip('"')
                    values[key] = val
                break
            except Exception:
                continue
    return values


class Settings:
    """Server-side application configuration. Never exposes secret keys."""

    def __init__(self) -> None:
        dotenv_vals = _read_dotenv_values()

        def get_val(name: str, default: str) -> str:
            env_val = os.environ.get(name, "").strip()
            if env_val and env_val.lower() not in PLACEHOLDER_KEYS:
                return env_val
            file_val = dotenv_vals.get(name, "").strip()
            if file_val:
                return file_val
            return env_val or default

        self.gemini_api_key: str = get_val("GEMINI_API_KEY", "")
        self.gemini_model: str = get_val("GEMINI_MODEL", "gemini-2.5-flash")
        self.gemini_enabled: bool = get_val("GEMINI_ENABLED", "true").lower() in ("1", "true", "yes", "on")
        try:
            self.gemini_timeout_seconds: int = max(3, min(60, int(get_val("GEMINI_TIMEOUT_SECONDS", "15"))))
        except ValueError:
            self.gemini_timeout_seconds = 15

        try:
            self.gemini_max_output_tokens: int = max(256, min(4096, int(get_val("GEMINI_MAX_OUTPUT_TOKENS", "1024"))))
        except ValueError:
            self.gemini_max_output_tokens = 1024

        self.redis_url: str = get_val("REDIS_URL", "redis://redis:6379/0")
        try:
            self.cache_ttl_seconds: int = max(60, int(get_val("CACHE_TTL_SECONDS", "3600")))
        except ValueError:
            self.cache_ttl_seconds = 3600

        try:
            self.max_upload_size_mb: int = max(1, min(25, int(get_val("MAX_UPLOAD_SIZE_MB", "5"))))
        except ValueError:
            self.max_upload_size_mb = 5

        raw_origins = get_val(
            "CORS_ORIGINS",
            "http://localhost,http://localhost:80,http://localhost:3000,http://localhost:8080",
        )
        self.cors_origins: List[str] = [o.strip() for o in raw_origins.split(",") if o.strip()]

        # Scoring weights (configurable heuristics per FR-6)
        self.score_weight_implemented_not_in_logs: int = 30
        self.score_weight_absent_from_openapi: int = 25
        self.score_weight_documented_not_in_routes: int = 30
        self.score_weight_no_traffic_long_window: int = 20
        self.score_weight_no_traffic_short_window: int = 10
        self.score_weight_conflicting_metadata: int = 15
        self.score_weight_missing_openapi_metadata: int = 10

    @property
    def is_gemini_configured(self) -> bool:
        if not self.gemini_enabled:
            return False
        key = (self.gemini_api_key or "").strip()
        if not key or key.lower() in PLACEHOLDER_KEYS:
            return False
        return True

    @property
    def sample_data_dir(self) -> Path:
        env_dir = os.environ.get("SAMPLE_DATA_DIR", "")
        if env_dir and Path(env_dir).is_dir():
            return Path(env_dir)
        repo_sample = Path(__file__).resolve().parents[2] / "sample-data"
        if repo_sample.is_dir():
            return repo_sample
        local_sample = Path(__file__).resolve().parents[1] / "sample-data"
        return local_sample


def get_settings() -> Settings:
    """Return fresh settings instance so updates to .env are picked up immediately."""
    return Settings()


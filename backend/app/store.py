import json
from typing import Dict, List, Optional
import redis

from app.config import get_settings
from app.schemas.models import AnalysisRecord


class AnalysisStore:
    """
    Hybrid Redis + in-memory store for analyses, job queue, and Gemini response caching.
    Allows separate `backend` and `worker` Docker containers to share state via Redis,
    while seamlessly falling back to in-memory storage during local unit tests without Redis.
    """

    def __init__(self) -> None:
        self._memory_analyses: Dict[str, str] = {}
        self._memory_cache: Dict[str, str] = {}
        self._redis_client: Optional[redis.Redis] = None

    def _get_redis(self) -> Optional[redis.Redis]:
        settings = get_settings()
        if self._redis_client is not None:
            try:
                self._redis_client.ping()
                return self._redis_client
            except Exception:
                self._redis_client = None

        try:
            client = redis.Redis.from_url(
                settings.redis_url,
                decode_responses=True,
                socket_connect_timeout=1.5,
                socket_timeout=2.0,
            )
            client.ping()
            self._redis_client = client
            return client
        except Exception:
            return None

    def is_redis_connected(self) -> bool:
        return self._get_redis() is not None

    def save_analysis(self, analysis: AnalysisRecord) -> None:
        payload = analysis.model_dump_json()
        self._memory_analyses[analysis.id] = payload
        r = self._get_redis()
        if r is not None:
            try:
                r.setex(f"aga:analysis:{analysis.id}", 86400, payload)
            except Exception:
                pass

    def get_analysis(self, analysis_id: str) -> Optional[AnalysisRecord]:
        r = self._get_redis()
        if r is not None:
            try:
                raw = r.get(f"aga:analysis:{analysis_id}")
                if raw:
                    self._memory_analyses[analysis_id] = raw
                    return AnalysisRecord.model_validate_json(raw)
            except Exception:
                pass

        raw_mem = self._memory_analyses.get(analysis_id)
        if raw_mem:
            return AnalysisRecord.model_validate_json(raw_mem)
        return None

    def save_raw_inputs(
        self,
        analysis_id: str,
        openapi_bytes: Optional[bytes],
        openapi_filename: str,
        routes_bytes: Optional[bytes],
        routes_filename: str,
        logs_bytes: Optional[bytes],
        logs_filename: str,
    ) -> None:
        data = {
            "openapi_b64": openapi_bytes.decode("utf-8", errors="replace") if openapi_bytes else None,
            "openapi_filename": openapi_filename,
            "routes_b64": routes_bytes.decode("utf-8", errors="replace") if routes_bytes else None,
            "routes_filename": routes_filename,
            "logs_b64": logs_bytes.decode("utf-8", errors="replace") if logs_bytes else None,
            "logs_filename": logs_filename,
        }
        serialized = json.dumps(data)
        self._memory_cache[f"aga:inputs:{analysis_id}"] = serialized
        r = self._get_redis()
        if r is not None:
            try:
                r.setex(f"aga:inputs:{analysis_id}", 3600, serialized)
            except Exception:
                pass

    def get_raw_inputs(self, analysis_id: str) -> Optional[Dict[str, Optional[str]]]:
        r = self._get_redis()
        if r is not None:
            try:
                raw = r.get(f"aga:inputs:{analysis_id}")
                if raw:
                    return json.loads(raw)
            except Exception:
                pass
        raw_mem = self._memory_cache.get(f"aga:inputs:{analysis_id}")
        if raw_mem:
            return json.loads(raw_mem)
        return None

    def delete_raw_inputs(self, analysis_id: str) -> None:
        self._memory_cache.pop(f"aga:inputs:{analysis_id}", None)
        r = self._get_redis()
        if r is not None:
            try:
                r.delete(f"aga:inputs:{analysis_id}")
            except Exception:
                pass

    def enqueue_job(self, analysis_id: str) -> bool:
        r = self._get_redis()
        if r is not None:
            try:
                r.rpush("aga:queue:analyses", analysis_id)
                return True
            except Exception:
                return False
        return False

    def pop_job(self, timeout_seconds: int = 2) -> Optional[str]:
        r = self._get_redis()
        if r is not None:
            try:
                item = r.blpop("aga:queue:analyses", timeout=timeout_seconds)
                if item and len(item) == 2:
                    return item[1]
            except Exception:
                return None
        return None

    def acquire_job_lock(self, analysis_id: str, owner: str = "worker") -> bool:
        r = self._get_redis()
        if r is not None:
            try:
                acquired = r.set(f"aga:lock:{analysis_id}", owner, nx=True, ex=120)
                return bool(acquired)
            except Exception:
                return True
        return True

    def get_cached_ai_response(self, cache_key: str) -> Optional[dict]:
        r = self._get_redis()
        if r is not None:
            try:
                raw = r.get(f"aga:ai_cache:{cache_key}")
                if raw:
                    return json.loads(raw)
            except Exception:
                pass
        raw_mem = self._memory_cache.get(f"aga:ai_cache:{cache_key}")
        if raw_mem:
            return json.loads(raw_mem)
        return None

    def set_cached_ai_response(self, cache_key: str, value: dict, ttl_seconds: Optional[int] = None) -> None:
        settings = get_settings()
        ttl = ttl_seconds or settings.cache_ttl_seconds
        serialized = json.dumps(value)
        self._memory_cache[f"aga:ai_cache:{cache_key}"] = serialized
        r = self._get_redis()
        if r is not None:
            try:
                r.setex(f"aga:ai_cache:{cache_key}", ttl, serialized)
            except Exception:
                pass

    def check_rate_limit(self, bucket: str, max_calls: int = 15, window_seconds: int = 60) -> bool:
        """Simple sliding/fixed window rate limiter in Redis for AI calls."""
        r = self._get_redis()
        if r is None:
            return True
        try:
            key = f"aga:ratelimit:{bucket}"
            current = r.incr(key)
            if current == 1:
                r.expire(key, window_seconds)
            return current <= max_calls
        except Exception:
            return True


store = AnalysisStore()


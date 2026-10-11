import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    import redis
except ImportError:  # pragma: no cover
    redis = None  # type: ignore[assignment]

from app.config import get_settings
from app.schemas.models import AnalysisRecord


class AnalysisStore:
    """
    3-tier store combining:
    1. SQLite persistent database (`data/autopsy_history.db`) for durable report history & AI cache.
    2. Redis (`aga-redis`) for fast shared state and background worker job queueing across containers.
    3. In-memory dictionary fallback for fast access and isolated unit tests.
    """

    def __init__(self) -> None:
        self._memory_analyses: Dict[str, str] = {}
        self._memory_cache: Dict[str, str] = {}
        self._redis_client: Optional[Any] = None
        self._sqlite_initialized_path: Optional[str] = None

    def _get_sqlite_conn(self) -> Optional[sqlite3.Connection]:
        """Return a configured SQLite connection with WAL mode enabled, ensuring schema exists."""
        try:
            db_path: Path = get_settings().sqlite_db_path
            db_path.parent.mkdir(parents=True, exist_ok=True)
            conn = sqlite3.connect(str(db_path), timeout=5.0)
            conn.row_factory = sqlite3.Row
            if self._sqlite_initialized_path != str(db_path):
                conn.execute("PRAGMA journal_mode=WAL;")
                conn.execute("PRAGMA synchronous=NORMAL;")
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS analyses (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        is_demo INTEGER NOT NULL DEFAULT 0,
                        status TEXT NOT NULL,
                        stage TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        completed_at TEXT,
                        total_findings INTEGER NOT NULL DEFAULT 0,
                        payload_json TEXT NOT NULL
                    )
                    """
                )
                conn.execute(
                    "CREATE INDEX IF NOT EXISTS idx_analyses_created_at ON analyses(created_at DESC);"
                )
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS ai_cache (
                        cache_key TEXT PRIMARY KEY,
                        payload_json TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                    """
                )
                conn.commit()
                self._sqlite_initialized_path = str(db_path)
            return conn
        except Exception:
            return None

    def is_sqlite_connected(self) -> bool:
        conn = self._get_sqlite_conn()
        if conn is None:
            return False
        try:
            conn.execute("SELECT 1")
            return True
        except Exception:
            return False
        finally:
            conn.close()

    def _get_redis(self) -> Optional[Any]:
        if redis is None:
            return None
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

        # 1. Save to Redis (fast shared cache across containers)
        r = self._get_redis()
        if r is not None:
            try:
                r.setex(f"aga:analysis:{analysis.id}", 86400, payload)
            except Exception:
                pass

        # 2. Persist durably to SQLite history database
        conn = self._get_sqlite_conn()
        if conn is not None:
            try:
                total_findings = (
                    analysis.summary.total_findings
                    if analysis.summary is not None
                    else len(analysis.findings)
                )
                conn.execute(
                    """
                    INSERT INTO analyses (
                        id, name, is_demo, status, stage, created_at, completed_at, total_findings, payload_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        name = excluded.name,
                        is_demo = excluded.is_demo,
                        status = excluded.status,
                        stage = excluded.stage,
                        completed_at = excluded.completed_at,
                        total_findings = excluded.total_findings,
                        payload_json = excluded.payload_json
                    """,
                    (
                        analysis.id,
                        analysis.name,
                        1 if analysis.is_demo else 0,
                        analysis.status,
                        analysis.stage,
                        analysis.created_at,
                        analysis.completed_at,
                        total_findings,
                        payload,
                    ),
                )
                conn.commit()
            except Exception:
                pass
            finally:
                conn.close()

    def get_analysis(self, analysis_id: str) -> Optional[AnalysisRecord]:
        # 1. Check Redis first for live in-progress updates from worker
        r = self._get_redis()
        if r is not None:
            try:
                raw = r.get(f"aga:analysis:{analysis_id}")
                if raw:
                    self._memory_analyses[analysis_id] = raw
                    return AnalysisRecord.model_validate_json(raw)
            except Exception:
                pass

        # 2. Check SQLite persistent database
        conn = self._get_sqlite_conn()
        if conn is not None:
            try:
                row = conn.execute(
                    "SELECT payload_json FROM analyses WHERE id = ?",
                    (analysis_id,),
                ).fetchone()
                if row and row["payload_json"]:
                    raw_sql = str(row["payload_json"])
                    self._memory_analyses[analysis_id] = raw_sql
                    return AnalysisRecord.model_validate_json(raw_sql)
            except Exception:
                pass
            finally:
                conn.close()

        # 3. Check in-memory dict fallback
        raw_mem = self._memory_analyses.get(analysis_id)
        if raw_mem:
            return AnalysisRecord.model_validate_json(raw_mem)
        return None

    def list_analyses(self, limit: int = 50) -> List[AnalysisRecord]:
        """Return historical analyses ordered newest first from SQLite + memory."""
        records_by_id: Dict[str, AnalysisRecord] = {}

        conn = self._get_sqlite_conn()
        if conn is not None:
            try:
                rows = conn.execute(
                    "SELECT payload_json FROM analyses ORDER BY created_at DESC LIMIT ?",
                    (max(1, min(200, limit)),),
                ).fetchall()
                for row in rows:
                    try:
                        rec = AnalysisRecord.model_validate_json(str(row["payload_json"]))
                        records_by_id[rec.id] = rec
                    except Exception:
                        continue
            except Exception:
                pass
            finally:
                conn.close()

        for aid, raw_mem in list(self._memory_analyses.items()):
            if aid not in records_by_id:
                try:
                    records_by_id[aid] = AnalysisRecord.model_validate_json(raw_mem)
                except Exception:
                    continue

        sorted_records = sorted(
            records_by_id.values(),
            key=lambda item: item.created_at or "",
            reverse=True,
        )
        return sorted_records[:limit]

    def delete_analysis(self, analysis_id: str) -> bool:
        """Delete an analysis record from SQLite, Redis, and memory."""
        existed = analysis_id in self._memory_analyses
        self._memory_analyses.pop(analysis_id, None)

        r = self._get_redis()
        if r is not None:
            try:
                deleted_r = r.delete(f"aga:analysis:{analysis_id}")
                if deleted_r:
                    existed = True
            except Exception:
                pass

        conn = self._get_sqlite_conn()
        if conn is not None:
            try:
                cur = conn.execute("DELETE FROM analyses WHERE id = ?", (analysis_id,))
                conn.commit()
                if cur.rowcount and cur.rowcount > 0:
                    existed = True
            except Exception:
                pass
            finally:
                conn.close()

        return existed

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

        conn = self._get_sqlite_conn()
        if conn is not None:
            try:
                row = conn.execute(
                    "SELECT payload_json FROM ai_cache WHERE cache_key = ?",
                    (cache_key,),
                ).fetchone()
                if row and row["payload_json"]:
                    raw_sql = str(row["payload_json"])
                    self._memory_cache[f"aga:ai_cache:{cache_key}"] = raw_sql
                    return json.loads(raw_sql)
            except Exception:
                pass
            finally:
                conn.close()
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

        conn = self._get_sqlite_conn()
        if conn is not None:
            try:
                now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
                conn.execute(
                    """
                    INSERT INTO ai_cache (cache_key, payload_json, updated_at)
                    VALUES (?, ?, ?)
                    ON CONFLICT(cache_key) DO UPDATE SET
                        payload_json = excluded.payload_json,
                        updated_at = excluded.updated_at
                    """,
                    (cache_key, serialized, now_iso),
                )
                conn.commit()
            except Exception:
                pass
            finally:
                conn.close()

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

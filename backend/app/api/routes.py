from typing import Dict
from fastapi import APIRouter

from app.api.analyses import router as analyses_router
from app.api.explanations import router as explanations_router
from app.config import get_settings
from app.store import store

router = APIRouter()


@router.get("/health", tags=["health"])
def health_check() -> Dict[str, object]:
    """Service health endpoint (PRD Section 8). Never exposes secret keys."""
    settings = get_settings()
    return {
        "status": "ok",
        "service": "api-graveyard-autopsy-backend",
        "redis_connected": store.is_redis_connected(),
        "sqlite_connected": store.is_sqlite_connected(),
        "ai_configured": settings.is_gemini_configured,
        "ai_enabled": settings.gemini_enabled,
        "ai_model": settings.gemini_model if settings.is_gemini_configured else None,
    }


@router.get("/api/v1/status", tags=["health"])
def api_status() -> Dict[str, object]:
    """Return non-sensitive configuration and AI status for the dashboard."""
    settings = get_settings()
    return {
        "status": "ok",
        "max_upload_size_mb": settings.max_upload_size_mb,
        "redis_connected": store.is_redis_connected(),
        "sqlite_connected": store.is_sqlite_connected(),
        "ai": {
            "enabled": settings.gemini_enabled,
            "configured": settings.is_gemini_configured,
            "provider": "gemini" if settings.is_gemini_configured else "deterministic-fallback",
            "model": settings.gemini_model if settings.is_gemini_configured else None,
        },
    }


router.include_router(analyses_router)
router.include_router(explanations_router)


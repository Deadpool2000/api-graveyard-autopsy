import logging
import signal
import sys
import time

from app.services.pipeline import execute_analysis_pipeline
from app.store import store

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [aga-worker] %(message)s",
)
logger = logging.getLogger("aga-worker")

_running = True


def _handle_sigterm(signum: int, frame: object) -> None:
    global _running
    logger.info("Received termination signal (%s); shutting down worker loop...", signum)
    _running = False


def run_worker_loop() -> None:
    signal.signal(signal.SIGTERM, _handle_sigterm)
    signal.signal(signal.SIGINT, _handle_sigterm)

    logger.info("API Graveyard Autopsy background worker started. Listening for analysis jobs in Redis...")
    while _running:
        try:
            analysis_id = store.pop_job(timeout_seconds=2)
            if not analysis_id:
                continue

            if not store.acquire_job_lock(analysis_id, owner="worker-container"):
                logger.info("Job %s already locked by another processor; skipping.", analysis_id)
                continue

            logger.info("Processing analysis job %s...", analysis_id)
            result = execute_analysis_pipeline(analysis_id)
            if result:
                logger.info(
                    "Completed job %s with status=%s, findings=%d",
                    analysis_id,
                    result.status,
                    len(result.findings),
                )
        except Exception as exc:
            logger.warning("Worker loop error: %s", exc)
            time.sleep(2)


if __name__ == "__main__":
    run_worker_loop()
    sys.exit(0)


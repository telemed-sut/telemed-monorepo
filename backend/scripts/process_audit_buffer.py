#!/usr/bin/env python3
import json
import logging
import os
import sys
import time
from datetime import datetime, timezone

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.session import SessionLocal
from app.models.audit_log import AuditLog
from app.core.redis_client import redis_client
from app.services.audit import AUDIT_LOG_BUFFER_KEY

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("audit_worker")

BATCH_SIZE = int(os.getenv("AUDIT_WORKER_BATCH_SIZE", "50"))
IDLE_SLEEP = float(os.getenv("AUDIT_WORKER_IDLE_SLEEP", "2.0"))

def process_batch():
    """Pop a batch of audit logs from Redis and write to DB."""
    payloads = []
    
    # Try to get up to BATCH_SIZE items
    for _ in range(BATCH_SIZE):
        item = redis_client.rpop(AUDIT_LOG_BUFFER_KEY)
        if not item:
            break
        try:
            payloads.append(json.loads(item))
        except Exception:
            logger.exception("Failed to parse audit log payload from Redis")

    if not payloads:
        return 0

    db = SessionLocal()
    try:
        for p in payloads:
            # Reconstruct AuditLog object
            created_at = p.get("created_at")
            if created_at:
                try:
                    p["created_at"] = datetime.fromisoformat(created_at)
                except ValueError:
                    p["created_at"] = datetime.now(timezone.utc)
            
            entry = AuditLog(**p)
            db.add(entry)
        
        db.commit()
        logger.info("Processed %d audit logs", len(payloads))
        return len(payloads)
    except Exception:
        logger.exception("Failed to write audit log batch to database")
        db.rollback()
        # In a production system, you might want to push these back to a DLQ (Dead Letter Queue)
        return 0
    finally:
        db.close()

def main():
    logger.info("Audit log worker started. Batch size: %d", BATCH_SIZE)
    while True:
        try:
            processed = process_batch()
            if processed == 0:
                time.sleep(IDLE_SLEEP)
        except KeyboardInterrupt:
            logger.info("Audit log worker stopping...")
            break
        except Exception:
            logger.exception("Unexpected error in audit worker loop")
            time.sleep(IDLE_SLEEP)

if __name__ == "__main__":
    main()

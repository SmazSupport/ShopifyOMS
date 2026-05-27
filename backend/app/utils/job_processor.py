"""
Background job processor for RecalculationJob queue.

Polls for pending jobs every POLL_INTERVAL seconds, processes each one
by running all active rules against the relevant orders, and writes
DerivedFieldValue rows (upsert via unique constraint).
"""

import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.models import (
    FieldTransformRule, DerivedFieldValue, RecalculationJob,
    Order, LineItem,
)
from app.utils.rule_engine import RuleExecutionGraph, apply_transform

log = logging.getLogger(__name__)

POLL_INTERVAL = 10   # seconds between queue checks
BATCH_SIZE    = 50   # orders processed per DB flush


# ─────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _get_field_value(order, field: str):
    """Resolve a field path from an Order ORM object."""
    if "." in field:
        parts = field.split(".")
        val = order
        for part in parts:
            if val is None:
                return None
            if isinstance(val, dict):
                val = val.get(part)
            else:
                val = getattr(val, part, None)
        return val
    return getattr(order, field, None)


# ─────────────────────────────────────────────────────────────────
# Core processor
# ─────────────────────────────────────────────────────────────────

async def _process_job(db: AsyncSession, job: RecalculationJob) -> None:
    """Process a single RecalculationJob."""

    # Mark job as running
    job.status = "running"
    job.started_at = _now_iso()
    await db.commit()

    try:
        # Load the rule
        rule_result = await db.execute(
            select(FieldTransformRule).where(
                FieldTransformRule.id == job.rule_id,
                FieldTransformRule.is_active == True,  # noqa: E712
            )
        )
        rule = rule_result.scalar_one_or_none()

        if not rule:
            job.status = "failed"
            job.error_message = "Rule not found or inactive"
            job.completed_at = _now_iso()
            await db.commit()
            return

        # Build order query based on scope
        stmt = select(Order).where(Order.shop_id == job.shop_id)

        if job.scope == "open_orders":
            stmt = stmt.where(Order.fulfillment_status.in_(["unfulfilled", "partial", None]))
        elif job.scope == "specific" and job.specific_order_ids:
            stmt = stmt.where(Order.id.in_(job.specific_order_ids))
        # "all_orders" → no additional filter

        orders_result = await db.execute(stmt)
        orders = orders_result.scalars().all()

        total = len(orders)
        job.total_orders = total
        await db.commit()

        processed = 0
        failed = 0

        # Sync session for RuleExecutionGraph (uses sync .query())
        sync_session = await db.run_sync(lambda s: s)

        for i, order in enumerate(orders):
            try:
                # Resolve source value directly (simple path, no cross-entity for now)
                source_value = _get_field_value(order, rule.source_field)

                # Apply transform
                if rule.transform_type in ("aggregate", "lookup"):
                    # These require the full sync graph — skip for now, mark stale
                    result_value = None
                else:
                    result_value = apply_transform(
                        source_value,
                        rule.transform_type,
                        rule.transform_config or {},
                    )

                # Upsert DerivedFieldValue
                now = _now_iso()
                upsert_stmt = (
                    pg_insert(DerivedFieldValue)
                    .values(
                        shop_id=job.shop_id,
                        rule_id=rule.id,
                        entity_type=rule.output_entity,
                        entity_id=order.id,
                        value=result_value,
                        computed_at=now,
                        is_stale=False,
                    )
                    .on_conflict_do_update(
                        constraint="uix_derived_value",
                        set_={
                            "value": result_value,
                            "computed_at": now,
                            "is_stale": False,
                        },
                    )
                )
                await db.execute(upsert_stmt)
                processed += 1

            except Exception as e:
                log.warning("Job %s: failed for order %s: %s", job.id, order.id, e)
                failed += 1

            # Flush in batches to avoid huge transactions
            if (i + 1) % BATCH_SIZE == 0:
                await db.commit()
                job.processed_orders = processed
                job.failed_count = failed
                await db.commit()

        # Final commit
        await db.commit()

        job.status = "completed" if failed == 0 else "completed_with_errors"
        job.processed_orders = processed
        job.failed_count = failed
        job.completed_at = _now_iso()
        await db.commit()

        log.info(
            "Job %s done: %d/%d processed, %d failed (rule=%s)",
            job.id, processed, total, failed, rule.output_field_key,
        )

    except Exception as e:
        log.exception("Job %s crashed: %s", job.id, e)
        job.status = "failed"
        job.error_message = str(e)
        job.completed_at = _now_iso()
        try:
            await db.commit()
        except Exception:
            await db.rollback()


# ─────────────────────────────────────────────────────────────────
# Poll loop
# ─────────────────────────────────────────────────────────────────

async def run_job_processor() -> None:
    """
    Long-running coroutine. Call from FastAPI lifespan as a background task.
    Polls the recalculation_jobs table for pending work.
    """
    log.info("Job processor started (poll interval=%ds)", POLL_INTERVAL)

    while True:
        try:
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    select(RecalculationJob)
                    .where(RecalculationJob.status == "pending")
                    .order_by(RecalculationJob.created_at)
                    .limit(1)
                    .with_for_update(skip_locked=True)
                )
                job = result.scalar_one_or_none()

                if job:
                    log.info("Picking up job %s (rule=%s scope=%s)", job.id, job.rule_id, job.scope)
                    await _process_job(db, job)
                # If no job, just sleep and check again

        except Exception as e:
            log.exception("Job processor poll error: %s", e)

        await asyncio.sleep(POLL_INTERVAL)

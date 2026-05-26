"""
Data Studio Router
Unified API for field transforms, relationship resolution, and recalculation jobs.
"""

from typing import Optional, List, Any
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_
from datetime import datetime

from app.database import get_db as get_async_session
from app.utils.auth import get_current_user
from app.models import (
    User, FieldTransformRule, DerivedFieldValue, RecalculationJob, EntityRelationship,
    Order, LineItem, Product, Variant, Customer,
    CustomFieldDefinition, CustomFieldValue, MetafieldMapping,
)
from app.utils.rule_engine import RuleExecutionGraph, RecalculationManager, apply_transform

router = APIRouter(prefix="/data-studio", tags=["data-studio"])


# ═════════════════════════════════════════════════════════════════
# Schemas
# ═════════════════════════════════════════════════════════════════

class TransformConfig(BaseModel):
    """Generic transform configuration."""
    pass


class SourcePathStep(BaseModel):
    """Single step in a relationship path."""
    entity: str
    via: str
    inferred: bool = True


class FieldTransformRuleCreate(BaseModel):
    """Create a new field transform rule."""
    name: str
    source_entity: str
    source_field: str
    source_path: Optional[List[SourcePathStep]] = None
    transform_type: str
    transform_config: dict = Field(default_factory=dict)
    output_entity: str
    output_field_key: str
    output_field_label: str
    output_field_type: str = "string"
    depends_on: Optional[List[str]] = Field(default_factory=list)
    recalculation_mode: str = "new_only"
    auto_recalc_on_source_change: bool = True
    notes: Optional[str] = None


class FieldTransformRuleUpdate(BaseModel):
    """Update an existing field transform rule."""
    name: Optional[str] = None
    source_field: Optional[str] = None
    source_path: Optional[List[SourcePathStep]] = None
    transform_type: Optional[str] = None
    transform_config: Optional[dict] = None
    output_field_label: Optional[str] = None
    output_field_type: Optional[str] = None
    depends_on: Optional[List[str]] = None
    recalculation_mode: Optional[str] = None
    auto_recalc_on_source_change: Optional[bool] = None
    is_active: Optional[bool] = None
    notes: Optional[str] = None


class FieldTransformRuleResponse(BaseModel):
    """Field transform rule response."""
    id: str
    name: str
    source_entity: str
    source_field: str
    source_path: Optional[List[dict]]
    transform_type: str
    transform_config: dict
    output_entity: str
    output_field_key: str
    output_field_label: str
    output_field_type: str
    run_order: int
    depends_on: Optional[List[str]]
    recalculation_mode: str
    auto_recalc_on_source_change: bool
    is_active: bool
    notes: Optional[str]
    created_at: Optional[str]
    updated_at: Optional[str]

    class Config:
        from_attributes = True


class RuleTestRequest(BaseModel):
    """Test a transform without saving."""
    source_entity: str
    source_field: str
    source_path: Optional[List[SourcePathStep]] = None
    transform_type: str
    transform_config: dict
    sample_ids: Optional[List[str]] = None
    sample_values: Optional[List[str]] = None


class RuleTestResult(BaseModel):
    """Single test result."""
    source: Any
    output: Any
    success: bool
    error: Optional[str] = None


class PathRequest(BaseModel):
    """Request to resolve or validate a path."""
    from_entity: str
    to_entity: str
    field: Optional[str] = None
    custom_path: Optional[List[SourcePathStep]] = None


class PathResponse(BaseModel):
    """Path resolution response."""
    path: List[SourcePathStep]
    alternatives: List[List[SourcePathStep]]
    available_fields: List[str]
    valid: bool
    errors: Optional[List[str]] = None


class SchemaResponse(BaseModel):
    """Entity schema response."""
    entities: dict


class RecalculationJobResponse(BaseModel):
    """Recalculation job response."""
    id: str
    trigger_type: str
    rule_id: str
    rule_name: str
    scope: str
    status: str
    total_orders: Optional[int]
    processed_orders: Optional[int]
    failed_count: Optional[int]
    started_at: Optional[str]
    completed_at: Optional[str]
    error_message: Optional[str]
    triggered_by: Optional[str]
    created_at: str

    class Config:
        from_attributes = True


class DerivedValueResponse(BaseModel):
    """Derived field value response."""
    rule_id: str
    rule_name: str
    output_field_key: str
    value: Any
    computed_at: str
    is_stale: bool


# ═════════════════════════════════════════════════════════════════
# Helper Functions
# ═════════════════════════════════════════════════════════════════

async def get_shop_id(db: AsyncSession, user: User) -> str:
    """Get shop_id for current user context."""
    # For now, get first shop - in multi-tenant this would use user's shop
    result = await db.execute(select(Shop).limit(1))
    shop = result.scalar_one_or_none()
    if not shop:
        raise HTTPException(status_code=400, detail="No shop configured")
    return shop.id


from app.models.shop import Shop


# ═════════════════════════════════════════════════════════════════
# Rule Endpoints
# ═════════════════════════════════════════════════════════════════

@router.get("/rules", response_model=List[FieldTransformRuleResponse])
async def list_rules(
    entity: Optional[str] = Query(None, description="Filter by output entity"),
    active_only: bool = Query(True, description="Only active rules"),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user)
):
    """List all field transform rules with optional filtering."""
    query = select(FieldTransformRule)

    if active_only:
        query = query.where(FieldTransformRule.is_active == True)

    if entity:
        query = query.where(FieldTransformRule.output_entity == entity)

    # Order by run_order for execution sequence
    query = query.order_by(FieldTransformRule.run_order)

    result = await db.execute(query)
    rules = result.scalars().all()

    return rules


@router.get("/rules/{rule_id}", response_model=FieldTransformRuleResponse)
async def get_rule(
    rule_id: str,
    preview: bool = Query(False, description="Include preview data"),
    sample_size: int = Query(5, ge=1, le=20),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user)
):
    """Get a single rule by ID with optional preview data."""
    result = await db.execute(
        select(FieldTransformRule).where(FieldTransformRule.id == rule_id)
    )
    rule = result.scalar_one_or_none()

    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")

    return rule


@router.post("/rules", response_model=FieldTransformRuleResponse)
async def create_rule(
    rule_data: FieldTransformRuleCreate,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user)
):
    """Create a new field transform rule."""
    shop_id = await get_shop_id(db, current_user)

    # Auto-infer source_path if not provided
    source_path = rule_data.source_path
    if not source_path:
        source_path = await _infer_path(
            db, rule_data.output_entity, rule_data.source_entity
        )

    # Calculate run_order based on dependencies
    run_order = await _calculate_run_order(db, rule_data.depends_on or [])

    rule = FieldTransformRule(
        shop_id=shop_id,
        name=rule_data.name,
        source_entity=rule_data.source_entity,
        source_field=rule_data.source_field,
        source_path=[step.model_dump() for step in source_path] if source_path else [],
        transform_type=rule_data.transform_type,
        transform_config=rule_data.transform_config,
        output_entity=rule_data.output_entity,
        output_field_key=rule_data.output_field_key,
        output_field_label=rule_data.output_field_label,
        output_field_type=rule_data.output_field_type,
        run_order=run_order,
        depends_on=rule_data.depends_on or [],
        recalculation_mode=rule_data.recalculation_mode,
        auto_recalc_on_source_change=rule_data.auto_recalc_on_source_change,
        notes=rule_data.notes,
        created_by=current_user.email,
        is_active=True
    )

    db.add(rule)
    await db.commit()
    await db.refresh(rule)

    # Auto-register in field registry so it shows up in UI column choosers
    await _ensure_field_registered(db, shop_id, rule)

    # Queue recalculation if needed
    if rule_data.recalculation_mode != "new_only":
        manager = RecalculationManager(db)
        await db.run_sync(lambda s: manager.on_rule_created(rule))

    return rule


@router.put("/rules/{rule_id}", response_model=FieldTransformRuleResponse)
async def update_rule(
    rule_id: str,
    rule_data: FieldTransformRuleUpdate,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user)
):
    """Update an existing field transform rule."""
    result = await db.execute(
        select(FieldTransformRule).where(FieldTransformRule.id == rule_id)
    )
    rule = result.scalar_one_or_none()

    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")

    # Track if recalculation needed
    needs_recalc = False

    # Update fields
    for field, value in rule_data.model_dump(exclude_unset=True).items():
        if field == "source_path" and value is not None:
            value = [step.model_dump() if hasattr(step, 'model_dump') else step for step in value]

        # Check if transform-related field changed
        if field in ['source_field', 'transform_type', 'transform_config'] and value != getattr(rule, field):
            needs_recalc = True

        setattr(rule, field, value)

    # Recalculate run_order if dependencies changed
    if rule_data.depends_on is not None:
        rule.run_order = await _calculate_run_order(db, rule_data.depends_on)

    await db.commit()
    await db.refresh(rule)

    # Keep field registry in sync (label or type may have changed)
    shop_id = await get_shop_id(db, current_user)
    await _ensure_field_registered(db, shop_id, rule)

    # Queue recalculation if needed
    if needs_recalc:
        manager = RecalculationManager(db)
        await db.run_sync(lambda s: manager.on_rule_updated(rule, current_user.email))

    return rule


@router.delete("/rules/{rule_id}")
async def delete_rule(
    rule_id: str,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user)
):
    """Delete a field transform rule (cascades to derived values)."""
    result = await db.execute(
        select(FieldTransformRule).where(FieldTransformRule.id == rule_id)
    )
    rule = result.scalar_one_or_none()

    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")

    await db.delete(rule)
    await db.commit()

    return {"status": "deleted", "id": rule_id}


@router.post("/rules/test", response_model=List[RuleTestResult])
async def test_transform(
    test_data: RuleTestRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user)
):
    """Test a transform configuration without saving."""
    results = []

    # Use provided sample values or fetch from database
    test_values = test_data.sample_values or []

    if test_data.sample_ids and not test_values:
        # Fetch actual values from database
        test_values = await _fetch_sample_values(
            db, test_data.source_entity, test_data.source_field,
            test_data.sample_ids, test_data.source_path
        )

    # If no samples provided, use placeholder
    if not test_values:
        test_values = ["A5C", "B10D", "C2X"]  # Default samples

    for value in test_values:
        try:
            output = apply_transform(
                value,
                test_data.transform_type,
                test_data.transform_config
            )
            results.append(RuleTestResult(
                source=value,
                output=output,
                success=True
            ))
        except Exception as e:
            results.append(RuleTestResult(
                source=value,
                output=None,
                success=False,
                error=str(e)
            ))

    return results


@router.post("/rules/{rule_id}/recalculate")
async def trigger_recalculation(
    rule_id: str,
    scope: Optional[str] = None,
    specific_orders: Optional[List[str]] = None,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user)
):
    """Manually trigger recalculation for a rule."""
    result = await db.execute(
        select(FieldTransformRule).where(FieldTransformRule.id == rule_id)
    )
    rule = result.scalar_one_or_none()

    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")

    # Override scope if provided
    if scope:
        rule.recalculation_mode = scope

    manager = RecalculationManager(db)
    job_id = await db.run_sync(
        lambda s: manager.on_rule_updated(rule, current_user.email)
    )

    return {"job_id": job_id, "status": "queued"}


# ═════════════════════════════════════════════════════════════════
# Path Resolution Endpoints
# ═════════════════════════════════════════════════════════════════

@router.get("/path")
async def get_path(
    from_entity: str,
    to_entity: str,
    field: Optional[str] = None,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user)
):
    """Get auto-inferred path between entities."""
    path = await _infer_path(db, from_entity, to_entity)

    # Get available fields at destination
    available_fields = await _get_available_fields(db, to_entity)

    return PathResponse(
        path=[SourcePathStep(**step) for step in path] if path else [],
        alternatives=[],  # Could compute alternative paths
        available_fields=available_fields,
        valid=len(path) > 0 or from_entity == to_entity
    )


@router.post("/path/validate")
async def validate_path(
    request: PathRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user)
):
    """Validate a custom relationship path."""
    if not request.custom_path:
        raise HTTPException(status_code=400, detail="custom_path required")

    # Validate each step
    errors = []
    current = request.from_entity

    for step in request.custom_path:
        # Check if relationship exists
        result = await db.execute(
            select(EntityRelationship).where(
                and_(
                    EntityRelationship.from_entity == current,
                    EntityRelationship.to_entity == step.entity
                )
            )
        )
        rel = result.scalar_one_or_none()

        if not rel:
            errors.append(f"No relationship from {current} to {step.entity}")

        current = step.entity

    return PathResponse(
        path=request.custom_path,
        alternatives=[],
        available_fields=[],
        valid=len(errors) == 0,
        errors=errors if errors else None
    )


# ═════════════════════════════════════════════════════════════════
# Schema Endpoint
# ═════════════════════════════════════════════════════════════════

def _get_sqlalchemy_columns(model_class) -> list:
    """Get all column names from a SQLAlchemy model."""
    return [col.name for col in model_class.__table__.columns]


@router.get("/schema", response_model=SchemaResponse)
async def get_schema(
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user)
):
    """Get entity schema with ALL fields dynamically discovered from database."""
    try:
        # Map entity names to their SQLAlchemy model classes
        entity_models = {
            "order": Order,
            "line_item": LineItem,
            "variant": Variant,
            "product": Product,
            "customer": Customer,
        }

        # Base schema structure with relationships
        schema = {
            "order": {
                "native_fields": [],
                "custom_fields": [],
                "metafields": [],
                "computed_fields": [],
                "relationships": ["line_items", "customer"]
            },
            "line_item": {
                "native_fields": [],
                "custom_fields": [],
                "metafields": [],
                "computed_fields": [],
                "relationships": ["order", "variant"]
            },
            "variant": {
                "native_fields": [],
                "custom_fields": [],
                "metafields": [],
                "computed_fields": [],
                "relationships": ["product", "line_items"]
            },
            "product": {
                "native_fields": [],
                "custom_fields": [],
                "metafields": [],
                "computed_fields": [],
                "relationships": ["variants"]
            },
            "customer": {
                "native_fields": [],
                "custom_fields": [],
                "metafields": [],
                "computed_fields": [],
                "relationships": ["orders"]
            }
        }

        # 1. DISCOVER NATIVE FIELDS from SQLAlchemy models
        for entity_name, model_class in entity_models.items():
            if entity_name in schema:
                columns = _get_sqlalchemy_columns(model_class)
                native_cols = [c for c in columns if not c.endswith("_id") or c == "id"]
                schema[entity_name]["native_fields"] = native_cols

        # 2. DISCOVER CUSTOM FIELDS
        try:
            custom_fields_result = await db.execute(
                select(CustomFieldDefinition.entity_type, CustomFieldDefinition.field_key,
                       CustomFieldDefinition.field_label, CustomFieldDefinition.field_type)
            )
            custom_fields = custom_fields_result.all()
            for entity_type, field_key, field_label, field_type in custom_fields:
                if entity_type in schema:
                    schema[entity_type]["custom_fields"].append({
                        "key": field_key,
                        "label": field_label or field_key,
                        "type": field_type or "string"
                    })
        except Exception as e:
            print(f"Custom fields discovery error: {e}")

        # 3. DISCOVER METAFIELDS
        try:
            metafields_result = await db.execute(
                select(MetafieldMapping.entity_type, MetafieldMapping.shopify_namespace,
                       MetafieldMapping.shopify_key).distinct()
            )
            metafields = metafields_result.all()
            for entity_type, namespace, key in metafields:
                if entity_type in schema:
                    metafield_key = f"{namespace}.{key}" if namespace else key
                    schema[entity_type]["metafields"].append({
                        "key": metafield_key,
                        "label": key.replace("_", " ").title(),
                        "namespace": namespace,
                        "shopify_key": key
                    })
        except Exception as e:
            print(f"Metafields discovery error: {e}")

        # 4. DISCOVER COMPUTED FIELDS from active rules
        try:
            rules_result = await db.execute(
                select(FieldTransformRule).where(FieldTransformRule.is_active == True)
            )
            rules = rules_result.scalars().all()
            for rule in rules:
                entity = rule.output_entity
                if entity in schema:
                    schema[entity]["computed_fields"].append({
                        "key": rule.output_field_key,
                        "label": rule.output_field_label,
                        "type": rule.output_field_type
                    })
        except Exception as e:
            print(f"Computed fields discovery error: {e}")

        # 5. DISCOVER from actual data samples
        for entity_name, model_class in entity_models.items():
            try:
                sample_result = await db.execute(select(model_class).limit(1))
                sample = sample_result.scalar_one_or_none()
                if sample and hasattr(sample, '__table__'):
                    for col in sample.__table__.columns:
                        if col.name in ['raw_data', 'metafields', 'custom_data', 'properties']:
                            col_value = getattr(sample, col.name, None)
                            if isinstance(col_value, dict):
                                for key in col_value.keys():
                                    existing = [f["key"] for f in schema[entity_name]["custom_fields"]]
                                    if key not in schema[entity_name]["native_fields"] and key not in existing:
                                        schema[entity_name]["custom_fields"].append({
                                            "key": key,
                                            "label": key.replace("_", " ").title(),
                                            "type": "string",
                                            "discovered_from": col.name
                                        })
            except Exception:
                pass  # Ignore errors from data discovery

        return JSONResponse(
            content={"entities": schema},
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                "Access-Control-Allow-Headers": "*"
            }
        )
    except Exception as e:
        import traceback
        error_detail = f"Schema error: {str(e)}\n{traceback.format_exc()}"
        print(error_detail)
        return JSONResponse(
            status_code=500,
            content={"error": str(e), "detail": error_detail},
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                "Access-Control-Allow-Headers": "*"
            }
        )


# ═════════════════════════════════════════════════════════════════
# Job Management Endpoints
# ═════════════════════════════════════════════════════════════════

@router.get("/jobs", response_model=List[RecalculationJobResponse])
async def list_jobs(
    status: Optional[str] = Query(None, description="Filter by status"),
    rule_id: Optional[str] = Query(None, description="Filter by rule"),
    limit: int = Query(50, ge=1, le=100),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user)
):
    """List recalculation jobs with optional filtering."""
    query = select(
        RecalculationJob,
        FieldTransformRule.name.label("rule_name")
    ).join(
        FieldTransformRule,
        RecalculationJob.rule_id == FieldTransformRule.id
    ).order_by(RecalculationJob.created_at.desc()).limit(limit)

    if status:
        query = query.where(RecalculationJob.status == status)

    if rule_id:
        query = query.where(RecalculationJob.rule_id == rule_id)

    result = await db.execute(query)

    jobs = []
    for row in result:
        job = row.RecalculationJob
        job.rule_name = row.rule_name
        jobs.append(job)

    return jobs


@router.get("/jobs/{job_id}")
async def get_job(
    job_id: str,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user)
):
    """Get job details with error logs if failed."""
    result = await db.execute(
        select(RecalculationJob).where(RecalculationJob.id == job_id)
    )
    job = result.scalar_one_or_none()

    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # Get rule name
    rule_result = await db.execute(
        select(FieldTransformRule.name).where(FieldTransformRule.id == job.rule_id)
    )
    rule_name = rule_result.scalar_one_or_none()

    return {
        "job": job,
        "rule_name": rule_name,
        "error_details": job.error_details if job.status == "failed" else None
    }


@router.post("/jobs/{job_id}/cancel")
async def cancel_job(
    job_id: str,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user)
):
    """Cancel a pending or running job."""
    result = await db.execute(
        select(RecalculationJob).where(RecalculationJob.id == job_id)
    )
    job = result.scalar_one_or_none()

    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.status not in ["pending", "running"]:
        raise HTTPException(status_code=400, detail=f"Cannot cancel job with status: {job.status}")

    job.status = "cancelled"
    await db.commit()

    return {"status": "cancelled", "id": job_id}


# ═════════════════════════════════════════════════════════════════
# Derived Values Endpoints
# ═════════════════════════════════════════════════════════════════

@router.get("/values")
async def get_derived_values(
    entity_type: str,
    entity_id: str,
    include_stale: bool = Query(True),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user)
):
    """Get computed derived values for an entity."""
    query = select(
        DerivedFieldValue,
        FieldTransformRule.output_field_key,
        FieldTransformRule.name
    ).join(
        FieldTransformRule,
        DerivedFieldValue.rule_id == FieldTransformRule.id
    ).where(
        and_(
            DerivedFieldValue.entity_type == entity_type,
            DerivedFieldValue.entity_id == entity_id
        )
    )

    if not include_stale:
        query = query.where(DerivedFieldValue.is_stale == False)

    result = await db.execute(query)

    values = []
    for row in result:
        values.append(DerivedValueResponse(
            rule_id=row.DerivedFieldValue.rule_id,
            rule_name=row.name,
            output_field_key=row.output_field_key,
            value=row.DerivedFieldValue.value,
            computed_at=row.DerivedFieldValue.computed_at,
            is_stale=row.DerivedFieldValue.is_stale
        ))

    return {
        "entity_type": entity_type,
        "entity_id": entity_id,
        "values": {v.output_field_key: v for v in values}
    }


@router.post("/values/refresh")
async def refresh_values(
    entity_type: str,
    entity_ids: List[str],
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user)
):
    """Force refresh of derived values for specific entities."""
    # Get all active rules for this entity type
    result = await db.execute(
        select(FieldTransformRule).where(
            and_(
                FieldTransformRule.output_entity == entity_type,
                FieldTransformRule.is_active == True
            )
        )
    )
    rules = result.scalars().all()

    # Recompute for each entity
    graph = RuleExecutionGraph()
    refreshed_count = 0

    for entity_id in entity_ids:
        try:
            await db.run_sync(
                lambda s: graph.compute_for_entity(entity_type, entity_id, rules, s)
            )
            refreshed_count += 1
        except Exception as e:
            log.warning(f"Failed to refresh {entity_type}:{entity_id}: {e}")

    return {
        "refreshed": refreshed_count,
        "failed": len(entity_ids) - refreshed_count,
        "entity_type": entity_type
    }


# ═════════════════════════════════════════════════════════════════
# Helper Functions
# ═════════════════════════════════════════════════════════════════

async def _ensure_field_registered(
    db: AsyncSession, shop_id: str, rule: FieldTransformRule
) -> None:
    """Upsert a CustomFieldDefinition for a transform rule's output field."""
    existing = await db.execute(
        select(CustomFieldDefinition).where(
            CustomFieldDefinition.shop_id == shop_id,
            CustomFieldDefinition.entity_type == rule.output_entity,
            CustomFieldDefinition.key == f"cf_{rule.output_field_key}",
        )
    )
    cfd = existing.scalar_one_or_none()
    field_type = rule.output_field_type if rule.output_field_type in ("text", "number", "boolean", "date", "json") else "text"
    if cfd:
        cfd.name = rule.output_field_label
        cfd.field_type = field_type
        cfd.description = f"Computed by Data Studio rule: {rule.name}"
    else:
        db.add(CustomFieldDefinition(
            shop_id=shop_id,
            entity_type=rule.output_entity,
            key=f"cf_{rule.output_field_key}",
            name=rule.output_field_label,
            field_type=field_type,
            description=f"Computed by Data Studio rule: {rule.name}",
        ))
    await db.commit()


async def _infer_path(db: AsyncSession, from_entity: str, to_entity: str) -> List[dict]:
    """Auto-infer relationship path between entities."""
    if from_entity == to_entity:
        return []

    # Query entity relationships
    result = await db.execute(
        select(EntityRelationship).where(
            and_(
                EntityRelationship.from_entity == from_entity,
                EntityRelationship.to_entity == to_entity
            )
        )
    )
    direct = result.scalar_one_or_none()

    if direct:
        return [{"entity": to_entity, "via": direct.via_field, "inferred": True}]

    # Try two-hop path
    result = await db.execute(
        select(EntityRelationship).where(
            EntityRelationship.from_entity == from_entity
        )
    )
    first_hops = result.scalars().all()

    for hop in first_hops:
        result = await db.execute(
            select(EntityRelationship).where(
                and_(
                    EntityRelationship.from_entity == hop.to_entity,
                    EntityRelationship.to_entity == to_entity
                )
            )
        )
        second_hop = result.scalar_one_or_none()

        if second_hop:
            return [
                {"entity": hop.to_entity, "via": hop.via_field, "inferred": True},
                {"entity": to_entity, "via": second_hop.via_field, "inferred": True}
            ]

    return []


async def _get_available_fields(db: AsyncSession, entity: str) -> List[str]:
    """Get available fields for an entity."""
    # This would query the actual schema or use predefined mappings
    field_map = {
        "order": ["id", "name", "total_price", "status"],
        "line_item": ["id", "sku", "quantity", "price", "variant_id"],
        "variant": ["id", "sku", "price", "product_id"],
        "product": ["id", "title", "vendor"],
        "customer": ["id", "email", "first_name"]
    }

    base_fields = field_map.get(entity, [])

    # Add metafield patterns
    if entity in ["variant", "product"]:
        base_fields.extend([
            "metafields.custom.bin_number",
            "metafields.custom.shipping_units"
        ])

    return base_fields


async def _calculate_run_order(db: AsyncSession, depends_on: List[str]) -> int:
    """Calculate run_order based on dependencies."""
    if not depends_on:
        return 0

    # Get max run_order of dependencies
    result = await db.execute(
        select(FieldTransformRule.run_order).where(
            FieldTransformRule.output_field_key.in_(depends_on)
        )
    )
    dep_orders = result.scalars().all()

    return max(dep_orders) + 1 if dep_orders else 0


async def _fetch_sample_values(
    db: AsyncSession,
    entity: str,
    field: str,
    entity_ids: List[str],
    path: Optional[List[SourcePathStep]]
) -> List[str]:
    """Fetch sample values from database."""
    # Simplified implementation - would need to handle paths
    model_map = {
        "order": Order,
        "line_item": LineItem,
        "product": Product,
        "variant": Variant,
        "customer": Customer
    }

    model = model_map.get(entity)
    if not model:
        return []

    result = await db.execute(
        select(model).where(model.id.in_(entity_ids)).limit(5)
    )
    entities = result.scalars().all()

    values = []
    for e in entities:
        val = getattr(e, field, None)
        if val:
            values.append(str(val))

    return values

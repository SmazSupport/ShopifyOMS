"""
Rules router — CRUD for:
  - FieldTransformRule  (GET/POST/PUT/DELETE /rules/transforms)
  - BundleRule          (GET/POST/PUT/DELETE /rules/bundles)
  - MysteryRule         (GET/POST/PUT/DELETE /rules/mystery)
  - SkuRule             (GET/POST/PUT/DELETE /rules/sku)

Also exposes:
  - POST /rules/preview  — apply a transform config to a sample value (for live preview)
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional, Any
from app.database import get_db
from app.utils.auth import get_current_user
from app.models.fulfillment import FieldTransformRule, BundleRule, MysteryRule, SkuRule
from app.utils.rule_engine import apply_transform

router = APIRouter(prefix="/rules", tags=["rules"])


async def get_shop_id(db: AsyncSession) -> str:
    """Return first shop id — single-tenant for now."""
    from app.models.shop import Shop
    result = await db.execute(select(Shop).limit(1))
    shop = result.scalar_one_or_none()
    if not shop:
        raise HTTPException(400, "No shop configured")
    return shop.id


# ─────────────────────────────────────────────────────────────────
# Schemas
# ─────────────────────────────────────────────────────────────────

class FieldTransformIn(BaseModel):
    name: str
    source_entity: str
    source_field: str
    transform_type: str
    transform_config: dict = {}
    output_field_key: str
    output_field_label: str
    output_entity: str
    is_active: bool = True
    run_order: int = 0
    notes: Optional[str] = None


class FieldTransformOut(FieldTransformIn):
    id: str
    model_config = {"from_attributes": True}


class BundleChildIn(BaseModel):
    sku: str
    quantity: int = 1


class BundleRuleIn(BaseModel):
    parent_sku: str
    bundle_name: Optional[str] = None
    child_skus: list[dict]
    ships_together: bool = True
    allow_partial_ship: bool = False
    notify_shopify_as_parent: bool = True
    is_active: bool = True
    notes: Optional[str] = None


class BundleRuleOut(BundleRuleIn):
    id: str
    model_config = {"from_attributes": True}


class MysteryRuleIn(BaseModel):
    mystery_sku: str
    eligible_skus: list[str] = []
    selection_strategy: str = "exclude_previously_shipped"
    fallback_sku: Optional[str] = None
    exclude_if_previously_received: bool = True
    is_active: bool = True
    notes: Optional[str] = None


class MysteryRuleOut(MysteryRuleIn):
    id: str
    model_config = {"from_attributes": True}


class SkuRuleIn(BaseModel):
    sku: str
    ships_alone: bool = False
    ships_alone_reason: Optional[str] = None
    is_preorder: bool = False
    preorder_release_date: Optional[str] = None
    allow_partial_ship: bool = False
    hold_reason: Optional[str] = None
    is_active: bool = True
    notes: Optional[str] = None


class SkuRuleOut(SkuRuleIn):
    id: str
    model_config = {"from_attributes": True}


class PreviewRequest(BaseModel):
    sample_value: Any
    transform_type: str
    transform_config: dict = {}


class PreviewResponse(BaseModel):
    input: Any
    output: Any
    transform_type: str


# ─────────────────────────────────────────────────────────────────
# Preview endpoint (no DB needed)
# ─────────────────────────────────────────────────────────────────

@router.post("/preview", response_model=PreviewResponse)
async def preview_transform(
    req: PreviewRequest,
    _=Depends(get_current_user),
):
    """Apply a transform config to a sample value and return the result."""
    result = apply_transform(req.sample_value, req.transform_type, req.transform_config)
    return PreviewResponse(input=req.sample_value, output=result, transform_type=req.transform_type)


# ─────────────────────────────────────────────────────────────────
# Field Transform Rules
# ─────────────────────────────────────────────────────────────────

@router.get("/transforms", response_model=list[FieldTransformOut])
async def list_transforms(
    source_entity: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    shop_id = await get_shop_id(db)
    q = select(FieldTransformRule).where(
        FieldTransformRule.shop_id == shop_id
    ).order_by(FieldTransformRule.run_order, FieldTransformRule.name)
    if source_entity:
        q = q.where(FieldTransformRule.source_entity == source_entity)
    rows = (await db.execute(q)).scalars().all()
    return rows


@router.post("/transforms", response_model=FieldTransformOut)
async def create_transform(
    body: FieldTransformIn,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    shop_id = await get_shop_id(db)
    rule = FieldTransformRule(**body.model_dump(), shop_id=shop_id)
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return rule


@router.put("/transforms/{rule_id}", response_model=FieldTransformOut)
async def update_transform(
    rule_id: str,
    body: FieldTransformIn,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    shop_id = await get_shop_id(db)
    rule = await db.get(FieldTransformRule, rule_id)
    if not rule or rule.shop_id != shop_id:
        raise HTTPException(404, "Not found")
    for k, v in body.model_dump().items():
        setattr(rule, k, v)
    await db.commit()
    await db.refresh(rule)
    return rule


@router.delete("/transforms/{rule_id}")
async def delete_transform(
    rule_id: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    shop_id = await get_shop_id(db)
    rule = await db.get(FieldTransformRule, rule_id)
    if not rule or rule.shop_id != shop_id:
        raise HTTPException(404, "Not found")
    await db.delete(rule)
    await db.commit()
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────
# Bundle Rules
# ─────────────────────────────────────────────────────────────────

@router.get("/bundles", response_model=list[BundleRuleOut])
async def list_bundles(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    shop_id = await get_shop_id(db)
    q = select(BundleRule).where(
        BundleRule.shop_id == shop_id
    ).order_by(BundleRule.parent_sku)
    rows = (await db.execute(q)).scalars().all()
    return rows


@router.post("/bundles", response_model=BundleRuleOut)
async def create_bundle(
    body: BundleRuleIn,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    shop_id = await get_shop_id(db)
    rule = BundleRule(**body.model_dump(), shop_id=shop_id)
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return rule


@router.put("/bundles/{rule_id}", response_model=BundleRuleOut)
async def update_bundle(
    rule_id: str,
    body: BundleRuleIn,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    shop_id = await get_shop_id(db)
    rule = await db.get(BundleRule, rule_id)
    if not rule or rule.shop_id != shop_id:
        raise HTTPException(404, "Not found")
    for k, v in body.model_dump().items():
        setattr(rule, k, v)
    await db.commit()
    await db.refresh(rule)
    return rule


@router.delete("/bundles/{rule_id}")
async def delete_bundle(
    rule_id: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    shop_id = await get_shop_id(db)
    rule = await db.get(BundleRule, rule_id)
    if not rule or rule.shop_id != shop_id:
        raise HTTPException(404, "Not found")
    await db.delete(rule)
    await db.commit()
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────
# Mystery Rules
# ─────────────────────────────────────────────────────────────────

@router.get("/mystery", response_model=list[MysteryRuleOut])
async def list_mystery(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    shop_id = await get_shop_id(db)
    q = select(MysteryRule).where(
        MysteryRule.shop_id == shop_id
    ).order_by(MysteryRule.mystery_sku)
    rows = (await db.execute(q)).scalars().all()
    return rows


@router.post("/mystery", response_model=MysteryRuleOut)
async def create_mystery(
    body: MysteryRuleIn,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    shop_id = await get_shop_id(db)
    rule = MysteryRule(**body.model_dump(), shop_id=shop_id)
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return rule


@router.put("/mystery/{rule_id}", response_model=MysteryRuleOut)
async def update_mystery(
    rule_id: str,
    body: MysteryRuleIn,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    shop_id = await get_shop_id(db)
    rule = await db.get(MysteryRule, rule_id)
    if not rule or rule.shop_id != shop_id:
        raise HTTPException(404, "Not found")
    for k, v in body.model_dump().items():
        setattr(rule, k, v)
    await db.commit()
    await db.refresh(rule)
    return rule


@router.delete("/mystery/{rule_id}")
async def delete_mystery(
    rule_id: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    shop_id = await get_shop_id(db)
    rule = await db.get(MysteryRule, rule_id)
    if not rule or rule.shop_id != shop_id:
        raise HTTPException(404, "Not found")
    await db.delete(rule)
    await db.commit()
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────
# SKU Rules
# ─────────────────────────────────────────────────────────────────

@router.get("/sku", response_model=list[SkuRuleOut])
async def list_sku_rules(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    shop_id = await get_shop_id(db)
    q = select(SkuRule).where(
        SkuRule.shop_id == shop_id
    ).order_by(SkuRule.sku)
    rows = (await db.execute(q)).scalars().all()
    return rows


@router.post("/sku", response_model=SkuRuleOut)
async def create_sku_rule(
    body: SkuRuleIn,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    shop_id = await get_shop_id(db)
    rule = SkuRule(**body.model_dump(), shop_id=shop_id)
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return rule


@router.put("/sku/{rule_id}", response_model=SkuRuleOut)
async def update_sku_rule(
    rule_id: str,
    body: SkuRuleIn,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    shop_id = await get_shop_id(db)
    rule = await db.get(SkuRule, rule_id)
    if not rule or rule.shop_id != shop_id:
        raise HTTPException(404, "Not found")
    for k, v in body.model_dump().items():
        setattr(rule, k, v)
    await db.commit()
    await db.refresh(rule)
    return rule


@router.delete("/sku/{rule_id}")
async def delete_sku_rule(
    rule_id: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    shop_id = await get_shop_id(db)
    rule = await db.get(SkuRule, rule_id)
    if not rule or rule.shop_id != shop_id:
        raise HTTPException(404, "Not found")
    await db.delete(rule)
    await db.commit()
    return {"ok": True}

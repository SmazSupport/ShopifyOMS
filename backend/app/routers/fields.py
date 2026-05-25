from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional
from app.database import get_db
from app.models.custom_field import CustomFieldDefinition, MetafieldMapping, CustomFieldValue, ENTITY_TYPES, FIELD_TYPES
from app.models.shop import Shop
from app.utils.auth import get_current_user

router = APIRouter(prefix="/fields", tags=["fields"])


class MappingOut(BaseModel):
    id: str
    shopify_namespace: str
    shopify_key: str
    model_config = {"from_attributes": True}


class FieldOut(BaseModel):
    id: str
    entity_type: str
    name: str
    key: str
    field_type: str
    description: Optional[str]
    mapping: Optional[MappingOut]
    model_config = {"from_attributes": True}


class FieldCreate(BaseModel):
    entity_type: str
    name: str
    key: str
    field_type: str = "text"
    description: Optional[str] = None


class MappingUpsert(BaseModel):
    shopify_namespace: str
    shopify_key: str


async def get_demo_shop(db: AsyncSession) -> Shop:
    result = await db.execute(select(Shop).limit(1))
    shop = result.scalar_one_or_none()
    if not shop:
        raise HTTPException(status_code=404, detail="No shop configured")
    return shop


@router.get("", response_model=list[FieldOut])
async def list_fields(
    entity_type: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    shop = await get_demo_shop(db)
    q = select(CustomFieldDefinition).options(
        selectinload(CustomFieldDefinition.mapping)
    ).where(CustomFieldDefinition.shop_id == shop.id)
    if entity_type:
        q = q.where(CustomFieldDefinition.entity_type == entity_type)
    q = q.order_by(CustomFieldDefinition.entity_type, CustomFieldDefinition.name)
    result = await db.execute(q)
    return result.scalars().all()


@router.post("", response_model=FieldOut, status_code=201)
async def create_field(
    data: FieldCreate,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    if data.entity_type not in ENTITY_TYPES:
        raise HTTPException(status_code=400, detail=f"entity_type must be one of {ENTITY_TYPES}")
    if data.field_type not in FIELD_TYPES:
        raise HTTPException(status_code=400, detail=f"field_type must be one of {FIELD_TYPES}")

    shop = await get_demo_shop(db)

    existing = await db.execute(
        select(CustomFieldDefinition).where(
            CustomFieldDefinition.shop_id == shop.id,
            CustomFieldDefinition.entity_type == data.entity_type,
            CustomFieldDefinition.key == data.key,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="A field with this key already exists for this entity type")

    field = CustomFieldDefinition(
        shop_id=shop.id,
        entity_type=data.entity_type,
        name=data.name,
        key=data.key,
        field_type=data.field_type,
        description=data.description,
    )
    db.add(field)
    await db.commit()
    await db.refresh(field, ["mapping"])
    return field


@router.delete("/{field_id}", status_code=204)
async def delete_field(
    field_id: str,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    result = await db.execute(select(CustomFieldDefinition).where(CustomFieldDefinition.id == field_id))
    field = result.scalar_one_or_none()
    if not field:
        raise HTTPException(status_code=404, detail="Field not found")
    await db.delete(field)
    await db.commit()


@router.put("/{field_id}/mapping", response_model=MappingOut)
async def upsert_mapping(
    field_id: str,
    data: MappingUpsert,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    result = await db.execute(
        select(CustomFieldDefinition)
        .options(selectinload(CustomFieldDefinition.mapping))
        .where(CustomFieldDefinition.id == field_id)
    )
    field = result.scalar_one_or_none()
    if not field:
        raise HTTPException(status_code=404, detail="Field not found")

    if field.mapping:
        field.mapping.shopify_namespace = data.shopify_namespace
        field.mapping.shopify_key = data.shopify_key
    else:
        mapping = MetafieldMapping(
            shop_id=field.shop_id,
            custom_field_id=field.id,
            shopify_namespace=data.shopify_namespace,
            shopify_key=data.shopify_key,
        )
        db.add(mapping)

    await db.commit()
    await db.refresh(field, ["mapping"])
    return field.mapping


@router.delete("/{field_id}/mapping", status_code=204)
async def delete_mapping(
    field_id: str,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    result = await db.execute(
        select(CustomFieldDefinition)
        .options(selectinload(CustomFieldDefinition.mapping))
        .where(CustomFieldDefinition.id == field_id)
    )
    field = result.scalar_one_or_none()
    if not field or not field.mapping:
        raise HTTPException(status_code=404, detail="Mapping not found")
    await db.delete(field.mapping)
    await db.commit()


@router.get("/entity-types")
async def entity_types(_=Depends(get_current_user)):
    return list(ENTITY_TYPES)


@router.get("/field-types")
async def field_types(_=Depends(get_current_user)):
    return list(FIELD_TYPES)

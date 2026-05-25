from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional
from app.database import get_db
from app.models.product import Product, Variant
from app.utils.auth import get_current_user

router = APIRouter(prefix="/products", tags=["products"])


class VariantOut(BaseModel):
    id: str
    shopify_variant_id: Optional[str]
    sku: Optional[str]
    title: Optional[str]
    price: Optional[float]
    inventory_quantity: Optional[int]
    option1: Optional[str] = None
    option2: Optional[str] = None
    option3: Optional[str] = None
    model_config = {"from_attributes": True}


class ProductOut(BaseModel):
    id: str
    shopify_product_id: Optional[str]
    title: str
    handle: Optional[str]
    product_type: Optional[str]
    vendor: Optional[str]
    is_active: bool
    variant_count: int
    variants: list[VariantOut]
    model_config = {"from_attributes": True}


class ProductsPage(BaseModel):
    items: list[ProductOut]
    total: int
    page: int
    page_size: int
    total_pages: int


@router.get("", response_model=ProductsPage)
async def list_products(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    search: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    query = select(Product).options(selectinload(Product.variants))

    if search:
        query = query.where(
            Product.title.ilike(f"%{search}%") | Product.handle.ilike(f"%{search}%")
        )

    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar()

    query = query.order_by(Product.title).offset((page - 1) * page_size).limit(page_size)
    products = (await db.execute(query)).scalars().all()

    items = [
        ProductOut(
            id=p.id,
            shopify_product_id=p.shopify_product_id,
            title=p.title,
            handle=p.handle,
            product_type=p.product_type,
            vendor=p.vendor,
            is_active=p.is_active,
            variant_count=len(p.variants),
            variants=[VariantOut.model_validate(v) for v in p.variants],
        )
        for p in products
    ]

    return ProductsPage(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=-(-total // page_size),
    )

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional
from app.database import get_db
from app.models.order import Order
from app.models.line_item import LineItem
from app.models.customer import Customer
from app.utils.auth import get_current_user

router = APIRouter(prefix="/orders", tags=["orders"])


class LineItemOut(BaseModel):
    id: str
    shopify_line_item_id: Optional[str]
    sku: Optional[str]
    product_title: Optional[str]
    variant_title: Optional[str]
    quantity: int
    price: Optional[float]
    model_config = {"from_attributes": True}


class CustomerSnippet(BaseModel):
    id: str
    email: Optional[str]
    first_name: Optional[str]
    last_name: Optional[str]
    model_config = {"from_attributes": True}


class OrderOut(BaseModel):
    id: str
    shopify_order_id: Optional[str]
    order_number: Optional[str]
    status: str
    fulfillment_status: Optional[str]
    financial_status: Optional[str]
    total_price: Optional[float]
    currency: Optional[str]
    item_count: int
    tags: Optional[list]
    created_at: str
    customer: Optional[CustomerSnippet]
    line_items: list[LineItemOut] = []

    model_config = {"from_attributes": True}


class OrdersPage(BaseModel):
    items: list[OrderOut]
    total: int
    page: int
    page_size: int
    total_pages: int


@router.get("", response_model=OrdersPage)
async def list_orders(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    status: Optional[str] = Query(None),
    fulfillment_status: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    query = select(Order).options(selectinload(Order.customer), selectinload(Order.line_items))

    if status:
        query = query.where(Order.status == status)
    if fulfillment_status:
        query = query.where(Order.fulfillment_status == fulfillment_status)
    if search:
        query = query.where(Order.order_number.ilike(f"%{search}%"))

    count_result = await db.execute(select(func.count()).select_from(query.subquery()))
    total = count_result.scalar()

    query = query.order_by(Order.created_at.desc())
    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    orders = result.scalars().all()

    items = []
    for o in orders:
        items.append(OrderOut(
            id=o.id,
            shopify_order_id=o.shopify_order_id,
            order_number=o.order_number,
            status=o.status,
            fulfillment_status=o.fulfillment_status,
            financial_status=o.financial_status,
            total_price=float(o.total_price) if o.total_price else None,
            currency=o.currency,
            item_count=o.item_count,
            tags=o.tags,
            created_at=o.created_at.isoformat(),
            customer=CustomerSnippet.model_validate(o.customer) if o.customer else None,
            line_items=[
                LineItemOut(
                    id=li.id,
                    shopify_line_item_id=li.shopify_line_item_id,
                    sku=li.sku,
                    product_title=li.product_title,
                    variant_title=li.variant_title,
                    quantity=li.quantity,
                    price=float(li.price) if li.price else None,
                )
                for li in o.line_items
            ],
        ))

    return OrdersPage(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=-(-total // page_size),
    )

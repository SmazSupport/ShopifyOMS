from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional, Any
from app.database import get_db
from app.models.order import Order
from app.models.fulfillment import FieldTransformRule
from app.models.custom_field import CustomFieldDefinition, CustomFieldValue
from app.utils.auth import get_current_user
from app.utils.rule_engine import apply_field_transforms

router = APIRouter(prefix="/orders", tags=["orders"])


class LineItemOut(BaseModel):
    id: str
    shopify_line_item_id: Optional[str] = None
    sku: Optional[str] = None
    product_title: Optional[str] = None
    variant_title: Optional[str] = None
    name: Optional[str] = None
    quantity: int
    price: Optional[float] = None
    fulfillment_status: Optional[str] = None
    requires_shipping: bool = True
    gift_card: bool = False
    properties: Optional[list] = None
    grams: Optional[int] = None
    vendor: Optional[str] = None
    product_type: Optional[str] = None
    total_discount: Optional[float] = None
    extra_attributes: Optional[dict] = None
    computed_fields: Optional[dict[str, Any]] = None
    custom_fields: Optional[dict[str, Any]] = None
    model_config = {"from_attributes": True}


class CustomerSnippet(BaseModel):
    id: str
    email: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    model_config = {"from_attributes": True}


class OrderOut(BaseModel):
    id: str
    shopify_order_id: Optional[str] = None
    order_number: Optional[str] = None
    status: str
    fulfillment_status: Optional[str] = None
    financial_status: Optional[str] = None
    total_price: Optional[float] = None
    subtotal_price: Optional[float] = None
    total_tax: Optional[float] = None
    total_discounts: Optional[float] = None
    currency: Optional[str] = None
    item_count: int
    email: Optional[str] = None
    phone: Optional[str] = None
    tags: Optional[list] = None
    payment_gateway: Optional[str] = None
    source_name: Optional[str] = None
    discount_codes: Optional[list] = None
    shipping_address: Optional[dict] = None
    note: Optional[str] = None
    processed_at: Optional[str] = None
    created_at: str
    customer: Optional[CustomerSnippet] = None
    line_items: list[LineItemOut] = []
    computed_fields: Optional[dict[str, Any]] = None

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
    query = select(Order).options(
        selectinload(Order.customer),
        selectinload(Order.line_items),
    )

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

    # Load active field transform rules for orders and line_items
    rules_result = await db.execute(
        select(FieldTransformRule).where(
            FieldTransformRule.is_active == True,
            FieldTransformRule.source_entity.in_(["order", "line_item"]),
        )
    )
    all_rules = rules_result.scalars().all()
    transform_rules = [r for r in all_rules if r.source_entity == "order"]
    li_transform_rules = [r for r in all_rules if r.source_entity == "line_item"]

    # Load custom field definitions for line_item
    cfd_result = await db.execute(
        select(CustomFieldDefinition).where(
            CustomFieldDefinition.entity_type == "line_item"
        )
    )
    li_custom_field_defs = {cfd.key: cfd for cfd in cfd_result.scalars().all()}

    # Collect all line item IDs to bulk-fetch custom_field_values
    all_li_ids = [li.id for o in orders for li in o.line_items]
    custom_values_by_li: dict[str, dict[str, Any]] = {}
    if all_li_ids and li_custom_field_defs:
        cv_result = await db.execute(
            select(CustomFieldValue).where(
                CustomFieldValue.entity_type == "line_item",
                CustomFieldValue.entity_id.in_(all_li_ids),
            )
        )
        for cv in cv_result.scalars().all():
            cfd = li_custom_field_defs.get(cv.custom_field_id) or next(
                (d for d in li_custom_field_defs.values() if d.id == cv.custom_field_id), None
            )
            if cfd:
                custom_values_by_li.setdefault(cv.entity_id, {})[cfd.key] = (
                    cv.value.get("v") if isinstance(cv.value, dict) and "v" in cv.value else cv.value
                )

    items = []
    for o in orders:
        # Build entity dict for rule engine
        entity_data = {
            "order_number": o.order_number,
            "status": o.status,
            "fulfillment_status": o.fulfillment_status,
            "financial_status": o.financial_status,
            "email": o.email,
            "phone": o.phone,
            "tags": ",".join(o.tags) if o.tags else "",
            "source_name": o.source_name,
            "payment_gateway": o.payment_gateway,
            "note": o.note,
            "currency": o.currency,
            "total_price": str(o.total_price) if o.total_price else "",
        }
        computed = apply_field_transforms("order", entity_data, transform_rules) if transform_rules else None

        items.append(OrderOut(
            id=o.id,
            shopify_order_id=o.shopify_order_id,
            order_number=o.order_number,
            status=o.status,
            fulfillment_status=o.fulfillment_status,
            financial_status=o.financial_status,
            total_price=float(o.total_price) if o.total_price is not None else None,
            subtotal_price=float(o.subtotal_price) if o.subtotal_price is not None else None,
            total_tax=float(o.total_tax) if o.total_tax is not None else None,
            total_discounts=float(o.total_discounts) if o.total_discounts is not None else None,
            currency=o.currency,
            item_count=o.item_count,
            email=o.email,
            phone=o.phone,
            tags=o.tags,
            payment_gateway=o.payment_gateway,
            source_name=o.source_name,
            discount_codes=o.discount_codes,
            shipping_address=o.shipping_address,
            note=o.note,
            processed_at=o.processed_at,
            created_at=o.created_at.isoformat(),
            customer=CustomerSnippet.model_validate(o.customer) if o.customer else None,
            line_items=[
                LineItemOut(
                    id=li.id,
                    shopify_line_item_id=li.shopify_line_item_id,
                    sku=li.sku,
                    product_title=li.product_title,
                    variant_title=li.variant_title,
                    name=li.name,
                    quantity=li.quantity,
                    price=float(li.price) if li.price is not None else None,
                    fulfillment_status=li.fulfillment_status,
                    requires_shipping=li.requires_shipping,
                    gift_card=li.gift_card,
                    properties=li.properties,
                    grams=li.grams,
                    vendor=li.vendor,
                    product_type=li.product_type,
                    total_discount=float(li.total_discount) if li.total_discount is not None else None,
                    extra_attributes=li.extra_attributes,
                    computed_fields=apply_field_transforms(
                        "line_item",
                        {
                            "id": li.id,
                            "sku": li.sku,
                            "product_title": li.product_title,
                            "variant_title": li.variant_title,
                            "quantity": str(li.quantity),
                            "price": str(li.price) if li.price else "",
                            "grams": str(li.grams) if li.grams else "",
                            "vendor": li.vendor or "",
                            "product_type": li.product_type or "",
                            "fulfillment_status": li.fulfillment_status or "",
                            "extra_attributes": str(li.extra_attributes or ""),
                        },
                        li_transform_rules,
                    ) if li_transform_rules else None,
                    custom_fields=custom_values_by_li.get(li.id) or None,
                )
                for li in o.line_items
            ],
            computed_fields=computed,
        ))

    return OrdersPage(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=-(-total // page_size),
    )

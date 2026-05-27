"""Working schema endpoint that returns hardcoded fields."""
from fastapi import APIRouter, Depends
from sqlalchemy import select
from app.database import get_async_session
from app.models import User, FieldTransformRule
from app.auth import get_current_user
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/data-studio", tags=["data-studio"])

@router.get("/schema")
async def get_schema(
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user)
):
    """Get entity schema with fields and relationships."""
    schema = {
        "order": {
            "native_fields": ["id", "name", "total_price", "subtotal_price",
                           "tax_price", "shipping_price", "discount_price",
                           "created_at", "updated_at", "processed_at",
                           "cancelled_at", "closed_at", "fulfillment_status",
                           "financial_status", "currency", "customer_id"],
            "custom_fields": [],
            "metafields": [],
            "computed_fields": [],
            "relationships": ["line_items", "customer"]
        },
        "line_item": {
            "native_fields": ["id", "order_id", "variant_id", "product_id",
                           "sku", "name", "quantity", "price", "total_discount",
                           "fulfillment_status", "fulfillable_quantity", "grams", "vendor", "product_type"],
            "custom_fields": [],
            "metafields": [],
            "computed_fields": [],
            "relationships": ["order", "variant"]
        },
        "variant": {
            "native_fields": ["id", "product_id", "sku", "price", "compare_at_price",
                           "inventory_quantity", "weight", "weight_unit",
                           "barcode", "requires_shipping", "taxable"],
            "custom_fields": [],
            "metafields": [{"key": "custom.bin", "label": "Bin", "namespace": "custom", "shopify_key": "bin"}],
            "computed_fields": [],
            "relationships": ["product", "line_items"]
        },
        "product": {
            "native_fields": ["id", "title", "handle", "product_type",
                           "vendor", "tags", "status"],
            "custom_fields": [],
            "metafields": [],
            "computed_fields": [],
            "relationships": ["variants"]
        },
        "customer": {
            "native_fields": ["id", "email", "first_name", "last_name",
                           "phone", "tags", "created_at", "updated_at"],
            "custom_fields": [],
            "metafields": [],
            "computed_fields": [],
            "relationships": ["orders"]
        }
    }

    # Populate computed fields from active rules
    try:
        result = await db.execute(
            select(FieldTransformRule).where(FieldTransformRule.is_active == True)
        )
        rules = result.scalars().all()
        for rule in rules:
            entity = rule.output_entity
            if entity in schema:
                schema[entity]["computed_fields"].append({
                    "key": rule.output_field_key,
                    "label": rule.output_field_label,
                    "type": rule.output_field_type
                })
    except Exception:
        pass

    return JSONResponse(
        content={"entities": schema},
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "*"
        }
    )

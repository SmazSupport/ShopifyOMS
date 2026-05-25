"""
/settings/fields  — manage which Shopify fields are enabled per entity type
/settings/columns — per-user column order for table views
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from pydantic import BaseModel
from typing import Optional
from app.database import get_db
from app.utils.auth import get_current_user
from app.models.settings import FieldVisibilitySetting, UserColumnPref
from app.models.shop import Shop

router = APIRouter(prefix="/settings", tags=["settings"])

# ─────────────────────────────────────────────────────────────────
# Known Shopify fields per entity — used for seeding / reference
# ─────────────────────────────────────────────────────────────────

SHOPIFY_FIELDS: dict[str, list[dict]] = {
    "order": [
        # Identifiers
        {"key": "shopify_order_id", "label": "Shopify Order ID", "category": "Identifiers"},
        {"key": "admin_graphql_api_id", "label": "GraphQL API ID", "category": "Identifiers"},
        {"key": "order_number", "label": "Order Number", "category": "Identifiers"},
        {"key": "confirmation_number", "label": "Confirmation Number", "category": "Identifiers"},
        {"key": "cart_token", "label": "Cart Token", "category": "Identifiers"},
        {"key": "checkout_token", "label": "Checkout Token", "category": "Identifiers"},
        {"key": "order_status_url", "label": "Order Status URL", "category": "Identifiers"},
        # Status
        {"key": "status", "label": "Status", "category": "Status"},
        {"key": "fulfillment_status", "label": "Fulfillment Status", "category": "Status"},
        {"key": "financial_status", "label": "Financial Status", "category": "Status"},
        {"key": "cancel_reason", "label": "Cancel Reason", "category": "Status"},
        {"key": "cancelled_at", "label": "Cancelled At", "category": "Status"},
        {"key": "closed_at", "label": "Closed At", "category": "Status"},
        {"key": "processed_at", "label": "Processed At", "category": "Status"},
        {"key": "confirmed", "label": "Confirmed", "category": "Status"},
        {"key": "test", "label": "Test Order", "category": "Status"},
        # Financials
        {"key": "total_price", "label": "Total Price", "category": "Financials"},
        {"key": "subtotal_price", "label": "Subtotal", "category": "Financials"},
        {"key": "total_tax", "label": "Total Tax", "category": "Financials"},
        {"key": "total_discounts", "label": "Total Discounts", "category": "Financials"},
        {"key": "total_line_items_price", "label": "Total Line Items Price", "category": "Financials"},
        {"key": "total_outstanding", "label": "Total Outstanding", "category": "Financials"},
        {"key": "total_tip_received", "label": "Total Tip Received", "category": "Financials"},
        {"key": "total_weight", "label": "Total Weight (g)", "category": "Financials"},
        {"key": "taxes_included", "label": "Taxes Included", "category": "Financials"},
        {"key": "currency", "label": "Currency", "category": "Financials"},
        {"key": "presentment_currency", "label": "Presentment Currency", "category": "Financials"},
        # Payment
        {"key": "payment_gateway", "label": "Payment Gateway", "category": "Payment"},
        {"key": "payment_gateway_names", "label": "Payment Gateway Names", "category": "Payment"},
        {"key": "processing_method", "label": "Processing Method", "category": "Payment"},
        # Customer
        {"key": "email", "label": "Email", "category": "Customer"},
        {"key": "phone", "label": "Phone", "category": "Customer"},
        {"key": "customer_locale", "label": "Customer Locale", "category": "Customer"},
        {"key": "buyer_accepts_marketing", "label": "Buyer Accepts Marketing", "category": "Customer"},
        # Address
        {"key": "shipping_address", "label": "Shipping Address", "category": "Address"},
        {"key": "billing_address", "label": "Billing Address", "category": "Address"},
        # Shipping
        {"key": "shipping_lines", "label": "Shipping Lines", "category": "Shipping"},
        # Discounts
        {"key": "discount_codes", "label": "Discount Codes", "category": "Discounts"},
        {"key": "discount_applications", "label": "Discount Applications", "category": "Discounts"},
        # Metadata
        {"key": "tags", "label": "Tags", "category": "Metadata"},
        {"key": "note", "label": "Note", "category": "Metadata"},
        {"key": "note_attributes", "label": "Note Attributes", "category": "Metadata"},
        {"key": "source_name", "label": "Source Name", "category": "Metadata"},
        {"key": "referring_site", "label": "Referring Site", "category": "Metadata"},
        {"key": "landing_site", "label": "Landing Site", "category": "Metadata"},
        {"key": "po_number", "label": "PO Number", "category": "Metadata"},
        {"key": "app_id", "label": "App ID", "category": "Metadata"},
        {"key": "browser_ip", "label": "Browser IP", "category": "Metadata"},
        {"key": "client_details", "label": "Client Details", "category": "Metadata"},
        {"key": "risk_level", "label": "Risk Level", "category": "Metadata"},
        {"key": "location_id", "label": "Location ID", "category": "Metadata"},
    ],
    "line_item": [
        {"key": "shopify_line_item_id", "label": "Shopify Line Item ID", "category": "Identifiers"},
        {"key": "shopify_product_id", "label": "Shopify Product ID", "category": "Identifiers"},
        {"key": "shopify_variant_id", "label": "Shopify Variant ID", "category": "Identifiers"},
        {"key": "admin_graphql_api_id", "label": "GraphQL API ID", "category": "Identifiers"},
        {"key": "sku", "label": "SKU", "category": "Product"},
        {"key": "title", "label": "Title", "category": "Product"},
        {"key": "name", "label": "Name", "category": "Product"},
        {"key": "product_title", "label": "Product Title", "category": "Product"},
        {"key": "variant_title", "label": "Variant Title", "category": "Product"},
        {"key": "vendor", "label": "Vendor", "category": "Product"},
        {"key": "product_type", "label": "Product Type", "category": "Product"},
        {"key": "quantity", "label": "Quantity", "category": "Quantity & Price"},
        {"key": "fulfillable_quantity", "label": "Fulfillable Quantity", "category": "Quantity & Price"},
        {"key": "price", "label": "Price", "category": "Quantity & Price"},
        {"key": "compare_at_price", "label": "Compare At Price", "category": "Quantity & Price"},
        {"key": "total_discount", "label": "Total Discount", "category": "Quantity & Price"},
        {"key": "pre_tax_price", "label": "Pre-Tax Price", "category": "Quantity & Price"},
        {"key": "grams", "label": "Weight (g)", "category": "Physical"},
        {"key": "fulfillment_service", "label": "Fulfillment Service", "category": "Fulfillment"},
        {"key": "fulfillment_status", "label": "Fulfillment Status", "category": "Fulfillment"},
        {"key": "variant_inventory_management", "label": "Inventory Management", "category": "Fulfillment"},
        {"key": "requires_shipping", "label": "Requires Shipping", "category": "Flags"},
        {"key": "taxable", "label": "Taxable", "category": "Flags"},
        {"key": "gift_card", "label": "Gift Card", "category": "Flags"},
        {"key": "tax_lines", "label": "Tax Lines", "category": "Tax & Discounts"},
        {"key": "discount_allocations", "label": "Discount Allocations", "category": "Tax & Discounts"},
        {"key": "properties", "label": "Properties / Attributes", "category": "Metadata"},
    ],
    "product": [
        {"key": "shopify_product_id", "label": "Shopify Product ID", "category": "Identifiers"},
        {"key": "admin_graphql_api_id", "label": "GraphQL API ID", "category": "Identifiers"},
        {"key": "title", "label": "Title", "category": "Core"},
        {"key": "handle", "label": "Handle", "category": "Core"},
        {"key": "product_type", "label": "Product Type", "category": "Core"},
        {"key": "vendor", "label": "Vendor", "category": "Core"},
        {"key": "status", "label": "Status", "category": "Core"},
        {"key": "tags", "label": "Tags", "category": "Core"},
        {"key": "body_html", "label": "Description (HTML)", "category": "Content"},
        {"key": "template_suffix", "label": "Template Suffix", "category": "Content"},
        {"key": "images", "label": "Images", "category": "Media"},
        {"key": "options", "label": "Options", "category": "Variants"},
        {"key": "published_at", "label": "Published At", "category": "Dates"},
        {"key": "published_scope", "label": "Published Scope", "category": "Dates"},
    ],
    "variant": [
        {"key": "shopify_variant_id", "label": "Shopify Variant ID", "category": "Identifiers"},
        {"key": "shopify_inventory_item_id", "label": "Inventory Item ID", "category": "Identifiers"},
        {"key": "admin_graphql_api_id", "label": "GraphQL API ID", "category": "Identifiers"},
        {"key": "sku", "label": "SKU", "category": "Core"},
        {"key": "barcode", "label": "Barcode", "category": "Core"},
        {"key": "title", "label": "Title", "category": "Core"},
        {"key": "position", "label": "Position", "category": "Core"},
        {"key": "option1", "label": "Option 1", "category": "Options"},
        {"key": "option2", "label": "Option 2", "category": "Options"},
        {"key": "option3", "label": "Option 3", "category": "Options"},
        {"key": "price", "label": "Price", "category": "Pricing"},
        {"key": "compare_at_price", "label": "Compare At Price", "category": "Pricing"},
        {"key": "grams", "label": "Weight (g)", "category": "Physical"},
        {"key": "weight", "label": "Weight", "category": "Physical"},
        {"key": "weight_unit", "label": "Weight Unit", "category": "Physical"},
        {"key": "inventory_quantity", "label": "Inventory Quantity", "category": "Inventory"},
        {"key": "inventory_management", "label": "Inventory Management", "category": "Inventory"},
        {"key": "inventory_policy", "label": "Inventory Policy", "category": "Inventory"},
        {"key": "fulfillment_service", "label": "Fulfillment Service", "category": "Fulfillment"},
        {"key": "requires_shipping", "label": "Requires Shipping", "category": "Flags"},
        {"key": "taxable", "label": "Taxable", "category": "Flags"},
        {"key": "tax_code", "label": "Tax Code", "category": "Flags"},
        {"key": "image_id", "label": "Image ID", "category": "Media"},
    ],
    "customer": [
        {"key": "shopify_customer_id", "label": "Shopify Customer ID", "category": "Identifiers"},
        {"key": "admin_graphql_api_id", "label": "GraphQL API ID", "category": "Identifiers"},
        {"key": "email", "label": "Email", "category": "Identity"},
        {"key": "first_name", "label": "First Name", "category": "Identity"},
        {"key": "last_name", "label": "Last Name", "category": "Identity"},
        {"key": "phone", "label": "Phone", "category": "Identity"},
        {"key": "currency", "label": "Currency", "category": "Identity"},
        {"key": "accepts_marketing", "label": "Accepts Marketing", "category": "Marketing"},
        {"key": "marketing_opt_in_level", "label": "Marketing Opt-In Level", "category": "Marketing"},
        {"key": "email_marketing_consent", "label": "Email Marketing Consent", "category": "Marketing"},
        {"key": "sms_marketing_consent", "label": "SMS Marketing Consent", "category": "Marketing"},
        {"key": "state", "label": "Account State", "category": "Account"},
        {"key": "verified_email", "label": "Verified Email", "category": "Account"},
        {"key": "tax_exempt", "label": "Tax Exempt", "category": "Account"},
        {"key": "tax_exemptions", "label": "Tax Exemptions", "category": "Account"},
        {"key": "orders_count", "label": "Orders Count", "category": "History"},
        {"key": "total_spent", "label": "Total Spent", "category": "History"},
        {"key": "last_order_id", "label": "Last Order ID", "category": "History"},
        {"key": "last_order_name", "label": "Last Order Name", "category": "History"},
        {"key": "note", "label": "Note", "category": "Notes"},
        {"key": "tags", "label": "Tags", "category": "Notes"},
        {"key": "default_address", "label": "Default Address", "category": "Address"},
        {"key": "shopify_created_at", "label": "Shopify Created At", "category": "Dates"},
        {"key": "shopify_updated_at", "label": "Shopify Updated At", "category": "Dates"},
    ],
}

# Default enabled fields — the ones you almost always want
DEFAULT_ENABLED = {
    "order": {"order_number", "status", "fulfillment_status", "financial_status", "total_price",
              "currency", "email", "shipping_address", "tags", "processed_at", "payment_gateway",
              "discount_codes", "note", "source_name"},
    "line_item": {"sku", "title", "product_title", "variant_title", "quantity", "price",
                  "fulfillment_status", "requires_shipping", "properties"},
    "product": {"title", "handle", "product_type", "vendor", "status", "tags", "published_at"},
    "variant": {"sku", "barcode", "title", "price", "inventory_quantity", "weight", "weight_unit",
                "requires_shipping", "option1", "option2", "option3"},
    "customer": {"email", "first_name", "last_name", "phone", "orders_count", "total_spent",
                 "accepts_marketing", "tags", "default_address", "state"},
}


async def get_shop(db: AsyncSession) -> Shop:
    result = await db.execute(select(Shop).limit(1))
    shop = result.scalar_one_or_none()
    if not shop:
        raise HTTPException(status_code=404, detail="No shop configured")
    return shop


# ─────────────────────────────────────────────────────────────────
# Seed helper
# ─────────────────────────────────────────────────────────────────

async def seed_field_visibility(db: AsyncSession, shop_id: str):
    """Insert all known fields as visibility rows if they don't exist yet."""
    for entity_type, fields in SHOPIFY_FIELDS.items():
        for i, f in enumerate(fields):
            existing = await db.execute(
                select(FieldVisibilitySetting).where(
                    FieldVisibilitySetting.shop_id == shop_id,
                    FieldVisibilitySetting.entity_type == entity_type,
                    FieldVisibilitySetting.field_key == f["key"],
                )
            )
            if not existing.scalar_one_or_none():
                enabled = f["key"] in DEFAULT_ENABLED.get(entity_type, set())
                db.add(FieldVisibilitySetting(
                    shop_id=shop_id,
                    entity_type=entity_type,
                    field_key=f["key"],
                    field_label=f["label"],
                    category=f.get("category"),
                    is_enabled=enabled,
                    display_order=i,
                    is_system=True,
                ))
    await db.commit()


# ─────────────────────────────────────────────────────────────────
# Schemas
# ─────────────────────────────────────────────────────────────────

class FieldVisibilityOut(BaseModel):
    id: str
    entity_type: str
    field_key: str
    field_label: Optional[str]
    is_enabled: bool
    display_order: int
    category: Optional[str]
    is_system: bool

    class Config:
        from_attributes = True


class FieldVisibilityUpdate(BaseModel):
    field_key: str
    is_enabled: bool
    display_order: Optional[int] = None


class ColumnPrefOut(BaseModel):
    entity_type: str
    column_order: list

    class Config:
        from_attributes = True


class ColumnPrefIn(BaseModel):
    entity_type: str
    column_order: list


# ─────────────────────────────────────────────────────────────────
# Field visibility endpoints
# ─────────────────────────────────────────────────────────────────

@router.get("/fields", response_model=list[FieldVisibilityOut])
async def get_field_settings(
    entity_type: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    shop = await get_shop(db)
    await seed_field_visibility(db, shop.id)
    q = select(FieldVisibilitySetting).where(FieldVisibilitySetting.shop_id == shop.id)
    if entity_type:
        q = q.where(FieldVisibilitySetting.entity_type == entity_type)
    q = q.order_by(FieldVisibilitySetting.entity_type, FieldVisibilitySetting.display_order)
    result = await db.execute(q)
    return result.scalars().all()


@router.put("/fields")
async def update_field_settings(
    updates: list[FieldVisibilityUpdate],
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    shop = await get_shop(db)
    for update in updates:
        result = await db.execute(
            select(FieldVisibilitySetting).where(
                FieldVisibilitySetting.shop_id == shop.id,
                FieldVisibilitySetting.field_key == update.field_key,
            )
        )
        row = result.scalar_one_or_none()
        if row:
            row.is_enabled = update.is_enabled
            if update.display_order is not None:
                row.display_order = update.display_order
    await db.commit()
    return {"updated": len(updates)}


@router.get("/fields/catalog")
async def get_field_catalog(_=Depends(get_current_user)):
    """Return the full catalog of known Shopify fields — no DB needed."""
    return SHOPIFY_FIELDS


# ─────────────────────────────────────────────────────────────────
# Column preference endpoints
# ─────────────────────────────────────────────────────────────────

@router.get("/columns/{entity_type}", response_model=ColumnPrefOut)
async def get_column_prefs(
    entity_type: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    result = await db.execute(
        select(UserColumnPref).where(
            UserColumnPref.user_id == current_user.id,
            UserColumnPref.entity_type == entity_type,
        )
    )
    pref = result.scalar_one_or_none()
    if not pref:
        return {"entity_type": entity_type, "column_order": []}
    return pref


@router.put("/columns", response_model=ColumnPrefOut)
async def save_column_prefs(
    data: ColumnPrefIn,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    result = await db.execute(
        select(UserColumnPref).where(
            UserColumnPref.user_id == current_user.id,
            UserColumnPref.entity_type == data.entity_type,
        )
    )
    pref = result.scalar_one_or_none()
    if pref:
        pref.column_order = data.column_order
    else:
        pref = UserColumnPref(
            user_id=current_user.id,
            entity_type=data.entity_type,
            column_order=data.column_order,
        )
        db.add(pref)
    await db.commit()
    await db.refresh(pref)
    return pref

"""
Layer 1 extension: Shopify mirror — fulfillments, customer_addresses
Layer 2: OMS rule/config tables
Layer 3: OMS fulfillment decision tables
Layer 4: Warehouse execution tables
Layer 5: Sync/logging tables
"""
from sqlalchemy import String, ForeignKey, Boolean, Numeric, Integer, JSON, Text, DateTime, Index, UniqueConstraint, Any
from sqlalchemy.orm import mapped_column, Mapped, relationship
from app.database import Base
from app.models.base import TimestampMixin, gen_uuid


# ─────────────────────────────────────────────────────────────────
# LAYER 1 EXTENSIONS — Shopify Mirror
# ─────────────────────────────────────────────────────────────────

class CustomerAddress(Base, TimestampMixin):
    """Shopify mirror: customer addresses."""
    __tablename__ = "customer_addresses"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    customer_id: Mapped[str] = mapped_column(String, ForeignKey("customers.id"), nullable=False, index=True)
    shopify_address_id: Mapped[str | None] = mapped_column(String, nullable=True)
    address1: Mapped[str | None] = mapped_column(String, nullable=True)
    address2: Mapped[str | None] = mapped_column(String, nullable=True)
    city: Mapped[str | None] = mapped_column(String, nullable=True)
    province: Mapped[str | None] = mapped_column(String, nullable=True)
    province_code: Mapped[str | None] = mapped_column(String(10), nullable=True)
    zip: Mapped[str | None] = mapped_column(String(20), nullable=True)
    country: Mapped[str | None] = mapped_column(String, nullable=True)
    country_code: Mapped[str | None] = mapped_column(String(10), nullable=True)
    phone: Mapped[str | None] = mapped_column(String, nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)

    customer: Mapped["Customer"] = relationship("Customer")  # type: ignore[name-defined]


class ShopifyFulfillment(Base, TimestampMixin):
    """Shopify mirror: fulfillments (what Shopify has actually shipped)."""
    __tablename__ = "shopify_fulfillments"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    order_id: Mapped[str] = mapped_column(String, ForeignKey("orders.id"), nullable=False, index=True)
    shopify_fulfillment_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    status: Mapped[str | None] = mapped_column(String, nullable=True)
    tracking_company: Mapped[str | None] = mapped_column(String, nullable=True)
    tracking_number: Mapped[str | None] = mapped_column(String, nullable=True)
    tracking_url: Mapped[str | None] = mapped_column(String, nullable=True)
    shipped_at: Mapped[str | None] = mapped_column(String, nullable=True)
    line_item_ids: Mapped[list | None] = mapped_column(JSON, nullable=True)

    order: Mapped["Order"] = relationship("Order")  # type: ignore[name-defined]


class WebhookLog(Base, TimestampMixin):
    """Layer 5: Log every inbound Shopify webhook for replay/debug."""
    __tablename__ = "webhook_logs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    shop_id: Mapped[str | None] = mapped_column(String, ForeignKey("shops.id"), nullable=True, index=True)
    shopify_order_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    event_type: Mapped[str] = mapped_column(String, nullable=False, index=True)
    webhook_id: Mapped[str | None] = mapped_column(String, nullable=True)
    received_at: Mapped[str] = mapped_column(String, nullable=False)
    processed_at: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String, default="pending", nullable=False, index=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    shop: Mapped["Shop"] = relationship("Shop")  # type: ignore[name-defined]


# ─────────────────────────────────────────────────────────────────
# LAYER 2 — OMS Rule / Config Tables
# ─────────────────────────────────────────────────────────────────

class SkuRule(Base, TimestampMixin):
    """Per-SKU shipping and processing rules."""
    __tablename__ = "sku_rules"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    shop_id: Mapped[str] = mapped_column(String, ForeignKey("shops.id"), nullable=False, index=True)
    sku: Mapped[str] = mapped_column(String, nullable=False, index=True)
    ships_alone: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    ships_alone_reason: Mapped[str | None] = mapped_column(String, nullable=True)
    is_preorder: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    preorder_release_date: Mapped[str | None] = mapped_column(String, nullable=True)
    allow_partial_ship: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    hold_reason: Mapped[str | None] = mapped_column(String, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    shop: Mapped["Shop"] = relationship("Shop")  # type: ignore[name-defined]


class MysteryRule(Base, TimestampMixin):
    """Mystery item substitution rules."""
    __tablename__ = "mystery_rules"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    shop_id: Mapped[str] = mapped_column(String, ForeignKey("shops.id"), nullable=False, index=True)
    mystery_sku: Mapped[str] = mapped_column(String, nullable=False, index=True)
    eligible_skus: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    selection_strategy: Mapped[str] = mapped_column(String, default="exclude_previously_shipped", nullable=False)
    fallback_sku: Mapped[str | None] = mapped_column(String, nullable=True)
    exclude_if_previously_received: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    shop: Mapped["Shop"] = relationship("Shop")  # type: ignore[name-defined]


class FieldTransformRule(Base, TimestampMixin):
    """
    Layer 2: No-code computed field rules.
    Defines how to derive a new OMS field from an existing source field.
    e.g. bin_number 'A5C' → bin_section = first alpha chars = 'A'
    transform_type: extract_pattern | split | formula | custom_js | if_then
    transform_config: JSON blob interpreted by the rule engine per transform_type
    """
    __tablename__ = "field_transform_rules"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    shop_id: Mapped[str] = mapped_column(String, ForeignKey("shops.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    source_entity: Mapped[str] = mapped_column(String, nullable=False, index=True)
    source_field: Mapped[str] = mapped_column(String, nullable=False)
    source_path: Mapped[list | None] = mapped_column(JSON, nullable=True)
    transform_type: Mapped[str] = mapped_column(String, nullable=False)
    transform_config: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    output_field_key: Mapped[str] = mapped_column(String, nullable=False, index=True)
    output_field_label: Mapped[str] = mapped_column(String, nullable=False)
    output_entity: Mapped[str] = mapped_column(String, nullable=False)
    output_field_type: Mapped[str] = mapped_column(String, default="string", server_default="string")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    run_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    depends_on: Mapped[list | None] = mapped_column(JSON, nullable=True, default=list)
    recalculation_mode: Mapped[str] = mapped_column(String, default="new_only", server_default="new_only")
    auto_recalc_on_source_change: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str | None] = mapped_column(String, nullable=True)

    shop: Mapped["Shop"] = relationship("Shop")  # type: ignore[name-defined]
    derived_values: Mapped[list["DerivedFieldValue"]] = relationship(
        "DerivedFieldValue", back_populates="rule", cascade="all, delete-orphan"
    )
    recalculation_jobs: Mapped[list["RecalculationJob"]] = relationship(
        "RecalculationJob", back_populates="rule", cascade="all, delete-orphan"
    )


class BundleRule(Base, TimestampMixin):
    """
    Layer 2: Bundle explosion rules.
    Defines that a parent SKU should be exploded into child SKUs when an order is ingested.
    child_skus: [{"sku": "CHILD-A", "quantity": 1}, ...]
    ships_together: if True, all children in one group. If False, each can ship independently.
    """
    __tablename__ = "bundle_rules"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    shop_id: Mapped[str] = mapped_column(String, ForeignKey("shops.id"), nullable=False, index=True)
    parent_sku: Mapped[str] = mapped_column(String, nullable=False, index=True)
    bundle_name: Mapped[str | None] = mapped_column(String, nullable=True)
    child_skus: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    ships_together: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    allow_partial_ship: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    notify_shopify_as_parent: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    shop: Mapped["Shop"] = relationship("Shop")  # type: ignore[name-defined]


class CustomerSkuHistory(Base, TimestampMixin):
    """Tracks which SKUs a customer has already received — used for mystery item selection."""
    __tablename__ = "customer_sku_history"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    shop_id: Mapped[str] = mapped_column(String, ForeignKey("shops.id"), nullable=False, index=True)
    customer_id: Mapped[str] = mapped_column(String, ForeignKey("customers.id"), nullable=False, index=True)
    sku: Mapped[str] = mapped_column(String, nullable=False, index=True)
    order_id: Mapped[str | None] = mapped_column(String, ForeignKey("orders.id"), nullable=True)
    received_at: Mapped[str | None] = mapped_column(String, nullable=True)

    shop: Mapped["Shop"] = relationship("Shop")  # type: ignore[name-defined]
    customer: Mapped["Customer"] = relationship("Customer")  # type: ignore[name-defined]
    order: Mapped["Order | None"] = relationship("Order")  # type: ignore[name-defined]


# ─────────────────────────────────────────────────────────────────
# LAYER 3 — OMS Fulfillment Decision Tables
# ─────────────────────────────────────────────────────────────────

class OmsOrder(Base, TimestampMixin):
    """OMS internal representation of an order — decoupled from Shopify state."""
    __tablename__ = "oms_orders"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    shop_id: Mapped[str] = mapped_column(String, ForeignKey("shops.id"), nullable=False, index=True)
    shopify_order_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    order_id: Mapped[str | None] = mapped_column(String, ForeignKey("orders.id"), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String, default="pending", nullable=False, index=True)
    customer_snapshot: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    shipping_address_snapshot: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    ingested_at: Mapped[str | None] = mapped_column(String, nullable=True)

    shop: Mapped["Shop"] = relationship("Shop")  # type: ignore[name-defined]
    order: Mapped["Order | None"] = relationship("Order")  # type: ignore[name-defined]
    fulfillment_groups: Mapped[list["FulfillmentGroup"]] = relationship(
        "FulfillmentGroup", back_populates="oms_order", cascade="all, delete-orphan"
    )


class FulfillmentGroup(Base, TimestampMixin):
    """A logical shipment group within an OMS order. One order → one or more groups."""
    __tablename__ = "fulfillment_groups"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    oms_order_id: Mapped[str] = mapped_column(String, ForeignKey("oms_orders.id"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String, default="pending", nullable=False, index=True)
    ship_after_date: Mapped[str | None] = mapped_column(String, nullable=True)
    hold_reason: Mapped[str | None] = mapped_column(String, nullable=True)
    warehouse: Mapped[str | None] = mapped_column(String, nullable=True)
    shipping_method: Mapped[str | None] = mapped_column(String, nullable=True)
    ships_alone: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    group_type: Mapped[str] = mapped_column(String, default="standard", nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    oms_order: Mapped["OmsOrder"] = relationship("OmsOrder", back_populates="fulfillment_groups")
    lines: Mapped[list["FulfillmentLine"]] = relationship(
        "FulfillmentLine", back_populates="group", cascade="all, delete-orphan"
    )
    holds: Mapped[list["Hold"]] = relationship(
        "Hold", back_populates="group", cascade="all, delete-orphan"
    )


class FulfillmentLine(Base, TimestampMixin):
    """One line in a fulfillment group. original_sku may differ from ship_sku (e.g. mystery swap)."""
    __tablename__ = "fulfillment_lines"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    group_id: Mapped[str] = mapped_column(String, ForeignKey("fulfillment_groups.id"), nullable=False, index=True)
    shopify_line_item_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    original_sku: Mapped[str | None] = mapped_column(String, nullable=True)
    ship_sku: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    quantity: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    status: Mapped[str] = mapped_column(String, default="pending", nullable=False, index=True)
    bin_location: Mapped[str | None] = mapped_column(String, nullable=True)
    source_reason: Mapped[str | None] = mapped_column(String, nullable=True)
    sku_snapshot: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    group: Mapped["FulfillmentGroup"] = relationship("FulfillmentGroup", back_populates="lines")


class Hold(Base, TimestampMixin):
    """A hold applied to a fulfillment group."""
    __tablename__ = "holds"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    group_id: Mapped[str] = mapped_column(String, ForeignKey("fulfillment_groups.id"), nullable=False, index=True)
    reason: Mapped[str] = mapped_column(String, nullable=False)
    release_date: Mapped[str | None] = mapped_column(String, nullable=True)
    released_at: Mapped[str | None] = mapped_column(String, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    group: Mapped["FulfillmentGroup"] = relationship("FulfillmentGroup", back_populates="holds")


# ─────────────────────────────────────────────────────────────────
# LAYER 4 — Warehouse Execution Tables
# ─────────────────────────────────────────────────────────────────

class DerivedFieldValue(Base, TimestampMixin):
    """
    Layer B — Stores computed derived field values for fast retrieval.
    Can be rebuilt from Layer A (raw Shopify data) + FieldTransformRules.
    """
    __tablename__ = "derived_field_values"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    shop_id: Mapped[str] = mapped_column(String, ForeignKey("shops.id"), nullable=False, index=True)
    rule_id: Mapped[str] = mapped_column(String, ForeignKey("field_transform_rules.id"), nullable=False, index=True)
    entity_type: Mapped[str] = mapped_column(String, nullable=False, index=True)
    entity_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    value: Mapped[Any] = mapped_column(JSON, nullable=True)
    computed_at: Mapped[str] = mapped_column(String, nullable=False)
    source_version: Mapped[str | None] = mapped_column(String, nullable=True)
    is_stale: Mapped[bool] = mapped_column(Boolean, default=False, index=True)

    shop: Mapped["Shop"] = relationship("Shop")  # type: ignore[name-defined]
    rule: Mapped["FieldTransformRule"] = relationship("FieldTransformRule", back_populates="derived_values")

    __table_args__ = (
        UniqueConstraint('rule_id', 'entity_type', 'entity_id', name='uix_derived_value'),
        Index('ix_derived_entity', 'entity_type', 'entity_id'),
        Index('ix_derived_stale', 'is_stale', 'rule_id'),
    )


class RecalculationJob(Base, TimestampMixin):
    """
    Tracks background recalculation work for derived fields.
    """
    __tablename__ = "recalculation_jobs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    shop_id: Mapped[str] = mapped_column(String, ForeignKey("shops.id"), nullable=False, index=True)
    trigger_type: Mapped[str] = mapped_column(String, nullable=False)
    rule_id: Mapped[str] = mapped_column(String, ForeignKey("field_transform_rules.id"), nullable=False, index=True)
    scope: Mapped[str] = mapped_column(String, nullable=False)
    specific_order_ids: Mapped[list | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String, default="pending", index=True)
    total_orders: Mapped[int | None] = mapped_column(Integer, nullable=True)
    processed_orders: Mapped[int | None] = mapped_column(Integer, nullable=True)
    failed_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    started_at: Mapped[str | None] = mapped_column(String, nullable=True)
    completed_at: Mapped[str | None] = mapped_column(String, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_details: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    triggered_by: Mapped[str | None] = mapped_column(String, nullable=True)

    shop: Mapped["Shop"] = relationship("Shop")  # type: ignore[name-defined]
    rule: Mapped["FieldTransformRule"] = relationship("FieldTransformRule", back_populates="recalculation_jobs")


class EntityRelationship(Base, TimestampMixin):
    """
    Defines navigable relationships between entities for path resolution.
    """
    __tablename__ = "entity_relationships"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    from_entity: Mapped[str] = mapped_column(String, nullable=False, index=True)
    to_entity: Mapped[str] = mapped_column(String, nullable=False, index=True)
    via_field: Mapped[str] = mapped_column(String, nullable=False)
    reverse_via: Mapped[str | None] = mapped_column(String, nullable=True)
    relationship_type: Mapped[str] = mapped_column(String, default="many_to_one")
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    is_system: Mapped[bool] = mapped_column(Boolean, default=True)


class SkuMaster(Base, TimestampMixin):
    """
    Snapshot of SKU data at order ingestion time.
    Decoupled from live Shopify — warehouse decisions never change due to Shopify edits.
    """
    __tablename__ = "sku_master"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    shop_id: Mapped[str] = mapped_column(String, ForeignKey("shops.id"), nullable=False, index=True)
    sku: Mapped[str] = mapped_column(String, nullable=False, index=True)
    title: Mapped[str | None] = mapped_column(String, nullable=True)
    barcode: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    weight: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)
    weight_unit: Mapped[str | None] = mapped_column(String(10), nullable=True)
    length: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)
    width: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)
    height: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)
    dimension_unit: Mapped[str | None] = mapped_column(String(10), nullable=True)
    product_type: Mapped[str | None] = mapped_column(String, nullable=True)
    vendor: Mapped[str | None] = mapped_column(String, nullable=True)
    tags: Mapped[list | None] = mapped_column(JSON, nullable=True)
    requires_shipping: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    bin_location: Mapped[str | None] = mapped_column(String, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    shop: Mapped["Shop"] = relationship("Shop")  # type: ignore[name-defined]


class BinLocation(Base, TimestampMixin):
    """Physical warehouse bin locations."""
    __tablename__ = "bin_locations"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    shop_id: Mapped[str] = mapped_column(String, ForeignKey("shops.id"), nullable=False, index=True)
    bin: Mapped[str] = mapped_column(String, nullable=False, index=True)
    zone: Mapped[str | None] = mapped_column(String, nullable=True)
    warehouse: Mapped[str | None] = mapped_column(String, nullable=True)
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    shop: Mapped["Shop"] = relationship("Shop")  # type: ignore[name-defined]


class Shipment(Base, TimestampMixin):
    """A physical shipment dispatched from the warehouse."""
    __tablename__ = "shipments"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    group_id: Mapped[str | None] = mapped_column(String, ForeignKey("fulfillment_groups.id"), nullable=True, index=True)
    shop_id: Mapped[str] = mapped_column(String, ForeignKey("shops.id"), nullable=False, index=True)
    carrier: Mapped[str | None] = mapped_column(String, nullable=True)
    service: Mapped[str | None] = mapped_column(String, nullable=True)
    tracking_number: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    tracking_url: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String, default="pending", nullable=False, index=True)
    shipped_at: Mapped[str | None] = mapped_column(String, nullable=True)
    delivered_at: Mapped[str | None] = mapped_column(String, nullable=True)
    label_url: Mapped[str | None] = mapped_column(String, nullable=True)
    weight_lbs: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    group: Mapped["FulfillmentGroup | None"] = relationship("FulfillmentGroup")  # type: ignore[name-defined]
    shop: Mapped["Shop"] = relationship("Shop")  # type: ignore[name-defined]
    packages: Mapped[list["Package"]] = relationship(
        "Package", back_populates="shipment", cascade="all, delete-orphan"
    )


class Package(Base, TimestampMixin):
    """Individual packages within a shipment."""
    __tablename__ = "packages"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    shipment_id: Mapped[str] = mapped_column(String, ForeignKey("shipments.id"), nullable=False, index=True)
    package_number: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    weight_lbs: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)
    length: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)
    width: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)
    height: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)
    contents: Mapped[list | None] = mapped_column(JSON, nullable=True)

    shipment: Mapped["Shipment"] = relationship("Shipment", back_populates="packages")

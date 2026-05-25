from sqlalchemy import String, ForeignKey, Numeric, Integer, Boolean, JSON, Text
from sqlalchemy.orm import mapped_column, Mapped, relationship
from app.database import Base
from app.models.base import TimestampMixin, gen_uuid


class LineItem(Base, TimestampMixin):
    __tablename__ = "line_items"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    order_id: Mapped[str] = mapped_column(String, ForeignKey("orders.id"), nullable=False, index=True)

    # Shopify identifiers
    shopify_line_item_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    admin_graphql_api_id: Mapped[str | None] = mapped_column(String, nullable=True)
    shopify_product_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    shopify_variant_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)

    # Product / variant info
    sku: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    product_title: Mapped[str | None] = mapped_column(String, nullable=True)
    variant_title: Mapped[str | None] = mapped_column(String, nullable=True)
    name: Mapped[str | None] = mapped_column(String, nullable=True)
    title: Mapped[str | None] = mapped_column(String, nullable=True)
    vendor: Mapped[str | None] = mapped_column(String, nullable=True)
    product_type: Mapped[str | None] = mapped_column(String, nullable=True)

    # Quantity & pricing
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    fulfillable_quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    price: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    compare_at_price: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    total_discount: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    pre_tax_price: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    price_set: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    total_discount_set: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # Weight
    grams: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Fulfillment
    fulfillment_service: Mapped[str | None] = mapped_column(String, nullable=True)
    fulfillment_status: Mapped[str | None] = mapped_column(String, nullable=True)
    variant_inventory_management: Mapped[str | None] = mapped_column(String, nullable=True)

    # Flags
    requires_shipping: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    taxable: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    gift_card: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)

    # Tax & discount detail
    tax_lines: Mapped[list | None] = mapped_column(JSON, nullable=True)
    discount_allocations: Mapped[list | None] = mapped_column(JSON, nullable=True)
    duties: Mapped[list | None] = mapped_column(JSON, nullable=True)

    # Custom attributes / properties (e.g. gift message, personalisation)
    properties: Mapped[list | None] = mapped_column(JSON, nullable=True)

    # OMS FK
    variant_id: Mapped[str | None] = mapped_column(String, ForeignKey("variants.id"), nullable=True, index=True)

    order: Mapped["Order"] = relationship("Order", back_populates="line_items")
    variant: Mapped["Variant | None"] = relationship("Variant", back_populates="line_items")

from sqlalchemy import String, ForeignKey, Boolean, JSON, Text, Integer, Numeric
from sqlalchemy.orm import mapped_column, Mapped, relationship
from app.database import Base
from app.models.base import TimestampMixin, gen_uuid


class Product(Base, TimestampMixin):
    __tablename__ = "products"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    shop_id: Mapped[str] = mapped_column(String, ForeignKey("shops.id"), nullable=False, index=True)

    # Shopify identifiers
    shopify_product_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    admin_graphql_api_id: Mapped[str | None] = mapped_column(String, nullable=True)

    # Core fields
    title: Mapped[str] = mapped_column(String, nullable=False)
    handle: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    product_type: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    vendor: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    status: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    tags: Mapped[list | None] = mapped_column(JSON, nullable=True)
    body_html: Mapped[str | None] = mapped_column(Text, nullable=True)
    template_suffix: Mapped[str | None] = mapped_column(String, nullable=True)

    # Images & options (JSON arrays)
    images: Mapped[list | None] = mapped_column(JSON, nullable=True)
    image: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    options: Mapped[list | None] = mapped_column(JSON, nullable=True)

    # Dates
    published_at: Mapped[str | None] = mapped_column(String, nullable=True)
    published_scope: Mapped[str | None] = mapped_column(String, nullable=True)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    shop: Mapped["Shop"] = relationship("Shop", back_populates="products")
    variants: Mapped[list["Variant"]] = relationship("Variant", back_populates="product", cascade="all, delete-orphan")


class Variant(Base, TimestampMixin):
    __tablename__ = "variants"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    product_id: Mapped[str] = mapped_column(String, ForeignKey("products.id"), nullable=False, index=True)

    # Shopify identifiers
    shopify_variant_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    admin_graphql_api_id: Mapped[str | None] = mapped_column(String, nullable=True)
    shopify_inventory_item_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)

    # Core fields
    sku: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    barcode: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    title: Mapped[str | None] = mapped_column(String, nullable=True)
    position: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Options
    option1: Mapped[str | None] = mapped_column(String, nullable=True)
    option2: Mapped[str | None] = mapped_column(String, nullable=True)
    option3: Mapped[str | None] = mapped_column(String, nullable=True)

    # Pricing
    price: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    compare_at_price: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)

    # Weight
    grams: Mapped[int | None] = mapped_column(Integer, nullable=True)
    weight: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)
    weight_unit: Mapped[str | None] = mapped_column(String(10), nullable=True)

    # Inventory
    inventory_quantity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    old_inventory_quantity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    inventory_management: Mapped[str | None] = mapped_column(String, nullable=True)
    inventory_policy: Mapped[str | None] = mapped_column(String, nullable=True)

    # Fulfillment
    fulfillment_service: Mapped[str | None] = mapped_column(String, nullable=True)
    requires_shipping: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    taxable: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    tax_code: Mapped[str | None] = mapped_column(String, nullable=True)

    # Image
    image_id: Mapped[str | None] = mapped_column(String, nullable=True)
    image: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # Metafields (Shopify-style JSON storage)
    metafields: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # Dimensions (for shipping calculations)
    length: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)
    width: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)
    height: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)

    # Shipping unit multiplier (derived from dimensions)
    shipping_unit: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)

    product: Mapped["Product"] = relationship("Product", back_populates="variants")
    line_items: Mapped[list["LineItem"]] = relationship("LineItem", back_populates="variant")

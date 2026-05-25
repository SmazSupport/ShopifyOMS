from sqlalchemy import String, ForeignKey, Boolean
from sqlalchemy.orm import mapped_column, Mapped, relationship
from app.database import Base
from app.models.base import TimestampMixin, gen_uuid


class Product(Base, TimestampMixin):
    __tablename__ = "products"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    shop_id: Mapped[str] = mapped_column(String, ForeignKey("shops.id"), nullable=False, index=True)
    shopify_product_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    handle: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    product_type: Mapped[str | None] = mapped_column(String, nullable=True)
    vendor: Mapped[str | None] = mapped_column(String, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    shop: Mapped["Shop"] = relationship("Shop", back_populates="products")
    variants: Mapped[list["Variant"]] = relationship("Variant", back_populates="product", cascade="all, delete-orphan")


class Variant(Base, TimestampMixin):
    __tablename__ = "variants"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    product_id: Mapped[str] = mapped_column(String, ForeignKey("products.id"), nullable=False, index=True)
    shopify_variant_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    sku: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    title: Mapped[str | None] = mapped_column(String, nullable=True)
    price: Mapped[float | None] = mapped_column(String, nullable=True)
    inventory_quantity: Mapped[int | None] = mapped_column(String, nullable=True)

    product: Mapped["Product"] = relationship("Product", back_populates="variants")
    line_items: Mapped[list["LineItem"]] = relationship("LineItem", back_populates="variant")

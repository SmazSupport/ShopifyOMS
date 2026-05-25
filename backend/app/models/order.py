from sqlalchemy import String, ForeignKey, Numeric, JSON, Integer
from sqlalchemy.orm import mapped_column, Mapped, relationship
from app.database import Base
from app.models.base import TimestampMixin, gen_uuid


class Order(Base, TimestampMixin):
    __tablename__ = "orders"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    shop_id: Mapped[str] = mapped_column(String, ForeignKey("shops.id"), nullable=False, index=True)
    customer_id: Mapped[str | None] = mapped_column(String, ForeignKey("customers.id"), nullable=True, index=True)
    shopify_order_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    order_number: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    status: Mapped[str] = mapped_column(String, default="open", nullable=False, index=True)
    fulfillment_status: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    financial_status: Mapped[str | None] = mapped_column(String, nullable=True)
    total_price: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    tags: Mapped[list | None] = mapped_column(JSON, nullable=True)
    shipping_address: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    note: Mapped[str | None] = mapped_column(String, nullable=True)
    item_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    shop: Mapped["Shop"] = relationship("Shop", back_populates="orders")
    customer: Mapped["Customer | None"] = relationship("Customer", back_populates="orders")
    line_items: Mapped[list["LineItem"]] = relationship("LineItem", back_populates="order", cascade="all, delete-orphan")

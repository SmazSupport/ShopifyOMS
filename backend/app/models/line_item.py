from sqlalchemy import String, ForeignKey, Numeric, Integer
from sqlalchemy.orm import mapped_column, Mapped, relationship
from app.database import Base
from app.models.base import TimestampMixin, gen_uuid


class LineItem(Base, TimestampMixin):
    __tablename__ = "line_items"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    order_id: Mapped[str] = mapped_column(String, ForeignKey("orders.id"), nullable=False, index=True)
    shopify_line_item_id: Mapped[str | None] = mapped_column(String, nullable=True)
    sku: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    product_title: Mapped[str | None] = mapped_column(String, nullable=True)
    variant_title: Mapped[str | None] = mapped_column(String, nullable=True)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    price: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    variant_id: Mapped[str | None] = mapped_column(String, ForeignKey("variants.id"), nullable=True, index=True)

    order: Mapped["Order"] = relationship("Order", back_populates="line_items")
    variant: Mapped["Variant | None"] = relationship("Variant", back_populates="line_items")

from sqlalchemy import String, Boolean
from sqlalchemy.orm import mapped_column, Mapped, relationship
from app.database import Base
from app.models.base import TimestampMixin, gen_uuid


class Shop(Base, TimestampMixin):
    __tablename__ = "shops"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    tenant_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    shopify_domain: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    access_token: Mapped[str | None] = mapped_column(String, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    orders: Mapped[list["Order"]] = relationship("Order", back_populates="shop")
    products: Mapped[list["Product"]] = relationship("Product", back_populates="shop")
    customers: Mapped[list["Customer"]] = relationship("Customer", back_populates="shop")

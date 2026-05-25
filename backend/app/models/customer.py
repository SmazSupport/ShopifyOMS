from sqlalchemy import String, ForeignKey, Boolean, Numeric, Integer, JSON, Text
from sqlalchemy.orm import mapped_column, Mapped, relationship
from app.database import Base
from app.models.base import TimestampMixin, gen_uuid


class Customer(Base, TimestampMixin):
    __tablename__ = "customers"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    shop_id: Mapped[str] = mapped_column(String, ForeignKey("shops.id"), nullable=False, index=True)

    # Shopify identifiers
    shopify_customer_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    admin_graphql_api_id: Mapped[str | None] = mapped_column(String, nullable=True)

    # Core identity
    email: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    first_name: Mapped[str | None] = mapped_column(String, nullable=True)
    last_name: Mapped[str | None] = mapped_column(String, nullable=True)
    phone: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    currency: Mapped[str | None] = mapped_column(String(10), nullable=True)

    # Marketing & consent
    accepts_marketing: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    accepts_marketing_updated_at: Mapped[str | None] = mapped_column(String, nullable=True)
    marketing_opt_in_level: Mapped[str | None] = mapped_column(String, nullable=True)
    email_marketing_consent: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    sms_marketing_consent: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # Account state
    state: Mapped[str | None] = mapped_column(String, nullable=True)
    verified_email: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    tax_exempt: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    tax_exemptions: Mapped[list | None] = mapped_column(JSON, nullable=True)

    # Order history summary
    orders_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    total_spent: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    last_order_id: Mapped[str | None] = mapped_column(String, nullable=True)
    last_order_name: Mapped[str | None] = mapped_column(String, nullable=True)

    # Notes / tags
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    tags: Mapped[list | None] = mapped_column(JSON, nullable=True)

    # Addresses (default snapshot — full list in customer_addresses)
    default_address: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # Shopify dates
    shopify_created_at: Mapped[str | None] = mapped_column(String, nullable=True)
    shopify_updated_at: Mapped[str | None] = mapped_column(String, nullable=True)

    shop: Mapped["Shop"] = relationship("Shop", back_populates="customers")
    orders: Mapped[list["Order"]] = relationship("Order", back_populates="customer")

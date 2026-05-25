from sqlalchemy import String, ForeignKey, Numeric, JSON, Integer, Boolean, Text
from sqlalchemy.orm import mapped_column, Mapped, relationship
from app.database import Base
from app.models.base import TimestampMixin, gen_uuid


class Order(Base, TimestampMixin):
    __tablename__ = "orders"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    shop_id: Mapped[str] = mapped_column(String, ForeignKey("shops.id"), nullable=False, index=True)
    customer_id: Mapped[str | None] = mapped_column(String, ForeignKey("customers.id"), nullable=True, index=True)

    # Shopify identifiers
    shopify_order_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    admin_graphql_api_id: Mapped[str | None] = mapped_column(String, nullable=True)
    order_number: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    order_status_url: Mapped[str | None] = mapped_column(String, nullable=True)
    confirmation_number: Mapped[str | None] = mapped_column(String, nullable=True)
    cart_token: Mapped[str | None] = mapped_column(String, nullable=True)
    checkout_token: Mapped[str | None] = mapped_column(String, nullable=True)
    checkout_id: Mapped[str | None] = mapped_column(String, nullable=True)

    # Status fields
    status: Mapped[str] = mapped_column(String, default="open", nullable=False, index=True)
    fulfillment_status: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    financial_status: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    cancel_reason: Mapped[str | None] = mapped_column(String, nullable=True)
    cancelled_at: Mapped[str | None] = mapped_column(String, nullable=True)
    closed_at: Mapped[str | None] = mapped_column(String, nullable=True)
    processed_at: Mapped[str | None] = mapped_column(String, nullable=True)

    # Financials
    currency: Mapped[str | None] = mapped_column(String(10), nullable=True)
    presentment_currency: Mapped[str | None] = mapped_column(String(10), nullable=True)
    total_price: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    subtotal_price: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    total_tax: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    total_discounts: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    total_line_items_price: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    total_outstanding: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    total_tip_received: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    total_weight: Mapped[int | None] = mapped_column(Integer, nullable=True)
    taxes_included: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    confirmed: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    test: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Payment
    payment_gateway: Mapped[str | None] = mapped_column(String, nullable=True)
    payment_gateway_names: Mapped[list | None] = mapped_column(JSON, nullable=True)
    processing_method: Mapped[str | None] = mapped_column(String, nullable=True)

    # Customer / contact
    email: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    phone: Mapped[str | None] = mapped_column(String, nullable=True)
    customer_locale: Mapped[str | None] = mapped_column(String, nullable=True)
    buyer_accepts_marketing: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Addresses (JSON snapshot — normalized in customer_addresses)
    shipping_address: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    billing_address: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # Shipping
    shipping_lines: Mapped[list | None] = mapped_column(JSON, nullable=True)

    # Discounts
    discount_codes: Mapped[list | None] = mapped_column(JSON, nullable=True)
    discount_applications: Mapped[list | None] = mapped_column(JSON, nullable=True)

    # Metadata
    tags: Mapped[list | None] = mapped_column(JSON, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    note_attributes: Mapped[list | None] = mapped_column(JSON, nullable=True)
    source_name: Mapped[str | None] = mapped_column(String, nullable=True)
    source_identifier: Mapped[str | None] = mapped_column(String, nullable=True)
    source_url: Mapped[str | None] = mapped_column(String, nullable=True)
    referring_site: Mapped[str | None] = mapped_column(String, nullable=True)
    landing_site: Mapped[str | None] = mapped_column(String, nullable=True)
    po_number: Mapped[str | None] = mapped_column(String, nullable=True)
    app_id: Mapped[str | None] = mapped_column(String, nullable=True)
    browser_ip: Mapped[str | None] = mapped_column(String, nullable=True)
    client_details: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # Risk / fraud
    risk_level: Mapped[str | None] = mapped_column(String, nullable=True)

    # Fulfillment routing
    location_id: Mapped[str | None] = mapped_column(String, nullable=True)
    item_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    shop: Mapped["Shop"] = relationship("Shop", back_populates="orders")
    customer: Mapped["Customer | None"] = relationship("Customer", back_populates="orders")
    line_items: Mapped[list["LineItem"]] = relationship("LineItem", back_populates="order", cascade="all, delete-orphan")

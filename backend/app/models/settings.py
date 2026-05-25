"""
User/shop-level UI settings:
- field_visibility_settings: which Shopify fields to ingest/display per entity type (shop-level)
- user_column_prefs: per-user column order for table views
"""
from sqlalchemy import String, ForeignKey, Boolean, Integer, JSON, UniqueConstraint
from sqlalchemy.orm import mapped_column, Mapped, relationship
from app.database import Base
from app.models.base import TimestampMixin, gen_uuid


class FieldVisibilitySetting(Base, TimestampMixin):
    """
    Shop-level toggle: which fields are enabled for ingest + display per entity type.
    Seeded with all known Shopify fields on first setup.
    """
    __tablename__ = "field_visibility_settings"
    __table_args__ = (
        UniqueConstraint("shop_id", "entity_type", "field_key", name="uq_field_visibility"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    shop_id: Mapped[str] = mapped_column(String, ForeignKey("shops.id"), nullable=False, index=True)
    entity_type: Mapped[str] = mapped_column(String, nullable=False, index=True)
    field_key: Mapped[str] = mapped_column(String, nullable=False, index=True)
    field_label: Mapped[str | None] = mapped_column(String, nullable=True)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    display_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    category: Mapped[str | None] = mapped_column(String, nullable=True)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    shop: Mapped["Shop"] = relationship("Shop")  # type: ignore[name-defined]


class UserColumnPref(Base, TimestampMixin):
    """
    Per-user saved column configuration for a given table view.
    Stores the ordered list of visible column keys.
    """
    __tablename__ = "user_column_prefs"
    __table_args__ = (
        UniqueConstraint("user_id", "entity_type", name="uq_user_column_pref"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False, index=True)
    entity_type: Mapped[str] = mapped_column(String, nullable=False, index=True)
    column_order: Mapped[list] = mapped_column(JSON, nullable=False, default=list)

    user: Mapped["User"] = relationship("User")  # type: ignore[name-defined]

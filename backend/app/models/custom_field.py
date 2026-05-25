from sqlalchemy import String, ForeignKey, JSON
from sqlalchemy.orm import mapped_column, Mapped, relationship
from app.database import Base
from app.models.base import TimestampMixin, gen_uuid


ENTITY_TYPES = ("product", "variant", "order", "line_item", "customer")
FIELD_TYPES = ("text", "number", "boolean", "date", "json")


class CustomFieldDefinition(Base, TimestampMixin):
    """App-level custom field definition for any entity type."""
    __tablename__ = "custom_field_definitions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    shop_id: Mapped[str] = mapped_column(String, ForeignKey("shops.id"), nullable=False, index=True)
    entity_type: Mapped[str] = mapped_column(String, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    key: Mapped[str] = mapped_column(String, nullable=False, index=True)
    field_type: Mapped[str] = mapped_column(String, nullable=False, default="text")
    description: Mapped[str | None] = mapped_column(String, nullable=True)

    shop: Mapped["Shop"] = relationship("Shop")
    mapping: Mapped["MetafieldMapping | None"] = relationship(
        "MetafieldMapping", back_populates="field", uselist=False, cascade="all, delete-orphan"
    )
    values: Mapped[list["CustomFieldValue"]] = relationship(
        "CustomFieldValue", back_populates="field", cascade="all, delete-orphan"
    )


class MetafieldMapping(Base, TimestampMixin):
    """Maps a CustomFieldDefinition to a Shopify metafield namespace+key."""
    __tablename__ = "metafield_mappings"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    shop_id: Mapped[str] = mapped_column(String, ForeignKey("shops.id"), nullable=False, index=True)
    custom_field_id: Mapped[str] = mapped_column(
        String, ForeignKey("custom_field_definitions.id"), nullable=False, unique=True
    )
    shopify_namespace: Mapped[str] = mapped_column(String, nullable=False)
    shopify_key: Mapped[str] = mapped_column(String, nullable=False)

    shop: Mapped["Shop"] = relationship("Shop")
    field: Mapped["CustomFieldDefinition"] = relationship("CustomFieldDefinition", back_populates="mapping")


class CustomFieldValue(Base, TimestampMixin):
    """Stores an actual value for a custom field on a specific entity instance."""
    __tablename__ = "custom_field_values"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    custom_field_id: Mapped[str] = mapped_column(
        String, ForeignKey("custom_field_definitions.id"), nullable=False, index=True
    )
    entity_type: Mapped[str] = mapped_column(String, nullable=False, index=True)
    entity_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    value: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    field: Mapped["CustomFieldDefinition"] = relationship("CustomFieldDefinition", back_populates="values")

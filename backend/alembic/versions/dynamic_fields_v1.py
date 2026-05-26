"""
dynamic_fields_v1

- Add extra_attributes JSON catch-all to line_items and variants
- Add computed_fields JSON to line_items (stores transform output per line item)

Revision ID: dynamic_fields_v1
Revises: data_studio_v2
Create Date: 2026-05-25
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "dynamic_fields_v1"
down_revision: Union[str, None] = "d0f61aa21bd4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # line_items: catch-all for any Shopify fields not in mapped columns
    op.add_column("line_items", sa.Column(
        "extra_attributes", sa.JSON(), nullable=True
    ))
    # line_items: stores computed/transform output per line item
    op.add_column("line_items", sa.Column(
        "computed_fields", sa.JSON(), nullable=True
    ))
    # variants: extra_attributes catch-all (metafields already exists, this covers
    # any other passthrough fields from Shopify not in the fixed schema)
    op.add_column("variants", sa.Column(
        "extra_attributes", sa.JSON(), nullable=True
    ))


def downgrade() -> None:
    op.drop_column("variants", "extra_attributes")
    op.drop_column("line_items", "computed_fields")
    op.drop_column("line_items", "extra_attributes")

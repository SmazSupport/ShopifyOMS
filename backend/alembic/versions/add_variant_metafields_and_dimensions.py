"""Add variant metafields and dimensions

Revision ID: a1b2c3d4e5f6
Revises: data_studio_v2_add_derived_fields_and_jobs
Create Date: 2026-05-25 18:55:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a1b2c3d4e5f6'
down_revision = 'data_studio_v2_add_derived_fields_and_jobs'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add metafields JSON column to variants
    op.add_column(
        'variants',
        sa.Column('metafields', sa.JSON(), nullable=True)
    )
    
    # Add dimension columns to variants
    op.add_column(
        'variants',
        sa.Column('length', sa.Numeric(10, 4), nullable=True)
    )
    op.add_column(
        'variants',
        sa.Column('width', sa.Numeric(10, 4), nullable=True)
    )
    op.add_column(
        'variants',
        sa.Column('height', sa.Numeric(10, 4), nullable=True)
    )
    
    # Add shipping_unit column to variants
    op.add_column(
        'variants',
        sa.Column('shipping_unit', sa.Numeric(10, 4), nullable=True)
    )


def downgrade() -> None:
    # Remove columns in reverse order
    op.drop_column('variants', 'shipping_unit')
    op.drop_column('variants', 'height')
    op.drop_column('variants', 'width')
    op.drop_column('variants', 'length')
    op.drop_column('variants', 'metafields')

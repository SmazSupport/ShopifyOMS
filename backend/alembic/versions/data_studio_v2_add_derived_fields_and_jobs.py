"""
data_studio_v2_add_derived_fields_and_jobs

- Add new columns to field_transform_rules (source_path, depends_on, recalculation_mode, etc.)
- Create derived_field_values table
- Create recalculation_jobs table
- Create entity_relationships table
- Seed default entity relationships

Revision ID: data_studio_v2
Revises: 13fbc4d4a942
Create Date: 2026-05-25 13:30:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'data_studio_v2'
down_revision: Union[str, None] = '13fbc4d4a942'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ─────────────────────────────────────────────────────────────────
    # 1. Add new columns to field_transform_rules
    # ─────────────────────────────────────────────────────────────────
    op.add_column('field_transform_rules', sa.Column('source_path', postgresql.JSON(astext_type=sa.Text()), nullable=True))
    op.add_column('field_transform_rules', sa.Column('output_field_type', sa.String(), server_default='string', nullable=False))
    op.add_column('field_transform_rules', sa.Column('depends_on', postgresql.JSON(astext_type=sa.Text()), nullable=True))
    op.add_column('field_transform_rules', sa.Column('recalculation_mode', sa.String(), server_default='new_only', nullable=False))
    op.add_column('field_transform_rules', sa.Column('auto_recalc_on_source_change', sa.Boolean(), server_default='true', nullable=False))
    op.add_column('field_transform_rules', sa.Column('created_by', sa.String(), nullable=True))

    # ─────────────────────────────────────────────────────────────────
    # 2. Create derived_field_values table
    # ─────────────────────────────────────────────────────────────────
    op.create_table(
        'derived_field_values',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('shop_id', sa.String(), nullable=False),
        sa.Column('rule_id', sa.String(), nullable=False),
        sa.Column('entity_type', sa.String(), nullable=False),
        sa.Column('entity_id', sa.String(), nullable=False),
        sa.Column('value', postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column('computed_at', sa.String(), nullable=False),
        sa.Column('source_version', sa.String(), nullable=True),
        sa.Column('is_stale', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.String(), nullable=True),
        sa.Column('updated_at', sa.String(), nullable=True),
        sa.ForeignKeyConstraint(['rule_id'], ['field_transform_rules.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['shop_id'], ['shops.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('rule_id', 'entity_type', 'entity_id', name='uix_derived_value')
    )
    op.create_index('ix_derived_entity', 'derived_field_values', ['entity_type', 'entity_id'])
    op.create_index('ix_derived_field_values_is_stale', 'derived_field_values', ['is_stale'])
    op.create_index('ix_derived_field_values_rule_id', 'derived_field_values', ['rule_id'])
    op.create_index('ix_derived_field_values_shop_id', 'derived_field_values', ['shop_id'])
    op.create_index('ix_derived_stale', 'derived_field_values', ['is_stale', 'rule_id'])

    # ─────────────────────────────────────────────────────────────────
    # 3. Create recalculation_jobs table
    # ─────────────────────────────────────────────────────────────────
    op.create_table(
        'recalculation_jobs',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('shop_id', sa.String(), nullable=False),
        sa.Column('trigger_type', sa.String(), nullable=False),
        sa.Column('rule_id', sa.String(), nullable=False),
        sa.Column('scope', sa.String(), nullable=False),
        sa.Column('specific_order_ids', postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column('status', sa.String(), nullable=False),
        sa.Column('total_orders', sa.Integer(), nullable=True),
        sa.Column('processed_orders', sa.Integer(), nullable=True),
        sa.Column('failed_count', sa.Integer(), nullable=True),
        sa.Column('started_at', sa.String(), nullable=True),
        sa.Column('completed_at', sa.String(), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('error_details', postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column('triggered_by', sa.String(), nullable=True),
        sa.Column('created_at', sa.String(), nullable=True),
        sa.Column('updated_at', sa.String(), nullable=True),
        sa.ForeignKeyConstraint(['rule_id'], ['field_transform_rules.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['shop_id'], ['shops.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_recalculation_jobs_rule_id', 'recalculation_jobs', ['rule_id'])
    op.create_index('ix_recalculation_jobs_shop_id', 'recalculation_jobs', ['shop_id'])
    op.create_index('ix_recalculation_jobs_status', 'recalculation_jobs', ['status'])

    # ─────────────────────────────────────────────────────────────────
    # 4. Create entity_relationships table
    # ─────────────────────────────────────────────────────────────────
    op.create_table(
        'entity_relationships',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('from_entity', sa.String(), nullable=False),
        sa.Column('to_entity', sa.String(), nullable=False),
        sa.Column('via_field', sa.String(), nullable=False),
        sa.Column('reverse_via', sa.String(), nullable=True),
        sa.Column('relationship_type', sa.String(), server_default='many_to_one', nullable=False),
        sa.Column('description', sa.String(), nullable=True),
        sa.Column('is_system', sa.Boolean(), server_default='true', nullable=False),
        sa.Column('created_at', sa.String(), nullable=True),
        sa.Column('updated_at', sa.String(), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_entity_relationships_from_entity', 'entity_relationships', ['from_entity'])
    op.create_index('ix_entity_relationships_to_entity', 'entity_relationships', ['to_entity'])

    # ─────────────────────────────────────────────────────────────────
    # 5. Seed default entity relationships
    # ─────────────────────────────────────────────────────────────────
    seed_relationships = """
    INSERT INTO entity_relationships (id, from_entity, to_entity, via_field, reverse_via, relationship_type, is_system, created_at, updated_at)
    VALUES
    (gen_random_uuid()::text, 'line_item', 'variant', 'variant_id', NULL, 'many_to_one', true, NOW()::text, NOW()::text),
    (gen_random_uuid()::text, 'variant', 'product', 'product_id', NULL, 'many_to_one', true, NOW()::text, NOW()::text),
    (gen_random_uuid()::text, 'line_item', 'order', 'order_id', NULL, 'many_to_one', true, NOW()::text, NOW()::text),
    (gen_random_uuid()::text, 'order', 'customer', 'customer_id', NULL, 'many_to_one', true, NOW()::text, NOW()::text),
    (gen_random_uuid()::text, 'order', 'line_item', 'id', 'order_id', 'one_to_many', true, NOW()::text, NOW()::text),
    (gen_random_uuid()::text, 'product', 'variant', 'id', 'product_id', 'one_to_many', true, NOW()::text, NOW()::text),
    (gen_random_uuid()::text, 'variant', 'line_item', 'id', 'variant_id', 'one_to_many', true, NOW()::text, NOW()::text),
    (gen_random_uuid()::text, 'customer', 'order', 'id', 'customer_id', 'one_to_many', true, NOW()::text, NOW()::text);
    """
    op.execute(seed_relationships)

    # ─────────────────────────────────────────────────────────────────
    # 6. Infer source_path for existing field_transform_rules
    # ─────────────────────────────────────────────────────────────────
    infer_paths = """
    UPDATE field_transform_rules 
    SET source_path = CASE
        WHEN source_entity = output_entity THEN '[]'::jsonb
        WHEN source_entity = 'variant' AND output_entity = 'line_item' 
            THEN '[{"entity": "variant", "via": "variant_id", "inferred": true}]'::jsonb
        WHEN source_entity = 'product' AND output_entity = 'line_item'
            THEN '[{"entity": "variant", "via": "variant_id", "inferred": true}, {"entity": "product", "via": "product_id", "inferred": true}]'::jsonb
        WHEN source_entity = 'order' AND output_entity = 'line_item'
            THEN '[{"entity": "order", "via": "order_id", "inferred": true}]'::jsonb
        ELSE '[]'::jsonb
    END
    WHERE source_path IS NULL;
    """
    op.execute(infer_paths)


def downgrade() -> None:
    # Drop in reverse order
    op.drop_index('ix_entity_relationships_to_entity', table_name='entity_relationships')
    op.drop_index('ix_entity_relationships_from_entity', table_name='entity_relationships')
    op.drop_table('entity_relationships')

    op.drop_index('ix_recalculation_jobs_status', table_name='recalculation_jobs')
    op.drop_index('ix_recalculation_jobs_shop_id', table_name='recalculation_jobs')
    op.drop_index('ix_recalculation_jobs_rule_id', table_name='recalculation_jobs')
    op.drop_table('recalculation_jobs')

    op.drop_index('ix_derived_stale', table_name='derived_field_values')
    op.drop_index('ix_derived_field_values_shop_id', table_name='derived_field_values')
    op.drop_index('ix_derived_field_values_rule_id', table_name='derived_field_values')
    op.drop_index('ix_derived_field_values_is_stale', table_name='derived_field_values')
    op.drop_index('ix_derived_entity', table_name='derived_field_values')
    op.drop_table('derived_field_values')

    op.drop_column('field_transform_rules', 'created_by')
    op.drop_column('field_transform_rules', 'auto_recalc_on_source_change')
    op.drop_column('field_transform_rules', 'recalculation_mode')
    op.drop_column('field_transform_rules', 'depends_on')
    op.drop_column('field_transform_rules', 'output_field_type')
    op.drop_column('field_transform_rules', 'source_path')

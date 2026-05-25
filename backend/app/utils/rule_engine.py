"""
OMS Rule Engine
Applies field transform rules, bundle explosion, and mystery substitution
when an order is ingested.

transform_type registry:
  extract_pattern  — regex capture groups named in transform_config["groups"]
  first_alpha      — extracts leading alpha characters
  first_numeric    — extracts leading numeric characters
  split            — splits on transform_config["delimiter"], picks transform_config["index"]
  chars            — substring: transform_config["start"], transform_config["end"]
  if_then          — if source_field matches condition, output a value; else another
  formula          — LEFT / RIGHT / MID / UPPER / LOWER / CONCAT / TRIM functions
  custom_js        — sandboxed JS-like expression evaluated via simple Python AST eval
  lookup           — fetch value from related entity
  aggregate        — aggregate across child records (unique_concat, concat, sum, count)
  join             — join multiple fields with delimiter
"""

import re
import json
import logging
from typing import Any, Optional
from collections import defaultdict
from datetime import datetime

log = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────
# Errors
# ─────────────────────────────────────────────────────────────────

class CircularDependencyError(Exception):
    """Raised when rules have circular dependencies."""
    pass


class MissingRelationshipError(Exception):
    """Raised when no relationship path exists between entities."""
    pass


class TransformError(Exception):
    """Raised when a transform fails."""
    pass


# ─────────────────────────────────────────────────────────────────
# Field Transform Engine
# ─────────────────────────────────────────────────────────────────

def apply_transform(value: Any, transform_type: str, config: dict) -> Any:
    """
    Apply a single transform to a source value.
    Returns the computed output value, or None on failure.
    """
    if value is None:
        return config.get("default")
    src = str(value)

    try:
        if transform_type == "first_alpha":
            m = re.match(r"^([A-Za-z]+)", src)
            result = m.group(1) if m else config.get("default", "")
            if config.get("uppercase"):
                result = result.upper()
            return result

        elif transform_type == "first_numeric":
            m = re.match(r"^[A-Za-z]*(\d+)", src)
            return m.group(1) if m else config.get("default", "")

        elif transform_type == "extract_pattern":
            pattern = config.get("pattern", "")
            group = config.get("group", 1)
            flags = re.IGNORECASE if config.get("case_insensitive") else 0
            m = re.search(pattern, src, flags)
            if m:
                return m.group(group) if isinstance(group, int) else m.group(group)
            return config.get("default")

        elif transform_type == "split":
            delimiter = config.get("delimiter", ",")
            index = int(config.get("index", 0))
            parts = src.split(delimiter)
            return parts[index].strip() if index < len(parts) else config.get("default")

        elif transform_type == "chars":
            start = int(config.get("start", 0))
            end = config.get("end")
            return src[start:end] if end is not None else src[start:]

        elif transform_type == "if_then":
            condition_type = config.get("condition_type", "equals")
            condition_value = str(config.get("condition_value", ""))
            then_value = config.get("then_value", "")
            else_value = config.get("else_value", "")

            if condition_type == "equals":
                return then_value if src == condition_value else else_value
            elif condition_type == "contains":
                return then_value if condition_value in src else else_value
            elif condition_type == "starts_with":
                return then_value if src.startswith(condition_value) else else_value
            elif condition_type == "ends_with":
                return then_value if src.endswith(condition_value) else else_value
            elif condition_type == "matches":
                return then_value if re.match(condition_value, src) else else_value
            elif condition_type == "not_empty":
                return then_value if src.strip() else else_value
            return else_value

        elif transform_type == "formula":
            func = config.get("function", "").upper()
            if func == "LEFT":
                n = int(config.get("n", 1))
                return src[:n]
            elif func == "RIGHT":
                n = int(config.get("n", 1))
                return src[-n:] if n > 0 else ""
            elif func == "MID":
                start = int(config.get("start", 1)) - 1
                length = int(config.get("length", 1))
                return src[start:start + length]
            elif func == "UPPER":
                return src.upper()
            elif func == "LOWER":
                return src.lower()
            elif func == "TRIM":
                return src.strip()
            elif func == "LEN":
                return str(len(src))
            elif func == "CONCAT":
                parts = config.get("parts", [])
                return "".join(str(p) if p != "__value__" else src for p in parts)
            return src

        elif transform_type == "custom_js":
            # Safe subset: evaluate simple Python expression
            # Available: value (the source), re module, len, str, int, float
            expr = config.get("expression", "value")
            safe_globals = {"__builtins__": {}, "re": re, "len": len, "str": str,
                            "int": int, "float": float, "value": src, "json": json}
            result = eval(expr, safe_globals)  # noqa: S307
            return result

        elif transform_type == "unique_values":
            # Used to collect unique values across multiple line items
            # The engine handles aggregation; transform just passes through
            return src

        elif transform_type == "lookup":
            # Lookup is handled by the execution graph, not here
            # This branch shouldn't be reached if configured correctly
            log.warning("lookup transform should be resolved by execution graph")
            return config.get("default")

        elif transform_type == "aggregate":
            # Aggregate is handled by the execution graph, not here
            log.warning("aggregate transform should be resolved by execution graph")
            return config.get("default")

        elif transform_type == "join":
            fields = config.get("fields", [])
            delimiter = config.get("delimiter", "-")
            ignore_empty = config.get("ignore_empty", True)

            # fields can contain string literals or references to computed values
            parts = []
            for field in fields:
                if field.startswith("computed."):
                    # This would need the computed values dict passed in
                    # For now, return default
                    return config.get("default")
                elif field == "__value__":
                    parts.append(src)
                else:
                    parts.append(str(field))

            if ignore_empty:
                parts = [p for p in parts if p]
            return delimiter.join(parts)

        elif transform_type == "math":
            operation = config.get("operation", "multiply")
            operand = config.get("operand", 1)
            round_to = config.get("round_to")

            try:
                num_val = float(src) if src else 0
                if operation == "add":
                    result = num_val + operand
                elif operation == "subtract":
                    result = num_val - operand
                elif operation == "multiply":
                    result = num_val * operand
                elif operation == "divide":
                    result = num_val / operand if operand != 0 else 0
                elif operation == "round":
                    result = round(num_val, int(operand))
                else:
                    result = num_val

                if round_to is not None:
                    result = round(result, round_to)
                return result
            except (ValueError, TypeError):
                return config.get("default", 0)

    except Exception as e:
        log.warning(f"Transform {transform_type} failed on value '{value}': {e}")
        return config.get("default")

    return src


def apply_field_transforms(entity_type: str, entity_data: dict, rules: list) -> dict:
    """
    Given a dict of entity fields and a list of active FieldTransformRule objects,
    returns a dict of computed output fields: {output_field_key: computed_value}
    """
    computed = {}
    active_rules = sorted(
        [r for r in rules if r.is_active and r.source_entity == entity_type],
        key=lambda r: r.run_order
    )
    for rule in active_rules:
        source_value = entity_data.get(rule.source_field)
        result = apply_transform(source_value, rule.transform_type, rule.transform_config)
        computed[rule.output_field_key] = result
    return computed


# ─────────────────────────────────────────────────────────────────
# Bundle Explosion Engine
# ─────────────────────────────────────────────────────────────────

def explode_bundles(line_items: list[dict], bundle_rules: list) -> list[dict]:
    """
    Given a list of order line item dicts and active BundleRule objects,
    returns an expanded list where bundle parent SKUs are replaced/annotated
    with their child SKUs.

    Each exploded line item gets:
      _bundle_parent_sku: the original parent SKU
      _bundle_parent_line_item_id: the shopify line item id to update
      _is_bundle_child: True
    """
    active_bundles = {r.parent_sku: r for r in bundle_rules if r.is_active}
    result = []

    for item in line_items:
        sku = item.get("sku") or item.get("ship_sku") or ""
        if sku in active_bundles:
            rule = active_bundles[sku]
            parent_qty = int(item.get("quantity", 1))
            for child in rule.child_skus:
                child_sku = child.get("sku", "")
                child_qty = int(child.get("quantity", 1)) * parent_qty
                exploded = {
                    **item,
                    "sku": child_sku,
                    "ship_sku": child_sku,
                    "original_sku": sku,
                    "quantity": child_qty,
                    "_bundle_parent_sku": sku,
                    "_bundle_parent_line_item_id": item.get("shopify_line_item_id"),
                    "_is_bundle_child": True,
                    "_bundle_rule_id": rule.id,
                    "_ships_together": rule.ships_together,
                    "_allow_partial_ship": rule.allow_partial_ship,
                    "_notify_shopify_as_parent": rule.notify_shopify_as_parent,
                    "source_reason": f"bundle_explode:{sku}",
                }
                result.append(exploded)
        else:
            result.append(item)

    return result


# ─────────────────────────────────────────────────────────────────
# Mystery Substitution Engine
# ─────────────────────────────────────────────────────────────────

def resolve_mystery_sku(mystery_sku: str, customer_history: list[str],
                        mystery_rules: list) -> str:
    """
    Given a mystery SKU, the customer's already-received SKU list, and
    all active MysteryRule objects, return the resolved ship_sku.
    Falls back to fallback_sku, then to the mystery_sku itself if no
    eligible option is found.
    """
    rule = next((r for r in mystery_rules if r.mystery_sku == mystery_sku and r.is_active), None)
    if not rule:
        return mystery_sku

    eligible = list(rule.eligible_skus)

    if rule.exclude_if_previously_received:
        already_received = set(customer_history)
        eligible = [s for s in eligible if s not in already_received]

    if not eligible:
        return rule.fallback_sku or mystery_sku

    if rule.selection_strategy in ("exclude_previously_shipped", "random"):
        import random
        return random.choice(eligible)
    elif rule.selection_strategy == "sequential":
        # Round-robin through eligible, deterministic based on history length
        return eligible[len(customer_history) % len(eligible)]

    return eligible[0]


def apply_mystery_rules(line_items: list[dict], mystery_rules: list,
                        customer_history: list[str]) -> list[dict]:
    """
    Scan line items for mystery SKUs and resolve them.
    Returns updated line items with ship_sku set.
    """
    mystery_skus = {r.mystery_sku for r in mystery_rules if r.is_active}
    result = []
    for item in line_items:
        sku = item.get("sku") or ""
        if sku in mystery_skus:
            resolved = resolve_mystery_sku(sku, customer_history, mystery_rules)
            result.append({
                **item,
                "original_sku": sku,
                "ship_sku": resolved,
                "source_reason": f"mystery_resolve:{sku}→{resolved}",
                "_is_mystery": True,
            })
        else:
            result.append(item)
    return result


# ─────────────────────────────────────────────────────────────────
# Data Studio Execution Engine
# ─────────────────────────────────────────────────────────────────

class RuleExecutionGraph:
    """
    Builds and executes the dependency graph for field transforms.
    Handles cross-entity traversal and aggregation.
    """

    def __init__(self, db_session=None):
        self.db = db_session
        self._entity_cache = {}
        self._relationship_cache = None

    def build_execution_order(self, rules: list) -> list[list]:
        """
        Returns rules grouped by execution level (parallelizable groups).
        Level 0: No dependencies
        Level 1: Depends only on Level 0
        etc.
        """
        if not rules:
            return []

        # Build adjacency list
        rule_map = {r.output_field_key: r for r in rules}
        graph = defaultdict(set)

        for rule in rules:
            for dep in (rule.depends_on or []):
                if dep in rule_map:
                    graph[rule.output_field_key].add(dep)

        # Topological sort (Kahn's algorithm)
        in_degree = {r.output_field_key: 0 for r in rules}
        for deps in graph.values():
            for dep in deps:
                in_degree[dep] += 1

        levels = []
        remaining = set(r.output_field_key for r in rules)

        while remaining:
            # Find all with in_degree 0
            current_level = [
                rule_map[k] for k in remaining
                if in_degree.get(k, 0) == 0
            ]

            if not current_level:
                raise CircularDependencyError("Cycle detected in rule dependencies")

            levels.append(current_level)

            for rule in current_level:
                remaining.remove(rule.output_field_key)
                for dependent in graph.get(rule.output_field_key, []):
                    in_degree[dependent] -= 1

        return levels

    def compute_for_entity(self, entity_type: str, entity_id: str,
                        rules: list, db_session=None) -> dict:
        """
        Compute all derived fields for a single entity instance.
        """
        if db_session:
            self.db = db_session

        if not self.db:
            raise ValueError("Database session required")

        # Get all active rules for this entity
        entity_rules = [r for r in rules if r.output_entity == entity_type and r.is_active]

        if not entity_rules:
            return {}

        # Build execution order
        levels = self.build_execution_order(entity_rules)

        # Results accumulator
        computed = {}

        for level in levels:
            for rule in level:
                # Resolve source value
                source_value = self._resolve_source(
                    entity_type, entity_id, rule, computed
                )

                # Apply transform
                if rule.transform_type == "aggregate":
                    result = self._apply_aggregate(entity_type, entity_id, rule, computed)
                elif rule.transform_type == "lookup":
                    result = self._apply_lookup(entity_type, entity_id, rule, computed)
                else:
                    result = apply_transform(
                        source_value,
                        rule.transform_type,
                        rule.transform_config
                    )

                # Store
                computed[rule.output_field_key] = result

        return computed

    def _resolve_source(self, entity_type: str, entity_id: str,
                       rule, computed: dict) -> Any:
        """
        Resolve the source value, traversing relationships if needed.
        """
        current_entity = entity_type
        current_id = entity_id

        # Follow path if needed
        path = rule.source_path or []

        for step in path:
            # Get relationship
            rel = self._get_relationship(current_entity, step["entity"])

            if not rel:
                raise MissingRelationshipError(
                    f"No path from {current_entity} to {step['entity']}"
                )

            # Traverse
            next_id = self._fetch_related_id(current_entity, current_id, rel)

            if not next_id:
                return None  # Missing relationship

            current_entity = step["entity"]
            current_id = next_id

        # Now at the source entity, fetch the field
        if rule.source_field.startswith("computed."):
            # Computed field - get from accumulator
            key = rule.source_field.replace("computed.", "")
            return computed.get(key)

        elif "." in rule.source_field:
            # Handle nested fields like metafields.custom.bin_number
            parts = rule.source_field.split(".")
            data = self._fetch_entity_data(current_entity, current_id)

            for part in parts:
                if data is None:
                    return None
                if isinstance(data, dict):
                    data = data.get(part)
                else:
                    return None
            return data

        else:
            # Native field - fetch from entity
            data = self._fetch_entity_data(current_entity, current_id)
            return data.get(rule.source_field) if data else None

    def _apply_aggregate(self, entity_type: str, entity_id: str,
                        rule, computed: dict) -> Any:
        """
        Apply an aggregate transform across child records.
        """
        config = rule.transform_config
        source_entity = config.get("source_entity")
        source_field = config.get("source_field")
        operation = config.get("operation", "unique_concat")
        delimiter = config.get("delimiter", ", ")
        sort_order = config.get("sort", "asc")

        # Find relationship to children
        rel = self._get_relationship(entity_type, source_entity)
        if not rel or rel.relationship_type != "one_to_many":
            raise MissingRelationshipError(
                f"No one-to-many relationship from {entity_type} to {source_entity}"
            )

        # Fetch all child records
        children = self._fetch_children(entity_type, entity_id, source_entity, rel)

        # Extract values
        values = []
        for child in children:
            if source_field.startswith("computed."):
                # Need to compute this child's derived fields first
                child_computed = self.compute_for_entity(
                    source_entity, child.get("id"), [], self.db
                )
                val = child_computed.get(source_field.replace("computed.", ""))
            else:
                val = child.get(source_field)

            if val is not None:
                values.append(val)

        # Apply operation
        if operation == "unique_concat":
            unique_vals = list(dict.fromkeys(values))  # Preserve order, remove dups
            if sort_order == "asc":
                unique_vals = sorted(unique_vals)
            elif sort_order == "desc":
                unique_vals = sorted(unique_vals, reverse=True)
            return delimiter.join(str(v) for v in unique_vals)

        elif operation == "concat":
            if sort_order == "asc":
                values = sorted(values)
            elif sort_order == "desc":
                values = sorted(values, reverse=True)
            return delimiter.join(str(v) for v in values)

        elif operation == "sum":
            return sum(float(v) for v in values if v is not None)

        elif operation == "count":
            return len(values)

        elif operation == "avg":
            return sum(float(v) for v in values if v is not None) / len(values) if values else 0

        elif operation == "min":
            return min(values) if values else None

        elif operation == "max":
            return max(values) if values else None

        elif operation == "first":
            return values[0] if values else None

        elif operation == "last":
            return values[-1] if values else None

        return None

    def _apply_lookup(self, entity_type: str, entity_id: str,
                     rule, computed: dict) -> Any:
        """
        Apply a lookup transform to fetch value from related entity.
        """
        config = rule.transform_config
        target_entity = config.get("target_entity")
        target_field = config.get("target_field")
        via = config.get("via")

        # Find relationship
        rel = self._get_relationship(entity_type, target_entity)
        if not rel:
            # Try to use the 'via' field directly
            data = self._fetch_entity_data(entity_type, entity_id)
            target_id = data.get(via) if data else None
        else:
            target_id = self._fetch_related_id(entity_type, entity_id, rel)

        if not target_id:
            return config.get("default")

        # Fetch target entity data
        target_data = self._fetch_entity_data(target_entity, target_id)
        if not target_data:
            return config.get("default")

        # Handle nested field path
        if "." in target_field:
            parts = target_field.split(".")
            val = target_data
            for part in parts:
                if val is None:
                    return config.get("default")
                val = val.get(part) if isinstance(val, dict) else None
            return val if val is not None else config.get("default")

        return target_data.get(target_field, config.get("default"))

    def _get_relationship(self, from_entity: str, to_entity: str):
        """Get relationship definition from cache or database."""
        if self._relationship_cache is None:
            from app.models import EntityRelationship
            self._relationship_cache = {}
            rels = self.db.query(EntityRelationship).all()
            for rel in rels:
                key = (rel.from_entity, rel.to_entity)
                self._relationship_cache[key] = rel

        return self._relationship_cache.get((from_entity, to_entity))

    def _fetch_entity_data(self, entity_type: str, entity_id: str) -> Optional[dict]:
        """Fetch entity data from database."""
        cache_key = f"{entity_type}:{entity_id}"
        if cache_key in self._entity_cache:
            return self._entity_cache[cache_key]

        # Map entity types to models
        from app.models import Order, LineItem, Product, Variant, Customer

        model_map = {
            "order": Order,
            "line_item": LineItem,
            "product": Product,
            "variant": Variant,
            "customer": Customer,
        }

        model = model_map.get(entity_type)
        if not model:
            return None

        entity = self.db.query(model).filter_by(id=entity_id).first()
        if entity:
            # Convert to dict (simple approach)
            data = {c.name: getattr(entity, c.name) for c in entity.__table__.columns}
            self._entity_cache[cache_key] = data
            return data

        return None

    def _fetch_related_id(self, from_entity: str, from_id: str, rel) -> Optional[str]:
        """Fetch the related entity ID via relationship."""
        data = self._fetch_entity_data(from_entity, from_id)
        if data:
            return data.get(rel.via_field)
        return None

    def _fetch_children(self, parent_entity: str, parent_id: str,
                       child_entity: str, rel) -> list[dict]:
        """Fetch child records for a one-to-many relationship."""
        # Map entity types to models
        from app.models import Order, LineItem, Product, Variant, Customer

        model_map = {
            "order": Order,
            "line_item": LineItem,
            "product": Product,
            "variant": Variant,
            "customer": Customer,
        }

        child_model = model_map.get(child_entity)
        if not child_model:
            return []

        # Query by reverse relationship
        children = self.db.query(child_model).filter(
            getattr(child_model, rel.reverse_via) == parent_id
        ).all()

        return [
            {c.name: getattr(child, c.name) for c in child.__table__.columns}
            for child in children
        ]


class RecalculationManager:
    """
    Manages when and how to recalculate derived fields.
    """

    def __init__(self, db_session):
        self.db = db_session

    def on_rule_created(self, rule) -> Optional[str]:
        """
        New rule created - queue recalculation based on mode.
        Returns job ID if queued.
        """
        from app.models import RecalculationJob

        if rule.recalculation_mode == "new_only":
            return None  # No job needed

        scope = self._mode_to_scope(rule.recalculation_mode)

        job = RecalculationJob(
            shop_id=rule.shop_id,
            trigger_type="rule_created",
            rule_id=rule.id,
            scope=scope,
            status="pending",
            triggered_by=rule.created_by
        )
        self.db.add(job)
        self.db.commit()

        return job.id

    def on_rule_updated(self, rule, triggered_by: str = None) -> Optional[str]:
        """
        Rule changed - may need recalculation.
        """
        from app.models import DerivedFieldValue, RecalculationJob

        # Mark existing values as stale
        self.db.query(DerivedFieldValue).filter_by(rule_id=rule.id).update({
            "is_stale": True
        })

        if rule.recalculation_mode == "new_only":
            self.db.commit()
            return None

        scope = self._mode_to_scope(rule.recalculation_mode)

        # Check for existing pending job
        existing = self.db.query(RecalculationJob).filter_by(
            rule_id=rule.id,
            status="pending"
        ).first()

        if existing:
            # Update existing job scope if broader
            if self._scope_priority(scope) > self._scope_priority(existing.scope):
                existing.scope = scope
            self.db.commit()
            return existing.id

        job = RecalculationJob(
            shop_id=rule.shop_id,
            trigger_type="rule_updated",
            rule_id=rule.id,
            scope=scope,
            status="pending",
            triggered_by=triggered_by
        )
        self.db.add(job)
        self.db.commit()

        return job.id

    def on_source_changed(self, entity_type: str, entity_id: str,
                         changed_fields: list[str], shop_id: str) -> list[str]:
        """
        Source data changed (webhook, manual edit, etc.).
        Find affected rules and mark values stale.
        Returns list of affected rule IDs.
        """
        from app.models import FieldTransformRule, DerivedFieldValue, RecalculationJob

        # Build field patterns to match (exact and nested)
        field_patterns = set(changed_fields)
        for field in changed_fields:
            if "." in field:
                field_patterns.add(field.split(".")[0] + ".*")

        # Find rules that source from these fields
        rules = self.db.query(FieldTransformRule).filter(
            FieldTransformRule.source_entity == entity_type,
            FieldTransformRule.is_active == True,
            FieldTransformRule.auto_recalc_on_source_change == True
        ).all()

        affected_rule_ids = []

        for rule in rules:
            # Check if this rule's source matches any changed field
            source = rule.source_field
            if source in field_patterns or any(
                source.startswith(f.replace(".*", ".")) for f in field_patterns
            ):
                # Mark this entity's derived value as stale
                self.db.query(DerivedFieldValue).filter_by(
                    rule_id=rule.id,
                    entity_id=entity_id
                ).update({"is_stale": True})

                # Cascade to dependents
                self._cascade_staleness(rule)

                affected_rule_ids.append(rule.id)

        self.db.commit()
        return affected_rule_ids

    def _cascade_staleness(self, rule):
        """Mark all dependent rules' values as stale."""
        from app.models import FieldTransformRule, DerivedFieldValue

        dependents = self.db.query(FieldTransformRule).filter(
            FieldTransformRule.depends_on.contains([rule.output_field_key])
        ).all()

        for dep in dependents:
            self.db.query(DerivedFieldValue).filter_by(
                rule_id=dep.id
            ).update({"is_stale": True})

            # Recurse for deeper dependencies
            self._cascade_staleness(dep)

    def _mode_to_scope(self, mode: str) -> str:
        """Convert recalculation mode to job scope."""
        mapping = {
            "new_only": "new_only",
            "new_and_open": "open_orders",
            "new_and_unfulfilled": "unfulfilled",
            "new_and_all": "all_orders",
            "immediate_all": "all_orders"
        }
        return mapping.get(mode, "new_only")

    def _scope_priority(self, scope: str) -> int:
        """Higher number = broader scope."""
        priorities = {
            "new_only": 0,
            "open_orders": 1,
            "unfulfilled": 2,
            "all_orders": 3
        }
        return priorities.get(scope, 0)


def get_orders_for_scope(scope: str, specific_ids: list, db):
    """Query orders based on recalculation scope."""
    from app.models import Order

    query = db.query(Order)

    if scope == "new_only":
        return []
    elif scope == "open_orders":
        return query.filter(Order.status.in_(["pending", "open"])).all()
    elif scope == "unfulfilled":
        return query.filter(
            Order.fulfillment_status.in_(["unfulfilled", "partial"])
        ).all()
    elif scope == "all_orders":
        return query.all()
    elif scope == "specific_orders" and specific_ids:
        return query.filter(Order.id.in_(specific_ids)).all()

    return []

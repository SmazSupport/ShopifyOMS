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
"""

import re
import json
import logging
from typing import Any

log = logging.getLogger(__name__)


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

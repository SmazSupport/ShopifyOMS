# Data Studio Architecture

> Complete technical specification for the OMS Data Studio
> Created: 2026-05-25

---

## 1. Core Concepts

### Entity Hierarchy

```
Order
├── LineItem ──► Variant ──► Product
│     └── metafields          └── metafields
│     └── custom_fields       └── custom_fields
├── Customer
│   └── addresses
└── custom_fields (order-level)
```

**Traversable Relationships:**
- `line_item` → `variant` (via line_item.variant_id)
- `line_item` → `order` (via line_item.order_id)
- `variant` → `product` (via variant.product_id)
- `order` → `customer` (via order.customer_id)
- `order` → `line_items` (one-to-many)

### Field Types

| Type | Description | Example |
|------|-------------|---------|
| `native` | Shopify native field | `order.total_price`, `variant.sku` |
| `metafield` | Shopify metafield | `variant.metafields.custom.bin_number` |
| `computed` | User-created derived field | `line_item.bin_section` |
| `aggregate` | Computed across children | `order.sections` (unique from line_items) |

---

## 2. Data Models

### 2.1 FieldTransformRule (Enhanced)

```python
class FieldTransformRule(Base, TimestampMixin):
    """
    Defines how to compute a derived field from source data.
    Supports cross-entity traversal, dependencies, and recalculation modes.
    """
    __tablename__ = "field_transform_rules"
    
    # ─── Identity ───
    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    shop_id: Mapped[str] = mapped_column(String, ForeignKey("shops.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)  # User-friendly name
    
    # ─── Source Configuration ───
    source_entity: Mapped[str] = mapped_column(String, nullable=False, index=True)
    # ^ "order", "line_item", "variant", "product", "customer"
    
    source_field: Mapped[str] = mapped_column(String, nullable=False)
    # ^ Can be: "sku", "metafields.custom.bin_number", "computed.bin_section"
    
    source_path: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # ^ Auto-inferred or user-defined traversal path
    # Example: [{"entity": "variant", "via": "variant_id", "inferred": true}]
    
    # ─── Transform Configuration ───
    transform_type: Mapped[str] = mapped_column(String, nullable=False)
    # ^ "extract", "split", "formula", "aggregate", "join", "if_then", "custom"
    
    transform_config: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    # ^ Type-specific configuration
    
    # ─── Output Configuration ───
    output_entity: Mapped[str] = mapped_column(String, nullable=False, index=True)
    output_field_key: Mapped[str] = mapped_column(String, nullable=False, index=True)
    output_field_label: Mapped[str] = mapped_column(String, nullable=False)
    output_field_type: Mapped[str] = mapped_column(String, default="string")
    # ^ "string", "number", "boolean", "date", "array", "json"
    
    # ─── Execution Configuration ───
    run_order: Mapped[int] = mapped_column(Integer, default=0)
    # ^ Higher = later (dependencies execute first)
    
    depends_on: Mapped[list | None] = mapped_column(JSON, nullable=True, default=list)
    # ^ List of output_field_keys this rule requires
    
    # ─── Recalculation Lifecycle ───
    recalculation_mode: Mapped[str] = mapped_column(String, default="new_only")
    # ^ "new_only": Only new orders
    # ^ "new_and_open": New orders + open/pending orders
    # ^ "new_and_unfulfilled": New orders + unfulfilled orders
    # ^ "new_and_all": New orders + all existing (queued)
    # ^ "immediate_all": All orders (blocking, for small datasets)
    
    auto_recalc_on_source_change: Mapped[bool] = mapped_column(Boolean, default=True)
    # ^ When source metafield changes, trigger recalculation?
    
    # ─── Status ───
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    
    # ─── Metadata ───
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str | None] = mapped_column(String, nullable=True)
    
    # Relationships
    shop: Mapped["Shop"] = relationship("Shop")
    derived_values: Mapped[list["DerivedFieldValue"]] = relationship(
        "DerivedFieldValue", back_populates="rule", cascade="all, delete-orphan"
    )
    recalculation_jobs: Mapped[list["RecalculationJob"]] = relationship(
        "RecalculationJob", back_populates="rule", cascade="all, delete-orphan"
    )
```

### 2.2 Transform Types Detail

```python
TRANSFORM_TYPES = {
    # ─── Single Value Transforms ───
    "extract": {
        "description": "Extract pattern via regex",
        "config": {
            "pattern": r"^([A-Za-z]+)",  # Regex pattern
            "group": 1,                    # Capture group to return
            "case_insensitive": False,
            "default": None
        }
    },
    "split": {
        "description": "Split and pick element",
        "config": {
            "delimiter": "-",
            "index": 0,        # Which part to take
            "default": None
        }
    },
    "chars": {
        "description": "Substring extraction",
        "config": {
            "start": 0,
            "end": 3,          # None = to end
            "from_end": False  # If True, start from right
        }
    },
    "formula": {
        "description": "Built-in functions",
        "config": {
            "function": "UPPER",  # LEFT, RIGHT, MID, UPPER, LOWER, TRIM, LEN, CONCAT
            "args": {}            # Function-specific args
        }
    },
    "if_then": {
        "description": "Conditional logic",
        "config": {
            "condition_type": "equals",  # equals, contains, starts_with, ends_with, matches, not_empty, gt, lt
            "condition_value": "A",
            "then_value": "Section A",
            "else_value": "Other"
        }
    },
    "math": {
        "description": "Numeric operations",
        "config": {
            "operation": "multiply",  # add, subtract, multiply, divide, round
            "operand": 1.5,
            "round_to": 2
        }
    },
    "custom": {
        "description": "Python expression (sandboxed)",
        "config": {
            "expression": "value[:1] + '-' + str(len(value))",
            "safe_only": True  # Only allow safe operations
        }
    },
    
    # ─── Cross-Entity Transforms ───
    "lookup": {
        "description": "Fetch value from related entity",
        "config": {
            "target_entity": "variant",
            "target_field": "metafields.custom.bin_number",
            "via": "variant_id",
            "default": None
        }
    },
    
    # ─── Aggregation Transforms ───
    "aggregate": {
        "description": "Aggregate across child records",
        "config": {
            "source_entity": "line_item",      # Must be child of output_entity
            "source_field": "bin_section",      # Field on child to aggregate
            "operation": "unique_concat",       # unique_concat, concat, sum, count, avg, min, max, first, last
            "delimiter": ", ",
            "sort": "asc",                      # asc, desc, none
            "filter": None                      # Optional condition
        }
    },
    "join": {
        "description": "Join multiple fields",
        "config": {
            "fields": ["section", "column", "row"],
            "delimiter": "-",
            "ignore_empty": True
        }
    }
}
```

### 2.3 DerivedFieldValue

```python
class DerivedFieldValue(Base, TimestampMixin):
    """
    Stores computed values for fast retrieval.
    This is Layer B - derived data (can be rebuilt from Layer A + rules).
    """
    __tablename__ = "derived_field_values"
    
    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    shop_id: Mapped[str] = mapped_column(String, ForeignKey("shops.id"), nullable=False, index=True)
    
    # Rule that generated this value
    rule_id: Mapped[str] = mapped_column(String, ForeignKey("field_transform_rules.id"), nullable=False, index=True)
    
    # Target entity
    entity_type: Mapped[str] = mapped_column(String, nullable=False, index=True)
    # ^ "order", "line_item", "variant", "product", "customer"
    
    entity_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    # ^ FK to the actual entity (orders.id, order_line_items.id, etc.)
    
    # Computed value
    value: Mapped[Any] = mapped_column(JSON, nullable=True)
    # ^ Stored as JSON to handle strings, numbers, arrays, objects
    
    # Metadata
    computed_at: Mapped[str] = mapped_column(String, nullable=False)
    source_version: Mapped[str | None] = mapped_column(String, nullable=True)
    # ^ Hash of source data at compute time (for detecting stale values)
    
    # Status
    is_stale: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    # ^ Marked when source changes, waiting for recalc
    
    # Relationships
    shop: Mapped["Shop"] = relationship("Shop")
    rule: Mapped["FieldTransformRule"] = relationship("FieldTransformRule", back_populates="derived_values")
    
    # Indexes for fast lookups
    __table_args__ = (
        # Unique constraint: one value per rule per entity
        UniqueConstraint('rule_id', 'entity_type', 'entity_id', name='uix_derived_value'),
        # Index for fetching all values for an entity
        Index('ix_derived_entity', 'entity_type', 'entity_id'),
        # Index for finding stale values
        Index('ix_derived_stale', 'is_stale', 'rule_id'),
    )
```

### 2.4 RecalculationJob

```python
class RecalculationJob(Base, TimestampMixin):
    """
    Tracks background recalculation work.
    """
    __tablename__ = "recalculation_jobs"
    
    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    shop_id: Mapped[str] = mapped_column(String, ForeignKey("shops.id"), nullable=False, index=True)
    
    # What triggered this job
    trigger_type: Mapped[str] = mapped_column(String, nullable=False)
    # ^ "rule_created", "rule_updated", "source_changed", "manual", "webhook"
    
    # The rule being recalculated
    rule_id: Mapped[str] = mapped_column(String, ForeignKey("field_transform_rules.id"), nullable=False, index=True)
    
    # Scope of recalculation
    scope: Mapped[str] = mapped_column(String, nullable=False)
    # ^ "new_only", "open_orders", "unfulfilled", "all_orders", "specific_orders"
    
    # Specific order IDs (if scope = specific_orders)
    specific_order_ids: Mapped[list | None] = mapped_column(JSON, nullable=True)
    
    # Status tracking
    status: Mapped[str] = mapped_column(String, default="pending", index=True)
    # ^ "pending", "running", "completed", "failed", "cancelled"
    
    # Progress
    total_orders: Mapped[int | None] = mapped_column(Integer, nullable=True)
    processed_orders: Mapped[int | None] = mapped_column(Integer, nullable=True)
    failed_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    
    # Timing
    started_at: Mapped[str | None] = mapped_column(String, nullable=True)
    completed_at: Mapped[str | None] = mapped_column(String, nullable=True)
    
    # Error tracking
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_details: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    
    # Audit
    triggered_by: Mapped[str | None] = mapped_column(String, nullable=True)
    # ^ User ID or "system"
    
    # Relationships
    shop: Mapped["Shop"] = relationship("Shop")
    rule: Mapped["FieldTransformRule"] = relationship("FieldTransformRule", back_populates="recalculation_jobs")
```

### 2.5 EntityRelationship (Schema Definition)

```python
class EntityRelationship(Base, TimestampMixin):
    """
    Defines navigable relationships between entities.
    Used for auto-path inference and available in manual path editor.
    """
    __tablename__ = "entity_relationships"
    
    id: Mapped[str] = mapped_column(String, primary_key=True, default=gen_uuid)
    
    # Relationship definition
    from_entity: Mapped[str] = mapped_column(String, nullable=False, index=True)
    to_entity: Mapped[str] = mapped_column(String, nullable=False, index=True)
    
    # How to traverse
    via_field: Mapped[str] = mapped_column(String, nullable=False)
    # ^ Field on from_entity that contains to_entity's ID
    # Example: from_entity="line_item", via_field="variant_id" → to_entity="variant"
    
    # Reverse relationship (optional)
    reverse_via: Mapped[str | None] = mapped_column(String, nullable=True)
    # ^ For one-to-many: field on to_entity that references from_entity
    # Example: reverse_via="order_id" for line_item → order
    
    # Metadata
    relationship_type: Mapped[str] = mapped_column(String, default="many_to_one")
    # ^ "one_to_one", "many_to_one", "one_to_many", "many_to_many"
    
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    
    # Default system relationships (seeded)
    is_system: Mapped[bool] = mapped_column(Boolean, default=True)
```

**Default Relationships (seeded on install):**

```python
DEFAULT_RELATIONSHIPS = [
    # Down the hierarchy (many-to-one)
    {"from": "line_item", "to": "variant", "via": "variant_id", "type": "many_to_one"},
    {"from": "variant", "to": "product", "via": "product_id", "type": "many_to_one"},
    {"from": "line_item", "to": "order", "via": "order_id", "type": "many_to_one"},
    {"from": "order", "to": "customer", "via": "customer_id", "type": "many_to_one"},
    
    # Up the hierarchy (one-to-many)
    {"from": "order", "to": "line_item", "via": "id", "reverse_via": "order_id", "type": "one_to_many"},
    {"from": "product", "to": "variant", "via": "id", "reverse_via": "product_id", "type": "one_to_many"},
    {"from": "variant", "to": "line_item", "via": "id", "reverse_via": "variant_id", "type": "one_to_many"},
    {"from": "customer", "to": "order", "via": "id", "reverse_via": "customer_id", "type": "one_to_many"},
]
```

---

## 3. Execution Engine

### 3.1 Dependency Resolution

```python
class RuleExecutionGraph:
    """
    Builds and executes the dependency graph for field transforms.
    """
    
    def build_execution_order(self, rules: list[FieldTransformRule]) -> list[list[FieldTransformRule]]:
        """
        Returns rules grouped by execution level (parallelizable groups).
        Level 0: No dependencies
        Level 1: Depends only on Level 0
        etc.
        """
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
    
    def compute_for_entity(self, entity_type: str, entity_id: str, db: Session) -> dict:
        """
        Compute all derived fields for a single entity instance.
        """
        # Get all active rules for this entity
        rules = db.query(FieldTransformRule).filter(
            FieldTransformRule.output_entity == entity_type,
            FieldTransformRule.is_active == True
        ).all()
        
        # Build execution order
        levels = self.build_execution_order(rules)
        
        # Results accumulator
        computed = {}
        
        for level in levels:
            for rule in level:
                # Resolve source value
                source_value = self._resolve_source(
                    entity_type, entity_id, rule, computed, db
                )
                
                # Apply transform
                result = apply_transform(
                    source_value, 
                    rule.transform_type, 
                    rule.transform_config
                )
                
                # Store
                computed[rule.output_field_key] = result
                
                # Persist to DerivedFieldValue
                self._persist_value(rule, entity_type, entity_id, result, db)
        
        return computed
    
    def _resolve_source(self, entity_type: str, entity_id: str, rule: FieldTransformRule, 
                       computed: dict, db: Session) -> Any:
        """
        Resolve the source value, traversing relationships if needed.
        """
        current_entity = entity_type
        current_id = entity_id
        
        # Follow path if needed
        path = rule.source_path or []
        for step in path:
            # Get relationship
            rel = db.query(EntityRelationship).filter_by(
                from_entity=current_entity,
                to_entity=step["entity"]
            ).first()
            
            if not rel:
                raise MissingRelationshipError(f"No path from {current_entity} to {step['entity']}")
            
            # Traverse
            current_entity = step["entity"]
            current_id = self._fetch_related_id(current_entity, current_id, rel, db)
            
            if not current_id:
                return None  # Missing relationship
        
        # Now at the source entity, fetch the field
        if rule.source_field.startswith("computed."):
            # Computed field - get from accumulator
            key = rule.source_field.replace("computed.", "")
            return computed.get(key)
        
        elif rule.source_field.startswith("metafields."):
            # Metafield - fetch from native storage
            meta_key = rule.source_field.replace("metafields.", "")
            return self._fetch_metafield(current_entity, current_id, meta_key, db)
        
        else:
            # Native field - fetch from entity
            return self._fetch_native_field(current_entity, current_id, rule.source_field, db)
```

### 3.2 Recalculation Triggers

```python
class RecalculationManager:
    """
    Manages when and how to recalculate derived fields.
    """
    
    def on_rule_created(self, rule: FieldTransformRule, db: Session):
        """
        New rule created - queue recalculation based on mode.
        """
        job = RecalculationJob(
            shop_id=rule.shop_id,
            trigger_type="rule_created",
            rule_id=rule.id,
            scope=self._mode_to_scope(rule.recalculation_mode),
            status="pending"
        )
        db.add(job)
        db.commit()
        
        # Queue background job
        self._enqueue_job(job.id)
    
    def on_rule_updated(self, rule: FieldTransformRule, db: Session):
        """
        Rule changed - may need recalculation.
        """
        # Invalidate existing values
        db.query(DerivedFieldValue).filter_by(rule_id=rule.id).update({
            "is_stale": True
        })
        
        # Queue new job
        self.on_rule_created(rule, db)  # Same logic
    
    def on_source_changed(self, entity_type: str, entity_id: str, 
                          changed_fields: list[str], db: Session):
        """
        Source data changed (webhook, manual edit, etc.).
        Find affected rules and mark values stale.
        """
        # Find rules that source from these fields
        affected_rules = db.query(FieldTransformRule).filter(
            FieldTransformRule.source_entity == entity_type,
            FieldTransformRule.source_field.in_(changed_fields),
            FieldTransformRule.is_active == True,
            FieldTransformRule.auto_recalc_on_source_change == True
        ).all()
        
        for rule in affected_rules:
            # Mark derived values as stale for this entity
            db.query(DerivedFieldValue).filter_by(
                rule_id=rule.id,
                entity_id=entity_id
            ).update({"is_stale": True})
            
            # If rule has dependents, cascade staleness
            self._cascade_staleness(rule, db)
    
    def _cascade_staleness(self, rule: FieldTransformRule, db: Session):
        """
        Mark all dependent rules' values as stale.
        """
        dependents = db.query(FieldTransformRule).filter(
            FieldTransformRule.depends_on.contains([rule.output_field_key])
        ).all()
        
        for dep in dependents:
            db.query(DerivedFieldValue).filter_by(
                rule_id=dep.id
            ).update({"is_stale": True})
            
            # Recurse for deeper dependencies
            self._cascade_staleness(dep, db)
    
    def _mode_to_scope(self, mode: str) -> str:
        mapping = {
            "new_only": "new_only",
            "new_and_open": "open_orders",
            "new_and_unfulfilled": "unfulfilled",
            "new_and_all": "all_orders",
            "immediate_all": "all_orders"
        }
        return mapping.get(mode, "new_only")
```

---

## 4. API Endpoints

### 4.1 Rule Management

```python
# List all rules with their dependencies
GET /api/data-studio/rules
Response: {
    "rules": [
        {
            "id": "uuid",
            "name": "Extract Section",
            "source": {
                "entity": "variant",
                "field": "metafields.custom.bin_number",
                "path": [{"entity": "variant", "via": "variant_id", "inferred": true}]
            },
            "transform": {"type": "extract", "config": {...}},
            "output": {"entity": "line_item", "field": "bin_section"},
            "execution": {"run_order": 0, "depends_on": []},
            "recalculation": {"mode": "new_and_all", "auto_recalc": true},
            "status": "active"
        }
    ],
    "execution_graph": [["rule1", "rule2"], ["rule3"]]  # Grouped by level
}

# Create new rule
POST /api/data-studio/rules
Body: {
    "name": "Extract Section",
    "source_entity": "variant",
    "source_field": "metafields.custom.bin_number",
    "source_path": [...],  # Optional manual override
    "transform_type": "extract",
    "transform_config": {"pattern": "^([A-Za-z]+)", "group": 1},
    "output_entity": "line_item",
    "output_field_key": "bin_section",
    "output_field_label": "Bin Section",
    "depends_on": [],  # References other output_field_keys
    "recalculation_mode": "new_and_all"
}

# Get single rule with preview data
GET /api/data-studio/rules/{id}?preview=true&sample_size=10
Response: {
    "rule": {...},
    "preview": {
        "source_samples": [
            {"entity_id": "li_123", "source_value": "A5C", "computed": "A"}
        ],
        "dependencies": ["rule_id_1", "rule_id_2"],
        "dependents": ["rule_id_3"]
    }
}

# Update rule
PUT /api/data-studio/rules/{id}
Body: {...}
# Triggers recalculation based on recalculation_mode

# Delete rule
DELETE /api/data-studio/rules/{id}
# Cascades to DerivedFieldValues

# Test transform without saving
POST /api/data-studio/rules/test
Body: {
    "source_entity": "variant",
    "source_field": "metafields.custom.bin_number",
    "transform_type": "extract",
    "transform_config": {...},
    "sample_ids": ["variant_1", "variant_2"]  # Optional
}
Response: {
    "results": [
        {"source": "A5C", "output": "A", "success": true},
        {"source": "B10D", "output": "B", "success": true}
    ]
}
```

### 4.2 Relationship & Path Resolution

```python
# Get auto-inferred path
GET /api/data-studio/path?
    from=line_item&
    to=variant&
    field=metafields.custom.bin_number
Response: {
    "path": [
        {"entity": "variant", "via": "variant_id", "inferred": true, "confidence": 1.0}
    ],
    "alternatives": [],
    "available_fields": ["sku", "price", "metafields.custom.*"]
}

# Validate custom path
POST /api/data-studio/path/validate
Body: {
    "path": [
        {"entity": "line_item", "field": "variant_id"},
        {"entity": "variant", "field": "product_id"},
        {"entity": "product", "field": "metafields.custom.category"}
    ]
}
Response: {
    "valid": true,
    "steps": [
        {"valid": true, "relationship": "many_to_one"},
        {"valid": true, "relationship": "many_to_one"},
        {"valid": true, "field_exists": true}
    ]
}

# Get available entities and fields
GET /api/data-studio/schema
Response: {
    "entities": {
        "order": {
            "native_fields": ["id", "name", "total_price", "created_at"],
            "computed_fields": ["sections"],
            "relationships": ["line_items", "customer"]
        },
        "line_item": {
            "native_fields": ["id", "sku", "quantity", "price"],
            "computed_fields": ["bin_section", "total_shipping_units"],
            "relationships": ["order", "variant"]
        },
        "variant": {
            "native_fields": ["id", "sku", "price"],
            "metafields": ["custom.bin_number", "custom.shipping_units"],
            "computed_fields": [],
            "relationships": ["product", "line_items"]
        }
    }
}
```

### 4.3 Recalculation Jobs

```python
# List jobs
GET /api/data-studio/jobs?status=running&rule_id=uuid
Response: {
    "jobs": [
        {
            "id": "uuid",
            "trigger_type": "rule_updated",
            "rule_name": "Extract Section",
            "scope": "all_orders",
            "status": "running",
            "progress": {"total": 1500, "processed": 750, "failed": 0},
            "started_at": "2026-05-25T10:00:00Z"
        }
    ]
}

# Get job details
GET /api/data-studio/jobs/{id}
Response: {
    "job": {...},
    "errors": [...],  # If failed
    "recent_logs": [...]
}

# Cancel job
POST /api/data-studio/jobs/{id}/cancel

# Trigger manual recalculation
POST /api/data-studio/rules/{id}/recalculate
Body: {
    "scope": "all_orders",  # Override rule's default mode
    "specific_orders": ["order_1", "order_2"]  # Optional
}
```

### 4.4 Derived Values (for debugging)

```python
# Get computed values for an entity
GET /api/data-studio/values?entity_type=order&entity_id=uuid
Response: {
    "entity_type": "order",
    "entity_id": "uuid",
    "values": {
        "sections": {
            "value": ["A", "B", "C"],
            "computed_at": "2026-05-25T10:00:00Z",
            "rule_id": "uuid",
            "is_stale": false
        }
    }
}

# Force refresh of stale values
POST /api/data-studio/values/refresh
Body: {"entity_type": "order", "entity_ids": ["uuid1", "uuid2"]}
```

---

## 5. UI Flow Design

### 5.1 Main Data Studio Page

```
┌─────────────────────────────────────────────────────────────────────┐
│  DATA STUDIO                                                    [?] │
├─────────────────────────────────────────────────────────────────────┤
│  [Transforms] [Fields] [Bundles] [SKU Rules] [Mystery] [Settings]   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  NEW TRANSFORM                                    [+ Create] │  │
│  │                                                              │  │
│  │  Active Rules (5)          Execution Graph →                 │  │
│  │  ┌─────────────────┐       ┌─────────┐ ┌─────────┐          │  │
│  │  │ • Bin Section   │──────▶│ Section │ │ Sections│          │  │
│  │  │ • Total Units   │       │  (LI)   │──▶│ (Order) │          │  │
│  │  │ • Package Type  │       └─────────┘   └─────────┘          │  │
│  │  │ • Country       │                                          │  │
│  │  │ • Sections      │       Dependency: Bin Section → Sections │  │
│  │  └─────────────────┘                                          │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  RECALCULATION JOBS                                         │  │
│  │  • Extract Section - Running (750/1500)         [Details]  │  │
│  │  • Total Units - Completed                       [Details]  │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.2 Transform Creation Flow (Step-by-Step Wizard)

#### Step 1: Select Output Location
```
┌─────────────────────────────────────────────────────────────────────┐
│  CREATE TRANSFORM                                           1 of 4  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Where should the new field be created?                              │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │
│  │   📦 ORDER   │  │  📋 LINE ITEM │  │  🏷️ VARIANT   │             │
│  │              │  │              │  │              │             │
│  │  Order-level │  │  Per-item    │  │  Product     │             │
│  │  fields      │  │  fields      │  │  catalog     │             │
│  └──────────────┘  └──────────────┘  └──────────────┘             │
│                                                                     │
│  [Selected: LINE ITEM]                                              │
│                                                                     │
│  Field Key: [bin_section         ]  (machine name)                 │
│  Field Label: [Bin Section       ]  (display name)                 │
│  Field Type: [String ▼]                                            │
│                                                                     │
│  [Cancel]                              [Next: Select Source →]      │
└─────────────────────────────────────────────────────────────────────┘
```

#### Step 2: Select Source (with Smart Path)
```
┌─────────────────────────────────────────────────────────────────────┐
│  CREATE TRANSFORM                                           2 of 4  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Where does the data come from?                                      │
│                                                                     │
│  Starting from: LINE ITEM (where the output goes)                    │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  AUTO-DETECTED PATH                                          │  │
│  │                                                              │  │
│  │  line_item  ──►  variant  ──►  [Select Field ▼]            │  │
│  │    ↓               ↓                                         │  │
│  │  via:variant_id  via:product_id                              │  │
│  │  [✓ inferred]   [✓ inferred]                                 │  │
│  │                                                              │  │
│  │  [Change Path...]                                           │  │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  Available Fields on VARIANT:                                       │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  🔍 [Search fields...]                                       │  │
│  │                                                              │  │
│  │  Native Fields          Metafields                           │  │
│  │  ○ sku                  ● custom.bin_number  [A5C, B10D...] │  │
│  │  ○ price                ○ custom.shipping_units            │  │
│  │  ○ barcode              ○ custom.material                    │  │
│  │  ...                    ...                                 │  │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  Selected: variant.metafields.custom.bin_number                    │
│  [Preview 5 samples]                                                │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  SAMPLE DATA                                                 │  │
│  │  Variant ID    Bin Number                                    │  │
│  │  var_123       A5C                                           │  │
│  │  var_124       B10D                                          │  │
│  │  var_125       A1X                                           │  │
│  │  ...                                                         │  │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  [← Back]                              [Next: Transform →]          │
└─────────────────────────────────────────────────────────────────────┘
```

#### Step 3: Define Transform
```
┌─────────────────────────────────────────────────────────────────────┐
│  CREATE TRANSFORM                                           3 of 4  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  How should we transform: bin_number?                                │
│                                                                     │
│  Transform Type: [Extract Pattern ▼]                                 │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  EXTRACT PATTERN                                             │  │
│  │                                                              │  │
│  │  Pattern: [^([A-Za-z]+)                ]                     │  │
│  │          ↑ Extract leading letters                           │  │
│  │  Capture Group: [1 ▼]                                        │  │
│  │  Case Insensitive: [✓]                                      │  │
│  │  Default Value (if no match): [—            ]                │  │
│  │                                                              │  │
│  │  Common Patterns:                                            │  │
│  │  [First letters] [Numbers only] [After dash] [Custom...]    │  │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  LIVE PREVIEW                                                │  │
│  │                                                              │  │
│  │  Source (bin_number)  ──►  Output (bin_section)              │  │
│  │  A5C                         A                                │  │
│  │  B10D                        B                                │  │
│  │  A1X                         A                                │  │
│  │  C99Z                        C                                │  │
│  │  —                           — (default)                    │  │
│  │                                                              │  │
│  │  [Test with custom value: _____ ] [Test]                    │  │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  [← Back]                              [Next: Settings →]           │
└─────────────────────────────────────────────────────────────────────┘
```

#### Step 4: Recalculation Settings
```
┌─────────────────────────────────────────────────────────────────────┐
│  CREATE TRANSFORM                                           4 of 4  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  When should this transform apply?                                  │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  RECALCULATION MODE                                          │  │
│  │                                                              │  │
│  │  ○ New orders only                                           │  │
│  │    Only apply to orders created after this rule              │  │
│  │                                                              │  │
│  │  ● New orders + open/pending                                 │  │
│  │    Apply to new orders, and recalculate open orders          │  │
│  │                                                              │  │
│  │  ○ New orders + all unfulfilled                              │  │
│  │    Recalculate all orders that haven't shipped yet           │  │
│  │                                                              │  │
│  │  ○ New orders + all existing (queued)                      │  │
│  │    Recalculate everything in background                      │  │
│  │                                                              │  │
│  │  ○ All orders immediately (blocking)                         │  │
│  │    Only for small datasets (< 1000 orders)                   │  │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  SOURCE CHANGE HANDLING                                      │  │
│  │                                                              │  │
│  │  [✓] Auto-recalculate when source metafield changes          │  │
│  │       If bin_number changes in Shopify, update bin_section    │  │
│  │                                                              │  │
│  │  [ ] Propagate changes to dependent rules                    │  │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  EXECUTION ORDER                                             │  │
│  │                                                              │  │
│  │  This transform will run at position: 0 (first)              │  │
│  │                                                              │  │
│  │  Dependencies: None (doesn't depend on other computed fields) │  │
│  │                                                              │  │
│  │  [+ Add dependency]                                          │  │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  [← Back]                              [Save & Apply]              │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.3 Manual Path Editor (Modal)
```
┌─────────────────────────────────────────────────────────────────────┐
│  EDIT RELATIONSHIP PATH                                       [×]   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Define how to navigate from LINE ITEM to your source data.         │
│                                                                     │
│  Path Steps:                                                         │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  1. line_item (starting point)                               │  │
│  │     ↓                                                         │  │
│  │  2. variant  via: variant_id  [✓ Valid]  [Change ▼]          │  │
│  │     ↓                                                         │  │
│  │  3. product  via: product_id  [✓ Valid]                      │  │
│  │                                                              │  │
│  │  [+ Add Step]  [Reset to Auto-detected]                      │  │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  Available Relationships from PRODUCT:                               │
│  ○ vendor (many_to_one)                                            │
│  ○ line_items (one_to_many) ← Can't go here, creates loop          │
│                                                                     │
│  [Cancel]                                      [Apply Path]        │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.4 Aggregate Transform (Order-Level)
```
┌─────────────────────────────────────────────────────────────────────┐
│  CREATE TRANSFORM - AGGREGATE                                 3 of 4  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Aggregate values from LINE ITEMS into ORDER field "sections"        │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  AGGREGATION CONFIGURATION                                   │  │
│  │                                                              │  │
│  │  Source Entity: line_item (child of order)                   │  │
│  │  Source Field: [bin_section ▼]  ← Computed field             │  │
│  │                                                              │  │
│  │  Operation: [Unique Concatenation ▼]                         │  │
│  │  • unique_concat - Join unique values                        │  │
│  │  • concat - Join all values                                  │  │
│  │  • count - Count occurrences                                 │  │
│  │  • sum - Sum numeric values                                  │  │
│  │                                                              │  │
│  │  Delimiter: [, ▼]                                           │  │
│  │  Sort Order: [A-Z ▼]                                        │  │
│  │                                                              │  │
│  │  Filter (optional): [Only include if ____ ▼] [≠] [____]     │  │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  PREVIEW (Sample Order: #1001)                               │  │
│  │                                                              │  │
│  │  Line Items in Order:                                        │  │
│  │  • Widget A  → bin_section: A                                │  │
│  │  • Widget B  → bin_section: B                                │  │
│  │  • Gadget C  → bin_section: A  (duplicate)                     │  │
│  │  • Thing D   → bin_section: C                                │  │
│  │                                                              │  │
│  │  Output (sections): "A, B, C"  (unique + sorted)           │  │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ⚠️ This transform depends on: bin_section                           │
│  That rule must execute before this one.                            │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 6. Background Worker (Celery/RQ)

```python
# tasks.py

from celery import Celery
from sqlalchemy.orm import Session

app = Celery('data_studio')

@app.task(bind=True, max_retries=3)
def process_recalculation_job(self, job_id: str):
    """
    Background task to recalculate derived fields.
    """
    db = Session()
    
    try:
        job = db.query(RecalculationJob).get(job_id)
        if not job or job.status != "pending":
            return
        
        job.status = "running"
        job.started_at = datetime.utcnow().isoformat()
        db.commit()
        
        # Get the rule
        rule = db.query(FieldTransformRule).get(job.rule_id)
        
        # Determine orders to process
        orders = get_orders_for_scope(job.scope, job.specific_order_ids, db)
        job.total_orders = len(orders)
        db.commit()
        
        # Process in batches
        batch_size = 100
        for i in range(0, len(orders), batch_size):
            batch = orders[i:i + batch_size]
            
            for order in batch:
                try:
                    # Compute for this order and its children
                    compute_derived_fields_for_order(order.id, rule, db)
                    job.processed_orders += 1
                except Exception as e:
                    job.failed_count += 1
                    logger.error(f"Failed to process order {order.id}: {e}")
                
                # Update progress every 10 orders
                if job.processed_orders % 10 == 0:
                    db.commit()
            
            # Self-report progress for monitoring
            self.update_state(
                state='PROGRESS',
                meta={
                    'current': job.processed_orders,
                    'total': job.total_orders,
                    'failed': job.failed_count
                }
            )
        
        job.status = "completed"
        job.completed_at = datetime.utcnow().isoformat()
        db.commit()
        
    except Exception as e:
        job.status = "failed"
        job.error_message = str(e)
        db.commit()
        raise self.retry(exc=e, countdown=60)
    
    finally:
        db.close()

def get_orders_for_scope(scope: str, specific_ids: list, db: Session):
    """Query orders based on recalculation scope."""
    query = db.query(Order)
    
    if scope == "new_only":
        # Return empty - new orders handled at ingestion
        return []
    
    elif scope == "open_orders":
        return query.filter(Order.status.in_(["pending", "open"])).all()
    
    elif scope == "unfulfilled":
        return query.filter(
            Order.fulfillment_status.in_(["unfulfilled", "partial"])
        ).all()
    
    elif scope == "all_orders":
        return query.all()
    
    elif scope == "specific_orders":
        return query.filter(Order.id.in_(specific_ids)).all()
    
    return []

def compute_derived_fields_for_order(order_id: str, rule: FieldTransformRule, db: Session):
    """
    Apply a rule to an order and its line items.
    """
    graph = RuleExecutionGraph()
    
    if rule.output_entity == "order":
        # Compute for order
        graph.compute_for_entity("order", order_id, db)
    
    elif rule.output_entity == "line_item":
        # Compute for all line items in order
        line_items = db.query(OrderLineItem).filter_by(order_id=order_id).all()
        for li in line_items:
            graph.compute_for_entity("line_item", li.id, db)
```

---

## 7. Integration Points

### 7.1 Order Ingestion Pipeline

```python
# When new order comes in from Shopify webhook:

def ingest_order(shopify_order: dict, shop_id: str):
    # 1. Save raw data (Layer A)
    order = save_shopify_order(shopify_order, shop_id)
    
    # 2. Get active rules for this shop
    rules = get_active_rules(shop_id)
    
    # 3. Build execution graph
    graph = RuleExecutionGraph()
    levels = graph.build_execution_order(rules)
    
    # 4. Compute derived fields in dependency order
    for level in levels:
        for rule in level:
            if rule.output_entity == "order":
                graph.compute_for_entity("order", order.id, db)
            elif rule.output_entity == "line_item":
                for li in order.line_items:
                    graph.compute_for_entity("line_item", li.id, db)
    
    # 5. Order is now ready with all derived fields populated
```

### 7.2 Orders API Response

```python
# GET /api/orders/{id}

{
    "id": "order_123",
    "shopify_order_id": "123456",
    "name": "#1001",
    
    # Native fields (Layer A)
    "total_price": "99.99",
    "created_at": "2026-05-25T10:00:00Z",
    
    # Computed fields (Layer B)
    "_derived": {
        "sections": ["A", "B", "C"],
        "total_shipping_units": 5.5,
        "package_type": "BOX_LARGE"
    },
    
    "line_items": [
        {
            "id": "li_456",
            "sku": "WIDGET-A",
            "quantity": 2,
            
            # Computed fields (Layer B)
            "_derived": {
                "bin_section": "A",
                "total_shipping_units": 3.0
            },
            
            # Linked variant data
            "variant": {
                "id": "var_789",
                "sku": "WIDGET-A",
                "metafields": {
                    "custom": {
                        "bin_number": "A5C"
                    }
                }
            }
        }
    ]
}
```

---

## 8. Migration Strategy

### From Current `FieldTransformRule` to New Model

```python
# Alembic migration

def upgrade():
    # 1. Add new columns to field_transform_rules
    op.add_column('field_transform_rules', sa.Column('source_path', sa.JSON(), nullable=True))
    op.add_column('field_transform_rules', sa.Column('output_field_type', sa.String(), default='string'))
    op.add_column('field_transform_rules', sa.Column('depends_on', sa.JSON(), nullable=True))
    op.add_column('field_transform_rules', sa.Column('recalculation_mode', sa.String(), default='new_only'))
    op.add_column('field_transform_rules', sa.Column('auto_recalc_on_source_change', sa.Boolean(), default=True))
    
    # 2. Create new tables
    op.create_table('derived_field_values', ...)
    op.create_table('recalculation_jobs', ...)
    op.create_table('entity_relationships', ...)
    
    # 3. Seed entity relationships
    for rel in DEFAULT_RELATIONSHIPS:
        op.execute(
            """INSERT INTO entity_relationships (id, from_entity, to_entity, via_field, relationship_type, is_system)
               VALUES (gen_uuid(), %(from)s, %(to)s, %(via)s, %(type)s, true)""",
            rel
        )
    
    # 4. Migrate existing rules - infer source_path from source_entity
    # (e.g., if source_entity was 'variant' and output was 'line_item', create path via variant_id)
    op.execute("""
        UPDATE field_transform_rules 
        SET source_path = CASE
            WHEN source_entity = output_entity THEN '[]'::jsonb
            WHEN source_entity = 'variant' AND output_entity = 'line_item' 
                THEN '[{"entity": "variant", "via": "variant_id", "inferred": true}]'::jsonb
            WHEN source_entity = 'product' AND output_entity = 'line_item'
                THEN '[{"entity": "variant", "via": "variant_id", "inferred": true}, 
                       {"entity": "product", "via": "product_id", "inferred": true}]'::jsonb
            ELSE '[]'::jsonb
        END
    """)
```

---

## 9. Summary

### What We Built

1. **Layered Storage**: Raw Shopify data (Layer A) + Computed derived values (Layer B)
2. **Relationship Traversal**: Auto-inferred paths with manual override capability
3. **Dependency Graph**: Topological execution order for chained transforms
4. **Lifecycle Management**: Four recalculation modes from "new only" to "immediate all"
5. **Background Jobs**: Async recalculation with progress tracking
6. **Smart UI**: Step-by-step wizard with live preview and sample data

### Key Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `backend/app/models/fulfillment.py` | Modify | Add new columns to `FieldTransformRule`, create `DerivedFieldValue`, `RecalculationJob`, `EntityRelationship` |
| `backend/app/utils/rule_engine.py` | Modify | Add `RuleExecutionGraph`, `RecalculationManager`, enhanced `apply_transform` |
| `backend/app/routers/data_studio.py` | Create | New unified router for rules, paths, jobs, values |
| `frontend/src/app/data-studio/` | Modify | Enhanced UI with wizard, preview, dependency graph |
| `alembic/versions/` | Create | Migration for new tables and columns |

---

*End of Data Studio Architecture Document*

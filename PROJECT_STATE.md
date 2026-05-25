# OMS Project – State & Handoff Document

> **Last Updated:** 2026-05-25
> **Stage:** Phase 3 – Rule Engine, Data Studio, User Management

---

## Current Goal

Build a lightweight, scalable OMS (Order Management System) as an internal tool, designed from day one to become a multi-tenant Shopify App Store app. Core focus: ingest Shopify orders, apply business rules, make fulfillment decisions.

---

## Infrastructure

| Item              | Detail                        |
|-------------------|-------------------------------|
| VPS Provider      | DigitalOcean                  |
| Server IP         | `198.199.89.52`               |
| OS                | Ubuntu 24.04 LTS              |
| Size              | 1 vCPU / 2 GB RAM / Basic SSD |
| SSH               | `ssh root@198.199.89.52`      |
| SSH Auth          | Key-based (configured)        |
| Repo on server    | `/srv/oms`                    |
| GitHub            | `SmazSupport/ShopifyOMS`      |

---

## Tech Stack

| Layer            | Technology                        |
|------------------|-----------------------------------|
| Backend          | Python 3.11 + FastAPI (async)     |
| ORM              | SQLAlchemy 2.0 + Alembic          |
| Database         | PostgreSQL                        |
| Frontend         | Next.js 14 + React + TypeScript   |
| Styling          | TailwindCSS                       |
| Auth             | JWT (python-jose)                 |
| Containerization | Docker + Docker Compose           |

---

## Deploy Workflow

```bash
# Local: commit and push
git add -A; git commit -m "message"; git push

# Server: pull and rebuild
ssh root@198.199.89.52 "cd /srv/oms && git pull && docker compose up -d --build"
```

---

## Services (Docker Compose)

| Service  | Port   | Status         |
|----------|--------|----------------|
| backend  | 8000   | ✅ Running      |
| frontend | 3000   | ✅ Running      |
| postgres | 5432   | ✅ Running      |
| redis    | —      | Planned        |
| worker   | —      | Planned        |
| nginx    | 80/443 | Planned        |

---

## Project Directory Structure

```
OMS/
├── PROJECT_STATE.md              ← This file
├── docker-compose.yml
├── .env / .env.example
│
├── backend/
│   ├── app/
│   │   ├── main.py               ← FastAPI app + router registration
│   │   ├── database.py           ← Async SQLAlchemy engine
│   │   ├── models/
│   │   │   ├── __init__.py       ← Registers all models for Alembic
│   │   │   ├── shop.py           ← Shop (tenant)
│   │   │   ├── shopify.py        ← Shopify mirror: Order, LineItem, Product, Variant, Customer
│   │   │   ├── fulfillment.py    ← Rule models: FieldTransformRule, BundleRule, MysteryRule, SkuRule
│   │   │   │                       Custom fields: CustomFieldDefinition, MetafieldMapping
│   │   │   │                       Fulfillment: OmsOrder, FulfillmentGroup, FulfillmentLine
│   │   │   └── user.py           ← User (auth)
│   │   ├── routers/
│   │   │   ├── auth.py           ← /auth — login, me, change-password
│   │   │   ├── orders.py         ← /orders — list with pagination, search, filters
│   │   │   ├── products.py       ← /products — list with variants
│   │   │   ├── fields.py         ← /fields — custom field definitions + metafield mappings
│   │   │   ├── rules.py          ← /rules — CRUD for all 4 rule types + preview
│   │   │   ├── settings.py       ← /settings — field visibility, column prefs
│   │   │   └── users.py          ← /users — user management (superuser only)
│   │   └── utils/
│   │       ├── auth.py           ← JWT helpers, get_current_user
│   │       ├── rule_engine.py    ← apply_transform, explode_bundles, apply_mystery_rules
│   │       └── seed.py           ← Dev seed data (run manually)
│   └── alembic/                  ← DB migrations
│
└── frontend/
    └── src/app/
        ├── page.tsx              ← / status dashboard
        ├── login/                ← /login
        ├── orders/               ← /orders — column chooser, computed fields, expandable line items
        ├── products/             ← /products
        ├── data-studio/          ← /data-studio — unified Fields + Transforms + Bundles + SKU Rules + Mystery
        ├── fields/               ← redirects → /data-studio?tab=fields
        ├── rules/                ← redirects → /data-studio?tab=transforms
        ├── settings/fields/      ← redirects → /data-studio?tab=field-settings
        ├── users/                ← /users — user management (superuser only)
        └── profile/              ← /profile — account info + change password
```

---

## Data Model Layers

### Layer 1 — Shopify Mirror
`shops`, `orders`, `order_line_items`, `customers`, `customer_addresses`, `products`, `product_variants`, `fulfillments`, `fulfillment_orders`, `webhook_log`

### Layer 2 — OMS Rule/Config
| Model | Purpose |
|---|---|
| `FieldTransformRule` | Compute a new field from an existing one (regex, split, formula, etc.) |
| `BundleRule` | Define child SKUs for a parent bundle SKU |
| `MysteryRule` | Substitution rules for mystery/surprise SKUs |
| `SkuRule` | Per-SKU flags: ships_alone, preorder, hold, etc. |
| `CustomFieldDefinition` | Define custom app fields per entity type |
| `MetafieldMapping` | Map Shopify metafield keys to custom fields |

### Layer 3 — OMS Fulfillment Decisions
`oms_orders`, `fulfillment_groups`, `fulfillment_lines`, `holds`

### Layer 4 — Warehouse Execution
`inventory_items / sku_master`, `bin_locations`, `shipments`, `packages`

---

## API Endpoints

| Router | Prefix | Key Endpoints |
|---|---|---|
| auth | `/auth` | POST /login, GET /me, POST /change-password |
| orders | `/orders` | GET / (paginated, search, status filter) |
| products | `/products` | GET / (paginated, search, with variants) |
| fields | `/fields` | CRUD custom fields + metafield mappings |
| rules | `/rules` | CRUD /transforms /bundles /mystery /sku + POST /preview |
| settings | `/settings` | GET/PUT column prefs, GET/PUT field visibility |
| users | `/users` | CRUD (superuser only) |

---

## Frontend Pages

| Route | Status | Notes |
|---|---|---|
| `/` | ✅ Live | System status dashboard |
| `/login` | ✅ Live | JWT auth |
| `/orders` | ✅ Live | Column chooser, computed field columns (⚡), expandable line items |
| `/products` | ✅ Live | Product + variant table |
| `/data-studio` | ✅ Live | Unified: Fields, Transforms, Bundles, SKU Rules, Mystery tabs |
| `/users` | ✅ Live | Superuser-only user management |
| `/profile` | ✅ Live | Account info + change password |
| `/fields` | ✅ Live | Redirects → `/data-studio?tab=fields` |
| `/rules` | ✅ Live | Redirects → `/data-studio?tab=transforms` |
| `/settings/fields` | ✅ Live | Redirects → `/data-studio?tab=field-settings` |

---

## Admin Credentials (Dev)

| Field | Value |
|---|---|
| Email | `admin@oms.local` |
| Password | `Admin123` |

---

## Pending Work

| ID | Task | Priority |
|---|---|---|
| rule-10 | Wire computed field values into Orders API response | Medium |
| 11 | Update seed data with SKU rules, bundle rules, field transforms | Medium |

---

## Key Design Decisions

| Date | Decision |
|---|---|
| 2026-05-24 | Single VPS (DigitalOcean), Docker Compose, no K8s |
| 2026-05-24 | PostgreSQL — relational model better for orders |
| 2026-05-24 | No PDFs/files in DB — local temp storage now, S3/R2 later |
| 2026-05-24 | Pagination on all list endpoints (default 50) |
| 2026-05-25 | Unified "Data Studio" replaces /fields, /rules, /settings/fields |
| 2026-05-25 | Computed fields (FieldTransformRules) surface as ⚡ columns in Orders table |
| 2026-05-25 | User model has no shop_id — single-tenant fallback via get_shop_id() helper |
| 2026-05-25 | All IDE TypeScript lint errors are false positives (missing node_modules locally) — Docker builds clean |

---

## Not In Scope Yet

- Shopify webhook ingestion (orders/create, orders/updated)
- EasyPost / shipping label generation
- Preorder / backorder rules (deferred)
- Redis + Celery background workers
- Nginx reverse proxy / SSL
- Multi-tenant isolation (shop_id on User model)

---

## Data Studio Architecture (v2)

> Complete technical spec for derived field system. Full details in `docs/data_studio_architecture.md`

### Core Concepts

**Two-Layer Storage:**
- **Layer A** — Raw Shopify Data (untouchable source of truth)
- **Layer B** — Derived Field Values (computed, can be rebuilt)

**Entity Hierarchy:**
```
Order
├── LineItem ──► Variant ──► Product
│     └── metafields          └── metafields
│     └── computed_fields     └── computed_fields
├── Customer
└── computed_fields (order-level)
```

### New/Enhanced Models

| Model | Purpose | Key Fields |
|-------|---------|------------|
| `FieldTransformRule` (enhanced) | Defines how to compute a derived field | `source_path`, `depends_on`, `recalculation_mode`, `auto_recalc_on_source_change` |
| `DerivedFieldValue` (new) | Stores computed values for fast reads | `entity_type`, `entity_id`, `value`, `is_stale`, `computed_at` |
| `RecalculationJob` (new) | Tracks background recalculation work | `scope`, `status`, `progress`, `trigger_type` |
| `EntityRelationship` (new) | Defines navigable paths between entities | `from_entity`, `to_entity`, `via_field`, `relationship_type` |

### Transform Types

**Single Value:** `extract`, `split`, `chars`, `formula`, `if_then`, `math`, `custom`
**Cross-Entity:** `lookup`
**Aggregation:** `aggregate` (unique_concat, concat, sum, count, etc.), `join`

### Recalculation Modes

| Mode | Behavior | Use Case |
|------|----------|----------|
| `new_only` | New orders only | Bundle rules that shouldn't touch history |
| `new_and_open` | New + open/pending orders | Most transforms |
| `new_and_unfulfilled` | New + all unfulfilled | Shipping-related fields |
| `new_and_all` | New + all existing (queued) | Bin numbers when changed |
| `immediate_all` | All orders (blocking) | Small datasets only |

### Execution Engine

```
RuleExecutionGraph
├── build_execution_order() — Topological sort by dependencies
├── compute_for_entity() — Apply all rules to single entity
├── _resolve_source() — Traverse relationships if needed
└── _persist_value() — Store to DerivedFieldValue

RecalculationManager
├── on_rule_created() — Queue job based on mode
├── on_rule_updated() — Mark stale, queue job
├── on_source_changed() — Find affected rules, cascade staleness
└── _cascade_staleness() — Mark dependents for recalc
```

### Relationship Traversal

**Auto-Inferred:** System detects path via `EntityRelationship` seed data
**Manual Override:** User can edit path in "Change Path" modal
**Path Format:** `[{"entity": "variant", "via": "variant_id", "inferred": true}]`

### API Endpoints (Data Studio)

| Endpoint | Purpose |
|----------|---------|
| `GET /api/data-studio/rules` | List all rules with dependencies |
| `POST /api/data-studio/rules` | Create rule (triggers recalc job) |
| `GET /api/data-studio/rules/{id}?preview=true` | Get rule with sample preview data |
| `POST /api/data-studio/rules/test` | Test transform without saving |
| `GET /api/data-studio/path?from=X&to=Y` | Get auto-inferred path |
| `POST /api/data-studio/path/validate` | Validate custom path |
| `GET /api/data-studio/schema` | Get entities, fields, relationships |
| `GET /api/data-studio/jobs` | List recalculation jobs |
| `POST /api/data-studio/rules/{id}/recalculate` | Trigger manual recalc |
| `GET /api/data-studio/values` | Get computed values for entity |

### UI Flow (4-Step Wizard)

1. **Output Location** — Select entity (order/line_item/variant), define field key/label/type
2. **Select Source** — Pick source entity/field, auto-detect path, preview sample data
3. **Define Transform** — Choose transform type, configure parameters, live preview
4. **Recalculation Settings** — Set mode, source change handling, execution order

### Background Worker

Celery/RQ task `process_recalculation_job`:
- Processes orders in batches (100 at a time)
- Updates progress for monitoring
- Handles failures with retry logic
- Marks job complete/failed when done

### Dependency Resolution

Rules execute in topological order (Kahn's algorithm):
```
Level 0: Bin Section (no deps)
Level 1: Total Units (no deps)
Level 2: Sections (depends on Bin Section)
```

### Integration Points

- **Order Ingestion:** Compute derived fields after saving raw data
- **Orders API:** Include `_derived` object in response
- **Webhooks:** Trigger recalculation on source metafield changes
- **Manual Edit:** Queue job based on rule's recalculation_mode

### Migration Path

1. Add new columns to `FieldTransformRule` (source_path, depends_on, etc.)
2. Create `DerivedFieldValue`, `RecalculationJob`, `EntityRelationship` tables
3. Seed default entity relationships
4. Infer source_path for existing rules based on source/output entities
5. Backfill DerivedFieldValues for existing orders (optional, on-demand)

---

## File Changes Required

| File | Action |
|------|--------|
| `backend/app/models/fulfillment.py` | Add new models, enhance FieldTransformRule |
| `backend/app/utils/rule_engine.py` | Add RuleExecutionGraph, RecalculationManager |
| `backend/app/routers/data_studio.py` | Create new unified router |
| `backend/app/main.py` | Register data_studio router |
| `frontend/src/app/data-studio/` | Enhance UI with wizard, preview, dependency graph |
| `alembic/versions/` | Create migration for new tables/columns |
| `docs/data_studio_architecture.md` | Full technical specification |

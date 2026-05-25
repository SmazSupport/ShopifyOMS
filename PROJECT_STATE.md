# OMS Project – State & Handoff Document

> **Last Updated:** 2026-05-24
> **Stage:** Phase 1 – Infrastructure Setup & Scaffolding

---

## Current Goal

Build a lightweight, scalable OMS (Order Management System) for **The Woobles**, initially as an internal tool,
designed from day one to become a multi-tenant Shopify App Store app.

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

---

## Tech Stack

| Layer           | Technology              | Reason                                      |
|-----------------|-------------------------|---------------------------------------------|
| Backend         | Python + FastAPI        | Async, data processing, rule engine support |
| Frontend        | Next.js + React         | Fast UI, dashboard-friendly                 |
| Database        | PostgreSQL               | Relational, strong JSON/index support       |
| Containerization| Docker + Docker Compose | Consistent deploys from day one             |

---

## Project Directory Structure

```
OMS/
├── PROJECT_STATE.md          ← This file (always keep updated)
├── docker-compose.yml        ← All services wired here
├── .env.example              ← Environment variable template
├── .gitignore
│
├── backend/                  ← FastAPI Python app
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── alembic/              ← DB migrations
│   ├── app/
│   │   ├── main.py           ← FastAPI entry point
│   │   ├── config.py         ← Settings / env vars
│   │   ├── database.py       ← DB connection
│   │   ├── models/           ← SQLAlchemy models
│   │   ├── schemas/          ← Pydantic schemas
│   │   ├── routers/          ← API route handlers
│   │   ├── services/         ← Business logic
│   │   └── utils/            ← Helpers (rules engine, etc.)
│
├── frontend/                 ← Next.js app
│   ├── Dockerfile
│   ├── package.json
│   ├── next.config.js
│   └── src/
│       ├── app/              ← Next.js App Router pages
│       ├── components/       ← Shared UI components
│       ├── lib/              ← API clients, utilities
│       └── types/            ← TypeScript types
│
└── docker/                   ← Supplementary Docker configs
    ├── nginx/                ← Nginx reverse proxy (later)
    └── postgres/             ← DB init scripts
```

---

## Services (Docker Compose)

| Service    | Port  | Status        |
|------------|-------|---------------|
| backend    | 8000  | Scaffolded    |
| frontend   | 3000  | Scaffolded    |
| postgres   | 5432  | Configured    |
| redis      | 6379  | Planned       |
| worker     | –     | Planned       |
| nginx      | 80/443| Planned       |

---

## Server Setup Checklist (DigitalOcean Droplet)

### Done
- [x] Droplet created (Ubuntu 24.04)
- [x] SSH key added during setup

### Still Needed on Server
- [ ] SSH in and run initial hardening
- [ ] Create non-root deploy user (`adduser deploy`)
- [ ] Install Docker + Docker Compose
- [ ] Install Git
- [ ] Configure UFW firewall (allow 22, 80, 443)
- [ ] (Optional) Set up a domain / DNS pointing to `198.199.89.52`
- [ ] Clone this repo to `/srv/oms` on the server
- [ ] Set up `.env` from `.env.example` on server
- [ ] Run `docker compose up -d` for first time

### Server Commands (Run in order after SSH in)
```bash
# 1. Update packages
apt update && apt upgrade -y

# 2. Install Docker
curl -fsSL https://get.docker.com | sh

# 3. Install Docker Compose (plugin)
apt install docker-compose-plugin -y

# 4. Install Git
apt install git -y

# 5. Firewall
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw enable

# 6. Create deploy user (optional but recommended)
adduser deploy
usermod -aG docker deploy

# 7. Clone repo
mkdir -p /srv/oms
cd /srv/oms
git clone <YOUR_REPO_URL> .
```

---

## Core Data Models (Phase 1)

| Model         | Key Fields                                                      |
|---------------|-----------------------------------------------------------------|
| `Shop`        | id, tenant_id, shopify_domain, access_token, name              |
| `Order`       | id, shop_id, shopify_order_id, status, tags, created_at        |
| `LineItem`    | id, order_id, sku, quantity, variant_id, product_title         |
| `Product`     | id, shop_id, shopify_product_id, title, handle                 |
| `Variant`     | id, product_id, shopify_variant_id, sku, price                 |
| `Customer`    | id, shop_id, shopify_customer_id, email, name                  |
| `Rule`        | id, shop_id, name, conditions (JSON), actions (JSON), priority |

---

## Rule Engine Design

```
IF:
  - order contains SKU
  - shipping country matches
  - order tags match
  - order value >= threshold
  - is_wholesale / is_d2c flag

THEN:
  - assign shipping service
  - assign workflow
  - place hold
  - split order
  - choose packing slip template
  - choose picking workflow
```

Rules stored as structured JSON in PostgreSQL. Evaluated server-side on order ingestion.

---

## Multi-Tenant Strategy

- All tables include `shop_id` (and later `tenant_id`)
- Row-level data isolation enforced at the ORM/query layer
- Designed for eventual Shopify App Store submission

---

## File Handling

- **No PDFs/labels/images in PostgreSQL**
- Use local temp storage now
- Migrate to S3/Cloudflare R2 later

---

## Performance Commitments

- Pagination on all list endpoints (default page size: 50)
- Indexed filtering on `shop_id`, `status`, `created_at`, `tags`
- Background jobs for heavy processing (Celery + Redis, later)

---

## Current Phase: Phase 2

### Phase 1 — COMPLETE ✅
- [x] Define architecture
- [x] Create project structure + scaffolding
- [x] DigitalOcean server setup (Docker, Git, firewall)
- [x] GitHub repo connected (local + server on git pull workflow)
- [x] FastAPI backend running on port 8000
- [x] PostgreSQL with all 6 tables (shops, orders, line_items, products, variants, customers)
- [x] Alembic migrations applied
- [x] Next.js 15.3.8 frontend running on port 3000
- [x] /status endpoint + system dashboard live at http://198.199.89.52:3000

### Phase 2 — Next Up
- [ ] Order table UI (list view with pagination)
- [ ] Filtering + saved views
- [ ] Shopify webhook ingestion (orders/create, orders/updated)
- [ ] Seed data / test orders

**NOT in scope yet:**
- EasyPost integration
- Rule engine execution
- PDF/label generation
- Redis / background workers

---

## Notes / Decisions Log

| Date       | Decision                                                             |
|------------|----------------------------------------------------------------------|
| 2026-05-24 | Single VPS deployment for Phase 1. No K8s, no microservices.        |
| 2026-05-24 | Docker Compose from day one for deployment consistency.              |
| 2026-05-24 | PostgreSQL chosen over MongoDB — relational model better for orders. |
| 2026-05-24 | File storage stays out of DB — local for now, S3/R2 later.          |

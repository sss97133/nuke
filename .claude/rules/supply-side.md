---
paths:
  - "supabase/functions/**"
  - "scripts/**"
  - "src/**"
  - "docs/**"
---

# Supply Side Rules

## The Principle

The knowledge graph has two sides: **demand** (what the vehicle IS and NEEDS) and **supply** (what EXISTS to serve those needs). The product is in the join.

> "Every time an agent manually researches something that could have been a query, the system has failed."

## Rules

- When a conversation produces parts/supplier research, **seed the supply side** — don't let the research evaporate
- The supply side is NOT a parts store — it is a decoder ring for the parts market
- Suppliers are either **catalog** (scrapable products with SKUs) or **bespoke** (capability profiles, no SKUs) — model them differently
- Parts prices are **testimony with short half-lives** — always store `price_scraped_at` and treat stale prices as unreliable
- Fitment is **specification testimony** — manufacturer claims, not guaranteed truth. Track `confidence` and `source`
- Scrape from demand, not from supply — only catalog parts for vehicle segments we actually have in the database
- Gap computation is a SQL join, not an AI model — do not over-engineer it

## Tables

- `suppliers` — company registry (dozens of rows, mostly curated)
- `parts_catalog` — scraped products with specs JSONB (category-agnostic)
- `parts_fitment` — bridge table connecting parts to vehicle year/make/model/engine
- `supplier_capabilities` — capability profiles for bespoke builders

## Do NOT

- Create separate tables per parts category (no `alternator_catalog`, `brake_catalog`)
- Scrape entire vendor catalogs — scope to vehicles in our database
- Build e-commerce features (cart, checkout, order tracking)
- Build an AI recommendation engine — the computation is `ORDER BY idle_output DESC, price ASC`
- Create new edge functions for supplier data without checking TOOLS.md first

## Canonical Docs

- Contemplation: `docs/library/intellectual/contemplations/the-supply-side.md`
- Playbook: `docs/playbooks/SUPPLIER_INTELLIGENCE_PIPELINE.md`
- Technical spec: `docs/library/technical/engineering-manual/11-supply-side.md`

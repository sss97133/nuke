### Goal

Continuously collect **make + model taxonomy** from Exclusive Car Registry (ECR) and store it in Nuke as a lightweight “naming + counts + links” layer.

Primary entry points:
- `https://exclusivecarregistry.com/make`
- `https://exclusivecarregistry.com/make/<make_slug>`
- (derived) `https://exclusivecarregistry.com/model/<make_slug>/<model_slug>`

### What we store

- **`public.ecr_makes`**
  - `ecr_make_slug` (PK), `make_name`, `make_url`, `logo_url`
  - `model_count`, `car_count`
  - `is_active`, `first_seen_at`, `last_seen_at`

- **`public.ecr_models`**
  - `(ecr_make_slug, ecr_model_slug)` (composite PK)
  - `model_name`, `summary`, `variants_count`
  - `image_url` (thumbnail), `model_url`
  - `is_active`, `first_seen_at`, `last_seen_at`

Migration:
- `supabase/migrations/20260111090000_ecr_make_model_catalog.sql`

### Scraper

Script:
- `scripts/scrape-ecr-makes-models.ts`

It:
- Fetches `/make` once (594 makes currently)
- Optionally fetches each `/make/<slug>` and extracts hidden-but-present model rows:
  - `.model_list .car_item_line.model[data-info="<model_slug>"]`
- Writes a JSON artifact with full makes list and (optionally) models.
- Optionally upserts results into Supabase tables.

### Run locally (JSON only)

```bash
npm run --silent scrape:ecr -- --out data/json/ecr_makes_models.json --concurrency 1 --delay-ms 750
```

Notes:
- Keep **low concurrency** and a **delay** to be respectful.
- Caching is enabled; the default cache TTL is **24h**.

### Force-refresh cache

```bash
npm run --silent scrape:ecr -- --cache-ttl-hours 0 --out data/json/ecr_makes_models.json
```

### Upsert into Supabase

Requirements (env):
- `SUPABASE_URL` (or `VITE_SUPABASE_URL`)
- `SUPABASE_SERVICE_ROLE_KEY` (or `VITE_SUPABASE_SERVICE_ROLE_KEY`)

Command:

```bash
npm run --silent scrape:ecr -- --upsert-supabase --concurrency 1 --delay-ms 750
```

### Acceptance checks

- **JSON sanity**: `totals.makes` should match the `/make` page count.
- **Model URL correctness**: sample model should follow `/model/<make>/<model>` pattern.
- **DB sanity**:
  - `SELECT COUNT(*) FROM ecr_makes;`
  - `SELECT COUNT(*) FROM ecr_models;`
  - Spot check:
    - `SELECT * FROM ecr_models WHERE ecr_make_slug = '7x-design' ORDER BY model_name;`


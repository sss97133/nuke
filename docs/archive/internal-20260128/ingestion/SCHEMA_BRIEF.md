# LLM Schema Brief

This is the quick-reference packet we provide to mapping agents (Opus 4.5 or others) before they inspect a site. The only rule: **extract what the source exposes, place it in the correct field, and leave anything missing as `NULL`. Never guess.**

---

## Core Tables

### `businesses`
- Stores organization profiles (builders, brokers, suppliers, auction houses, service shops, etc.).
- Key fields: `id`, `business_name`, `website`, `description`, `email`, `phone`, `address`, `city`, `state`, `zip_code`, `business_type`, `metadata`.
- Use this when capturing company-level info (about pages, contact info, specialties, certifications).

### `vehicles`
- Canonical vehicle records (one row per VIN/vehicle profile).
- Key fields (fetch only what exists): `year`, `make`, `model`, `trim`, `vin`, `asking_price`, `discovery_url`, `platform_url`, `color`, `mileage`, `engine`, `transmission`, `drivetrain`, `body_style`, `condition_rating`, `notes`, `metadata`.
- Each field has optional `*_source` and `*_confidence` columns—set them when the site provides provenance.
- If the site lacks a field, leave it empty; do **not** synthesize values.

### `organization_vehicles`
- Links organizations to vehicles with a `relationship_type` (owner, seller, builder, upholsterer, etc.).
- Fields: `organization_id`, `vehicle_id`, `relationship_type`, `status`, `start_date`, `end_date`, `notes`.
- Use this when a site clearly ties a vehicle to a builder/vendor. Multiple relationships per vehicle are allowed.

### `vehicle_images`
- Stores image URLs + metadata for each vehicle.
- Fields: `vehicle_id`, `image_url`, `image_category`, `position`, `caption`, `is_primary`, plus duplicate-detection fields (`file_hash`, `perceptual_hash`, `dhash`), provenance (`source`, `source_url`), and AI status fields.
- Agents must target **only** the gallery that belongs to the subject vehicle. Capture include/exclude selectors and note pollution risks.

### `source_site_schemas`
- Stores DOM maps and extraction instructions per domain.
- Key columns:
  - `domain`, `site_name`, `site_type`
  - `schema_data` (JSON) – full mapping payload
  - `site_specialization`, `classification_confidence`
  - `image_include_selectors`, `image_exclude_selectors`, `pollution_notes`
  - `supplier_references`, `rarity_notes`, `schema_proposals`
  - Timestamps: `cataloged_at`, `last_verified_at`, `updated_at`
- `schema_data` should contain selectors for each field, image include/exclude rules, supplier references, and any site-specific structure notes. The JSON columns above provide quick-access summaries for orchestration. Review/approval steps live in [`SCHEMA_EVOLUTION.md`](./SCHEMA_EVOLUTION.md).

### `ingestion_jobs`
- Queue of agent runs (mapper, validator, extraction, schema_steward, image_qa, schema_proposal).
- Fields: `organization_id`, `site_url`, `job_type`, `status`, `priority`, `scheduled_for`, `payload`, `result`, timestamps.
- Agents claim jobs by flipping `status` from `queued` → `running` → `succeeded`/`failed`.

### `supplier_references`
- Stores mentions of suppliers/partners detected on source sites.
- Fields: `organization_id`, `ingestion_job_id`, `source_domain`, `source_url`, `supplier_name`, `supplier_domain`, `role`, `context_snippet`, `confidence`, `status`, `linked_organization_id`, `metadata`.
- Downstream agents use this table to create/link supplier org profiles.

### Other Relevant Tables
- `auction_listings`, `auction_bids`, `vehicle_offerings`, `organization_offerings`: used when sites expose transactional data (auctions, share offerings). Map only when those sections exist.
- `organization_images`, `business_timeline_events`, `supplier_references` (planned) capture broader organization context.

---

## Mapping Instructions for the LLM

1. **Classify the Site:** Identify whether it is a builder, OEM, broker, auction, service shop, supplier, etc. Note consumer similarities vs. structural differences.
2. **Field Mapping:** For each data point you see on the page, map it to the appropriate DB field. Provide CSS/DOM selectors, regex patterns, and fallback instructions. Include sample values for verification.
3. **Missing Data:** Explicitly note which DB fields are **not** present so downstream agents know the record is intentionally sparse.
4. **Supplier References:** If the page references partners (upholstery, engine builders, parts suppliers), capture the reference text + URL so we can correlate or create new org profiles later.
5. **Image Safeguards:** Identify the vehicle-specific gallery, list any surrounding marketing/hero carousels, and provide `include_selectors` / `exclude_selectors` so we avoid polluted image sets.
6. **Schema Proposals:** When the site exposes structured data we cannot store yet (custom build stages, fabrication specs, supplier contracts, etc.), propose new tables/columns. Include field names, types, relationships, and brief justifications.
7. **Confidence & Validation:** Every selector should include a confidence value (0-1) and a context note (e.g., “located under Specs tab”). This helps Validators decide whether to trust the map.

---

## Accuracy Rules

- Never infer or hallucinate data. If the VIN is missing, leave `vin` NULL.
- Record prices exactly as shown; note currency or units if ambiguous.
- Preserve unique data—even if only one builder exposes it—by proposing schema additions rather than discarding it.
- Prefer structured data sources (JSON-LD, microdata) when available, but always cross-check with page content to avoid vendor boilerplate.
- Document any anti-bot protections, lazy loaders, or API calls so we can plan fetch strategies.

This brief should accompany every mapping run so the LLM knows exactly how to align site content with our database (and how to request schema growth when needed).


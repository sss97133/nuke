## Vehicle Image Fact Fabric (VIFF) – Schema & Migration Plan

### Objectives
- **Single factual backbone** for every pixel that enters a vehicle profile so UI, AI, and commerce flows read from the same truth.
- **Guardrail-aware processing** that records which prompt set and questions produced each fact.
- **Confidence + audit loop** baked into the schema so valuations and financial products only run on trusted data.
- **Linkage-first design** to keep the dual timeline & user-contribution principle intact—facts always map back to timeline events and contributors.

---

### Core Tables

| Table | Purpose | Key Columns / Notes |
| --- | --- | --- |
| `vehicle_image_assets` | Canonical row per upload (raw media + capture context). | `id` UUID PK · `vehicle_id` FK · `storage_bucket` + `storage_path` · `source_type` (`upload`, `bat_import`, etc.) · `captured_at`, `uploaded_at`, `uploader_id`, `device_metadata`, `gps` (lat/lng/accuracy jsonb) · `area` (body zone), `angle`, `is_primary`, `original_hash` (dedupe) · `status` (`pending_processing`,`processed`,`archived`). |
| `vehicle_image_fact_batches` | Orchestrates each AI processing run. | `id` UUID PK · `vehicle_id` · `asset_ids` (uuid[]) · `guardrail_version` · `question_set_id` FK · `status` (`queued`,`running`,`failed`,`complete`) · `queued_by` (`system`/user id) · `processor` (`process-vehicle-images`) · `started_at`, `completed_at`, `error_log`. |
| `vehicle_image_facts` | Atomic fact derived from one or more assets. | `id` UUID PK · `vehicle_id` · `asset_id` FK (nullable for synthetic facts) · `batch_id` FK · `question_id` FK · `fact_type` (`component`,`damage`,`document`,`measurement`,`person`,`tool`,`instruction`) · `component_slug` (engine.intake) · `label`/`answer_text` · `numeric_value` + `units` · `bbox` jsonb (normalized coordinates) · `evidence_urls` text[] · `raw_response` jsonb · `ai_model` · `captured_from` (`image`,`text_overlay`) · `created_by` (system/user) · timestamps. |
| `image_fact_confidence` | Tracks confidence per fact & per consumer. | `fact_id` FK PK part · `consumer` enum (`valuation`,`timeline`,`commerce`,`safety`,`user_display`) · `score` 0-1 · `threshold` · `state` (`pending`,`approved`,`rejected`,`escalated`) · `reviewer_id` · `review_notes` · `locked_at`. |
| `image_fact_links` | Many-to-many bridge so every fact powers downstream artifacts. | `id` UUID PK · `fact_id` FK · `linked_table` (`timeline_events`,`vehicle_field_sources`,`vehicle_valuations_components`,`vehicle_documents`,`commerce_opportunities`) · `linked_id` UUID · `link_reason` (`auto`,`manual`,`ai_suggestion`) · `metadata` jsonb (example: `{"timeline_event_type":"documented_component"}`) · unique constraint on (`fact_id`,`linked_table`,`linked_id`). |
| `image_fact_questions` | Guardrail prompt registry. | `id` UUID PK · `slug` (e.g., `engine_leaks_v1`) · `version` semver · `vehicle_filters` jsonb (`{"make":["Ford"],"body_style":["truck"]}`) · `question_text` · `follow_up_prompts` jsonb[] · `required_fields` jsonb schema · `auto_actions` jsonb (what to do when answered). |
| `vehicle_fact_runs` | Second-pass AI scripts that summarize facts. | `id` UUID PK · `vehicle_id` · `batch_id` FK nullable · `run_type` (`confidence_qa`,`valuation_summary`,`commerce_script`) · `input_fact_ids` uuid[] · `output_summary` text · `structured_payload` jsonb · `confidence` integer · `script_version` · `ran_by` (function name) · `started_at`,`finished_at`. |
| `image_fact_reviews` | Explicit human review log. | `id` UUID PK · `fact_id` · `reviewer_id` · `decision` (`approve`,`reject`,`needs_more`) · `notes` · `source_view` (`FactExplorer`,`TimelineAudit`) · `created_at`. |

> **Dual timeline rule:** `image_fact_links` is mandatory for any timeline event generated from image AI. The helper that writes timeline events should accept `fact_id[]` so we always know which photo justified the event.

---

### Supporting Structures

- **Enums**
  - `image_fact_type`, `image_fact_consumer_state`, `image_fact_source_type`. Define once via canonical migration to keep RLS simple.
- **Indexes**
  - `vehicle_image_assets(vehicle_id, uploaded_at DESC)` for gallery performance.
  - `vehicle_image_facts(vehicle_id, fact_type)` and GIN index on `evidence_urls`.
  - `image_fact_confidence(fact_id, consumer)` unique.
  - `image_fact_links(linked_table, linked_id)` for joining from timeline/valuations back to facts.
  - `image_fact_questions(slug, version)` unique + `btree` on `(vehicle_filters->>'make')`.
- **RLS**
  - Mirror existing vehicle policies: owners & contributors can insert/update facts tied to their vehicle; viewers can select facts that link to public timeline events.
  - Service role-only insert on `vehicle_image_fact_batches` to ensure queue integrity; exposures happen via RPC.

---

### Migration Strategy

1. **Canonical migration**
   - Location: `/Users/skylar/nuke/supabase/migrations/20251119XXXXXX_viff_schema.sql`.
   - Contains full `CREATE TABLE/TYPE/INDEX` statements plus RLS policies.
   - Uses strict SQL (no IF NOT EXISTS) so we catch drift during deploys.

2. **Reset shim**
   - Location: `/Users/skylar/nuke/supabase/sql/shims/viff_schema.sql`.
   - Mirrors the canonical migration but wraps everything in `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `DO $$ BEGIN CREATE TYPE IF NOT EXISTS ... END $$;`.
   - Loaded inside `supabase/config.toml` `scripts.setup` pipeline so `supabase db reset` stays idempotent.

3. **Integration steps**
   - Update `supabase/sql/helpers/vehicle_profile_package.sql` (or equivalent RPC) to include VIFF aggregates.
   - Provide RPC helpers:
     - `enqueue_image_fact_batch(vehicle_id uuid, asset_ids uuid[])`.
     - `get_vehicle_image_facts(vehicle_id uuid, filters jsonb)`.
   - Ensure `timeline_event_service` writes `image_fact_links` when creating events derived from AI results.

---

### Next Actions
1. Author canonical migration + shim with tables/enums/indexes above.
2. Update Edge Function specs (`process-vehicle-images`, `vehicle-image-analyst`) to target the new tables.
3. Expose RPC endpoints so the frontend can:
   - Fetch facts + confidences in one call.
   - Trigger batch processing via `supabase.functions.invoke`.
4. Once schema is merged, proceed to Task 2 (pipeline + guardrail spec) and Task 3 (UI overhaul) using VIFF as the backbone.

With VIFF in place, every uploaded image gains a traceable lineage from raw bytes → AI guardrail questions → confidence scoring → timeline + valuations—unlocking the “fact backbone” required for trustworthy UI and financial flows.


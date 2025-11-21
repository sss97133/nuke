## VIFF Processing & Guardrail Pipeline

### Goals
- Make every upload flow deterministic: predictable prompts, retries, and audit trails.
- Keep ingestion fast for contributors while heavy AI work runs asynchronously.
- Ensure second-pass reasoning (valuations, commerce cues, scripts) only runs on confidence-scored facts derived from guardrail-approved question sets.

---

### High-Level Flow
1. **Upload Intake (`vehicle_image_assets`)**
   - Sources: web uploader, mobile (`MobileVehicleProfileV2`), Dropbox importers, BaT sync.
   - Each upload writes:
     - Asset row (`status = 'pending_processing'`).
     - `timeline_events` row (`type = 'evidence_uploaded'`, includes `asset_id` list).
   - Trigger (`AFTER INSERT`) enqueues `vehicle_image_fact_batches` via RPC `enqueue_image_fact_batch(vehicle_id, asset_ids, trigger_context)` when:
     - Asset lacks derived facts.
     - Auto batching groups ≤ 12 images or 5 minutes of uploads.

2. **Batch Orchestration (`vehicle_image_fact_batches`)**
   - Status lifecycle: `queued → running → failed/succeeded`.
   - Metadata:
     - `guardrail_version`, `question_set_id`, `vehicle_snapshot` (year/make/model, known issues, active work orders).
     - `queued_reason`: `new_upload`, `manual_retry`, `backfill`.
   - Queue implementation: Supabase Edge Function `process-vehicle-images` pulling from `vehicle_image_fact_batches` where `status='queued'` via cron (every 2 min) or Supabase Task.
   - Concurrency guard: update row `status='running'` with `processor_instance_id` to avoid duplicate runners.

3. **Guardrail Question Resolution**
   - For each batch:
     1. Fetch relevant `image_fact_questions` by vehicle filters (year/make/model/body style) and `asset.area`.
     2. Expand dynamic guardrails (e.g., if `vin` missing → include VIN confirmation prompts).
     3. Persist `resolved_question_ids` + `prompt_payload` on the batch for auditing.
   - Provide preview responses by asking the uploader lightweight multiple-choice questions before leaving the uploader UI (client writes to `image_fact_questions_answers_temp` keyed by batch, consumed later to prime AI context).

4. **Vision + Extraction Stage**
   - Edge Function `process-vehicle-images` orchestrates:
     - Retrieve signed URLs for assets.
     - Run `supabase/functions/analyze-image` (existing) or new OpenAI Vision call per asset with guardrail instructions + derived prompts.
     - Parse outputs into normalized `ImageFactDraft` objects:
       ```ts
       type ImageFactDraft = {
         asset_id: string;
         vehicle_id: string;
         question_id: string;
         fact_type: 'component' | 'damage' | ...;
         answer_text: string;
         numeric_value?: number;
         units?: string;
         bbox?: { x: number; y: number; w: number; h: number };
         confidence_model: number; // 0-1
         evidence_urls: string[];
         raw_response: Json;
       };
       ```
     - Insert drafts into `vehicle_image_facts` (one transaction per batch).

5. **Confidence + Policy Layer**
   - After facts are inserted:
     - Determine default consumer thresholds (valuation wants ≥0.7, timeline needs ≥0.5, commerce needs ≥0.8).
     - Upsert `image_fact_confidence` rows per consumer.
     - Auto-mark `state='pending'` for scores between `threshold-0.1` and `threshold`, otherwise `approved/rejected`.
   - Kick off notifications:
     - `facts_pending_review` event for moderators.
     - `facts_ready` custom event for UI to refresh Fact Explorer.

6. **Second-Pass AI Scripts (`vehicle_fact_runs`)**
   - Function `vehicle-image-analyst` (new) executes once `image_fact_confidence` shows enough approved facts.
   - Run types:
     1. `confidence_qa`: cross-question to verify contradictions, adjust `image_fact_confidence`.
     2. `valuation_summary`: craft narrative + component valuations; writes to `vehicle_valuations_components` with `image_fact_links`.
     3. `commerce_script`: identify sellable parts and initialize `commerce_opportunities`.
   - Each run writes `vehicle_fact_runs` row with fact inputs, guardrail version, and derived recommendations.

7. **Linking & Downstream Updates**
   - Helper `link_facts_to_timeline(fact_ids[], timeline_event_id)` ensures the duality principle.
   - When a fact describes a component with receipts:
     - `vehicle_field_sources` updated with `confidence_score`.
     - `timeline_events` entry `documented_component` created + linked.
     - `vehicle_valuations` recalculated if new net value emerges.
   - Commerce triggers (optional):
     - If fact type `component` + `condition='available_for_sale'`, auto-create `commerce_opportunities` row referencing fact.

8. **Error & Retry Handling**
   - Batch failure stores `error_log` jsonb and increments `retry_count`.
   - Automated retry schedule: exponential backoff up to 3 attempts; beyond that, `status='failed'` and alert Slack via existing `notify-deploy` webhook.
   - Manual retry endpoint: RPC `retry_image_fact_batch(batch_id uuid, force boolean)` (admins only).

---

### Edge Function Responsibilities

| Function | Role | Key Notes |
| --- | --- | --- |
| `apple-upload`, `work_order_photo_upload`, etc. | Create `vehicle_image_assets`, trigger timeline event, call enqueue RPC. | Already exist—only need to add RPC call. |
| `process-vehicle-images` (new) | Batch worker described above. | Should live in `/supabase/functions/process-vehicle-images/index.ts`. Uses service role key for DB writes. |
| `analyze-image` (existing) | Low-level vision call. | Extend to accept guardrail prompt context & return structured JSON. |
| `vehicle-image-analyst` (new) | Second-pass reasoning + valuations/commerce actions. | Lives in `/supabase/functions/vehicle-image-analyst/index.ts`. Subscribes to Postgres channel or runs on cron. |

---

### Guardrail Question Design

1. **Question authoring**
   - Store in `image_fact_questions` with metadata:
     ```json
     {
       "slug": "engine_leaks_v1",
       "component": "engine",
       "requires": ["engine_bay_visible"],
       "prompts": [
         "Is there visible oil residue near the valve covers? Answer yes/no and describe location."
       ],
       "auto_actions": {
         "on_yes": "create_timeline_event:potential_leak"
       }
     }
     ```
   - Use semver increments whenever wording changes; guardrail version recorded on batches.

2. **Dynamic guardrails**
   - Compose additional prompts based on missing data:
     - No VIN → add `vin_plate_check_v1`.
     - No odometer photo in last 90 days → add `odometer_validation_v1`.
   - Vehicle-specific cues: rare trims get special paint/stripe questions; trucks get frame rust prompts.

3. **Human input hooks**
   - Uploader can pre-answer quick questions (e.g., “Was the car running?”) to enrich AI context.
   - Store these answers to `image_fact_questions_answers_temp` and attach to batch so the AI knows ground truth vs. speculation.

---

### Notifications & UI Integration

- Fire `vehicle_images_updated` (already used) plus new `vehicle_facts_updated` CustomEvent with payload `{ vehicleId, factIds, stateCounts }`.
- Command palette actions:
  - “Run fact batch again” -> call `retry_image_fact_batch`.
  - “Open Fact Review Queue” -> anchor to moderator drawer filtered by `state='pending'`.
- Fact Explorer UI will query new RPC `get_vehicle_fact_summary(vehicle_id uuid)` returning:
  ```json
  {
    "totals": { "facts": 128, "pending": 7, "approved": 112, "rejected": 9 },
    "by_area": { "engine": 32, "interior": 20 },
    "latest_batches": [ ... ],
    "guardrail_versions": ["1.2.0"]
  }
  ```

---

### Implementation Checklist

1. Build RPC `enqueue_image_fact_batch`.
2. Create new Edge Function directories with shared helper for parsing AI output.
3. Update upload flows (`EnhancedImageTagger`, `VehicleImageGallery` importer hooks) to await `facts_pending` counts.
4. Add Postgres triggers to:
   - Auto-link facts to timeline when `image_fact_links` row inserted for `documented_component`.
   - Emit `vehicle_facts_updated` via `supabase_realtime.broadcast`.
5. Instrument logging + metrics:
   - `batch_duration_ms`, `facts_per_batch`, `confidence_distribution`.
   - Store in `vehicle_fact_runs` or push to existing `logflare` sink.

Once this pipeline is in place, the UI can rely on consistent, guardrail-backed data to power search, valuations, and commerce flows without hallucinations.


# PROJECT STATE
**Updated: 2026-02-26** — Update this when you complete a sprint or shift focus.

---

## Platform Status
- **nuke.ag**: Live and deployed (Vercel)
- **DB**: Supabase project `qkgaybvrernstplzjaam`, ~33M vehicle images, 18k+ vehicles
- **Image pipeline**: PAUSED globally (`NUKE_ANALYSIS_PAUSED` flag) — do not re-enable without intent
- **Rebrand**: N-Zero → Marque → Nuke complete. Domain: nuke.ag

---

## Active Sprint Focus (Feb 2026)

### 1. YONO — Local Vehicle Vision Model [PRIMARY]
**Status**: Sidecar live on Modal, consumer API deployed, tier-2 hierarchical models active.
- Phase 5 EfficientNet trained ✓
- ONNX model exported ✓ (flat + tier-1 + 6 tier-2 families)
- YONOClassifier working ✓
- FastAPI sidecar on Modal ✓ (2 warm containers, `yono-serve`)
- Florence-2 vision analysis (condition/zone/damage) ✓
- Zone classifier (41 zones, 72.8% val_acc) ✓
- Consumer API `api-v1-vision` v1.1 ✓ — classify + analyze at $0/image
- Edge functions: `yono-classify`, `yono-analyze`, `yono-batch-process`, `yono-vision-worker`, `yono-keepalive`, `api-v1-vision`
- **NEXT**: SDK v1.3.0 (`nuke.vision.*` namespace), contextual model (image + sale history → price estimate)

### 2. Facebook Marketplace Extraction [ACTIVE RESEARCH]
**Status**: Local residential-IP scraper deployed. Testing logged-out GraphQL path.
- `extract-facebook-marketplace` — single listing extractor (deployed)
- `fb-marketplace-orchestrator` — bulk extractor (deployed)
- `refine-fb-listing` — metadata enrichment via bingbot HTML fallback (deployed)
- Seller blocklist deployed
- **NEXT**: Test logged-out GraphQL (`MarketplaceSearchResultsPageContainerNewQuery` + `doc_id` system)
- Reference: MEMORY.md `## Active Focus: Facebook Marketplace Vehicle Extraction`

### 3. Agent Hierarchy [DEPLOYED]
**Status**: Built and deployed. Tested with real data.
- `haiku-extraction-worker` — Routine extraction at $1/$5 MTok (3x cheaper than Sonnet)
- `sonnet-supervisor` — Quality review, edge case handling, dispatch loop
- `agent-tier-router` — Top-level router with Opus strategy layer
- `_shared/agentTiers.ts` — Shared tier configs and Anthropic API wrapper
- import_queue statuses: `pending` -> `pending_review` -> `pending_strategy` -> `complete`
- See TOOLS.md "Agent Hierarchy" section for full usage
- **NEXT**: Wire into cron for continuous processing, integrate with existing `continuous-queue-processor`

---

## Recently Completed (last 7 days)
See `DONE.md` for full log. Quick summary:
- Agent safety infrastructure: TOOLS.md, pipeline_registry, stale locks, column comments
- Cars & Bids extractor rewrite (cache-first, all fields)
- FB Marketplace: HTML fallback, residential-IP scraper, seller blocklist
- Discovery pipeline improvements (gap fix, private-seller filter)
- nuke.ag domain live, Marque→Nuke rebrand complete
- Investor offering page (/offering) with live stats
- Acquisition pipeline + dashboard

---

## Paused / Blocked

| Area | Status | Reason |
|------|--------|--------|
| Image AI pipeline | PAUSED | `NUKE_ANALYSIS_PAUSED` env flag — 32M images pending, intentional pause |
| K10 photos | Queued/paused | 419 photos uploaded, waiting for pipeline unpause |
| OpenAI quota | Was exhausted Feb 1 | Check current status before AI-heavy work |
| Collecting Cars | Deployed Feb 1 | Using Typesense bypass — healthy |
| Betting/prediction markets | REMOVED | Removed from routes Feb 18, not part of product |

---

## Do Not Touch Without Checking

- `pipeline_registry` — query it before writing to any computed field
- `locked_by` / `locked_at` on any queue table — managed by workers only
- `ai_processing_status`, `signal_score`, `nuke_estimate`, `deal_score`, `heat_score` — computed fields, never write directly
- Any edge function listed in `.claude/ACTIVE_AGENTS.md` as currently active

---

## Architecture Anchors

- **181 edge functions** in `supabase/functions/`
- **All external URL fetches** must use `archiveFetch()` from `_shared/archiveFetch.ts` — never raw `fetch()`
- **Before building anything** — read `TOOLS.md`. It maps every common intent to the existing tool.
- **Before writing to a DB field** — `SELECT * FROM pipeline_registry WHERE table_name='x' AND column_name='y'`
- **Observation system**: new architecture — all data flows through `ingest-observation` → `vehicle_observations`

---

## High-Value Next Work (in priority order)

1. ~~**YONO FastAPI sidecar**~~ DONE — sidecar live, consumer API deployed, tier-2 models active
2. **FB Marketplace GraphQL probe** — logged-out path, test `doc_id` + `fb_dtsg` approach
3. **Agent hierarchy build** — Haiku workers for extraction (10x token efficiency)
4. **SDK v1.3.0 prep** — depends on YONO sidecar being functional

---

## How to Update This File

- Update "Active Sprint Focus" when starting new work
- Update "Recently Completed" weekly (details go in DONE.md)
- Update "Paused/Blocked" table when things change
- Change the date at the top

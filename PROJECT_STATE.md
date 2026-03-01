# PROJECT STATE
**Updated: 2026-03-01** — Update this when you complete a sprint or shift focus.

---

## Platform Status
- **nuke.ag**: Live and deployed (Vercel)
- **DB**: Supabase project `qkgaybvrernstplzjaam`, ~33M vehicle images, 1.25M+ vehicles, 99.94% data quality scored
- **Image pipeline**: PAUSED globally (`NUKE_ANALYSIS_PAUSED` flag) — do not re-enable without intent
- **Rebrand**: N-Zero → Marque → Nuke complete. Domain: nuke.ag

---

## Active Sprint Focus (Mar 2026)

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
- @nuke1/sdk v1.5.0 publish-ready (README matches actual vision types, LICENSE added)
- **NEXT**: Contextual model (image + sale history → price estimate), SDK publish to npm

### 2. Facebook Marketplace Extraction [ACTIVE — NATIONAL SWEEP]
**Status**: National sweep running across 58 US metros. Logged-out GraphQL confirmed working.
- `extract-facebook-marketplace` — single listing extractor (deployed)
- `fb-marketplace-orchestrator` — bulk extractor (deployed)
- `refine-fb-listing` — metadata enrichment via bingbot HTML fallback (deployed)
- `scripts/fb-marketplace-local-scraper.mjs` — residential-IP scraper, 58 metros, no tokens needed
- Seller blocklist deployed
- National vintage rate: ~12% of all vehicle listings
- 1,000+ vintage listings captured so far from overnight sweep
- **NEXT**: Aggregate results, deduplicate, enrich via refine-fb-listing, feed into import queue
- Reference: MEMORY.md `## Active Focus: Facebook Marketplace Vehicle Extraction`

### 3. Agent Hierarchy [DEPLOYED]
**Status**: Built and deployed. Tested with real data.
- `haiku-extraction-worker` — Routine extraction at $1/$5 MTok (3x cheaper than Sonnet)
- `sonnet-supervisor` — Quality review, edge case handling, dispatch loop
- `agent-tier-router` — Top-level router with Opus strategy layer
- `_shared/agentTiers.ts` — Shared tier configs and Anthropic API wrapper
- import_queue statuses: `pending` -> `pending_review` -> `pending_strategy` -> `complete`
- See TOOLS.md "Agent Hierarchy" section for full usage
- **DEPLOYED**: Crons active, queue draining — router (5min), haiku worker (2min), sonnet supervisor (10min)

---

## Recently Completed (last 7 days)
See `DONE.md` for full log. Quick summary:
- **Overnight autonomous session (Mar 1)**: 330-file commit, 22 edge functions deployed, 7 frontend crash fixes
- Data quality scoring: 37% → 99.94% (1.25M vehicles scored)
- Agent hierarchy fully deployed with crons (router/haiku/sonnet)
- Snapshot extraction fixes: Craigslist, Bonhams, Barrett-Jackson, Cars & Bids
- @nuke1/sdk v1.5.0 prepared (README, LICENSE, vision types)
- 61,385 vehicles backfilled with primary_image_url
- Universal search: dual parameter support (?q= and ?query=)
- FB Marketplace national sweep: 58 metros, 1000+ vintage listings
- YONO sidecar verified healthy (2 warm containers)
- Theme system audit: 89% reduction in inline violations (1,709 → 185)
- Photo spatial mapping: 10K GPS pins across 48 vehicles
- First-touch user engagement overhaul (homepage, onboarding)
- Agent safety infrastructure: TOOLS.md, pipeline_registry, stale locks, column comments

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
2. ~~**FB Marketplace GraphQL probe**~~ DONE — logged-out path works, national sweep running (58 metros)
3. ~~**Agent hierarchy build**~~ DONE — deployed with crons, queue draining automatically
4. ~~**SDK v1.3.0 prep**~~ DONE — v1.5.0 publish-ready with vision types + LICENSE
5. **SDK publish to npm** — final review and `npm publish` for @nuke1/sdk
6. **FB Marketplace enrichment** — aggregate sweep results, deduplicate, feed into import queue
7. **Contextual pricing model** — YONO image features + sale history → price estimate
8. **Import queue drain** — 460+ pending items, agent hierarchy now processing automatically

---

## How to Update This File

- Update "Active Sprint Focus" when starting new work
- Update "Recently Completed" weekly (details go in DONE.md)
- Update "Paused/Blocked" table when things change
- Change the date at the top

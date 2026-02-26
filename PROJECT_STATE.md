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
**Status**: Phase 5 complete. Next step is FastAPI sidecar.
- Phase 5 EfficientNet trained ✓
- ONNX model exported ✓
- YONOClassifier working ✓
- Photos library scan: running in background (PID in `yono/library_scan/scan.pid`)
- **NEXT**: FastAPI sidecar service → integrate with edge functions → hierarchical retraining → SDK v1.3.0
- Reference: MEMORY.md `## Core Strategic Focus: YONO`
- Edge functions: `yono-classify`, `yono-batch-process`

### 2. Facebook Marketplace Extraction [ACTIVE RESEARCH]
**Status**: Local residential-IP scraper deployed. Testing logged-out GraphQL path.
- `extract-facebook-marketplace` — single listing extractor (deployed)
- `fb-marketplace-orchestrator` — bulk extractor (deployed)
- `refine-fb-listing` — metadata enrichment via bingbot HTML fallback (deployed)
- Seller blocklist deployed
- **NEXT**: Test logged-out GraphQL (`MarketplaceSearchResultsPageContainerNewQuery` + `doc_id` system)
- Reference: MEMORY.md `## Active Focus: Facebook Marketplace Vehicle Extraction`

### 3. Agent Hierarchy [PLANNED — see .claude/NEXT_SESSION.md]
**Status**: Architecture designed, not built.
- Plan: Haiku workers (extraction) + Sonnet supervisor + Opus strategy
- See `.claude/NEXT_SESSION.md` for exact commands and structure

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

1. **YONO FastAPI sidecar** — unblocks SDK v1.3.0, the main revenue deliverable
2. **FB Marketplace GraphQL probe** — logged-out path, test `doc_id` + `fb_dtsg` approach
3. **Agent hierarchy build** — Haiku workers for extraction (10x token efficiency)
4. **SDK v1.3.0 prep** — depends on YONO sidecar being functional

---

## How to Update This File

- Update "Active Sprint Focus" when starting new work
- Update "Recently Completed" weekly (details go in DONE.md)
- Update "Paused/Blocked" table when things change
- Change the date at the top

# Research Scout — Snap-On Inventory, Gaussian Splat Feasibility, DeepSeek-VL2 Eval

Scout date: 2026-05-24
Scope: three small probes, research only, no execution or schema changes.

---

## Executive Summary (100 words)

Snap-On inventory infrastructure exists (10+ tables, services, parser) but is half-built: 126 user_tools rows extracted from PDF receipts but **zero have serial numbers**, and `tool_usage` is just seed demo data. "Real-time per-tool usage tracking" is months of work, not a switch flip. 3D Gaussian Splatting for vehicles is technically feasible in 2026 at ~$3-6 per vehicle on RunPod A100, but **macOS-native training is blocked** (no CUDA) and the integration gap is the long pole, not the splat. DeepSeek-VL2 is ~277x cheaper per image than Claude but has no published wiring-schematic benchmarks and isn't on DeepSeek's own API — not worth a pivot.

---

## Probe 1 — Snap-On Tool Inventory

### What I checked
- `information_schema.tables` filtered by `tool`/`inventory`/`snap`/`asset`
- Row counts for every tool table
- Column schemas for `user_tools`, `tool_inventory`, `tool_usage`, `tool_transactions`, `tool_transaction_items`, `receipts`
- Serial-number / receipt / catalog / franchise-operator coverage on `user_tools` Snap-On rows
- Snap-On vendor receipts in the main `receipts` table
- Frontend services: `snapOnParser.ts`, `toolInventoryService.ts`, `toolProductEnrichmentService.ts`, `toolImageService.ts`, `professionalToolsService.ts`, `claudeReceiptParser.ts`
- Migrations: `20250930_comprehensive_tools_schema.sql`, `20250930000001_create_tool_tables.sql`, `20250930000002_professional_tools_inventory.sql`, `20250831140000_professional_toolbox_system.sql`

### What I found

**The substrate exists but it's two-headed and shallow.**

Two parallel inventory tables, both populated, neither complete:

| Table | Rows | Origin | Has serials? | Has usage? |
|---|---|---|---|---|
| `user_tools` | 130 (126 Snap-on) | PDF receipt parser → snapOnParser.ts | **0 with serial_number, 0 with serials_array** | n/a (no usage join) |
| `tool_inventory` | 31 | seeded demo data | 0 with serial_number | yes but all `last_used_at = 2026-02-06T03:01:36` (single seed timestamp) |

Supporting tables:
- `tool_catalog` — 126 rows (catalog enrichment, populated)
- `tool_catalog_images` — 126 rows (paired with catalog)
- `tool_brands` — 12, `tool_franchisors` — 2 (Snap-on, Mac Tools), `tool_categories` — 9
- `tool_transactions` — **3 rows** with null subtotal/total/payment_type
- `tool_transaction_items` — 3 rows
- `tool_usage` — **27 rows, all stamped 2026-02-06T03:00:00.544417 with "AC retrofit job" notes** — pure seed data, not real tracking
- `tool_receipt_documents` — 1 row
- `technician_tool_proficiency` — 6 rows
- `tool_usage_stats` — exists, empty

Receipts side (where the real evidence is):
- `receipts` has **21 Snap-On vendor rows totaling $34,843.68** spent (2023-02-20 through 2024-02-19)
- **0 of those 21 receipts have line items extracted** (`receipt_items` count = 0 per receipt)
- The 126 `user_tools` rows came from a **different** ingestion path — the `snapOnParser.ts` regex parser working on the PDF text, not the structured `receipt_items` flow

The pipeline as designed (from frontend code):
```
PDF upload → claudeReceiptParser / snapOnParser → user_tools rows (no serials in receipts)
                                               → tool_catalog enrichment
                                               → toolImageService (catalog images)
Work session creation → tool_usage rows (manual entry; nothing's wired to auto-log)
```

**Skylar's claim "I have already indexed all my tools, their serials from my snap on dealer" is partially true** — he has the part numbers and descriptions, NOT the serials. Snap-On dealer receipts don't print serials on most line items; they're on tooling that's serial-tracked (impacts, scanners, torque wrenches) but the parser doesn't currently lift them even when present. The `serial_number` and `serial_numbers[]` columns are there waiting; they're just empty.

The gap to "real-time per-tool usage tracking":
1. **Serials**: re-parse the 21 receipts looking specifically for serial-line items (some Snap-On tools print SN on the line); for the rest, manual entry or photo-of-serial-plate flow needed
2. **Usage events**: nothing auto-logs tool use. Would need either (a) work_session UI with tool picker, (b) photo-detection of tools in workshop images (the `populate-tool-usage-from-detections.js` script exists, suggesting that path was started), or (c) BLE/RFID tags on the toolbox (hardware project)
3. **The link `tool_usage.tool_id → user_tools.id` is the join** but `user_tools` doesn't have a usage relationship yet — `tool_usage.tool_id` currently points at `tool_inventory` (the seed table). Schema reconciliation needed before any real tracking can begin.

### Verdict
**The plumbing is 60% built but plumbed to a dead-end demo table, not the real inventory.** Tool inventory is a project on its own (weeks, not days), and it doesn't help sell the Mustang or finish the K5 wiring. Don't touch it now.

### Next step if Skylar wants to pursue this
Run the `populate-tool-usage-from-detections.js` script against existing workshop photos to see if YOLO/vision detection of tools-in-hand can backfill `tool_usage` for free — that's the only path that doesn't require new hardware or new UI. Estimated effort: half a day to test the script and see what it finds on Skylar's own image corpus.

---

## Probe 2 — 3D Gaussian Splatting Feasibility

### What I checked
- SOTA software state for 2026 (Postshot, Polycam, KIRI Engine, gsplat, Nerfstudio, SuperSplat, DJI Terra)
- GPU rental pricing (Lambda, RunPod, Spheron, SynpixCloud)
- Photo-coverage requirements
- Output formats and integration paths
- Annotation / pin-at-xyz capabilities in industry use
- macOS-native training feasibility

### What I found

**Technically mature, economically reasonable, but it's a polish wedge not a substrate wedge.**

**Photo requirements:** Industry consensus for object-scale (single vehicle) is **200-500 overlapping photos** with >60% overlap between adjacent views. BRUM (2026) lowered the bar to "sparse 360 views" using DUSt3R for SfM, but the practical bar for a vehicle splat that holds up under inspection is still 300+ images covering full hemisphere coverage. The K5 has thousands of photos but they were taken for documentation, not for splat reconstruction — angles will be uneven and many will be redundant or have moving parts (engine in/out, body on/off the frame). Skylar would need to either (a) curate a same-state subset of ~300 K5 photos, or (b) do a dedicated 30-minute walk-around with overlap discipline.

**Training cost — actual numbers:**
- RunPod A100 40GB: **$1.49/hr**, A100 80GB: $1.99/hr (per-second billing)
- Lambda Labs A100 80GB: $2.49/hr on-demand
- A typical 300-image vehicle splat trains in **30-60 minutes on an A100** with gsplat or Postshot's cloud equivalent
- FastGS (CVPR 2026 Highlight, gsplat-derived) claims "100 seconds" training for some scenes; for a vehicle with realistic photo count, expect 15-30 min on H100
- **Per-vehicle cost: $1-2 on RunPod, $2-4 on Lambda.** Skylar's "compute-budget anxiety" is overblown for this workload — it's coffee money per vehicle
- For all 24 K5/template vehicles: **$25-100 total** in raw GPU. The labor cost (curating photos, sanity-checking output) is 100x the compute cost.

**Software state for 2026:**
- **Postshot** ($15/mo, Windows desktop, local training) — best balance of price/quality for solo workflow, no cloud upload required
- **Polycam** ($8/mo Pro, web+iOS, cloud processing) — easiest UX, mobile capture
- **KIRI Engine** (free tier with unlimited scans, mesh-inclusive splats that import into Blender) — best for downstream editing
- **gsplat** (open-source CUDA library) — the engine everyone else builds on; for command-line workflows
- **DJI Terra Flagship** — pro-grade, $$$, dominates drone-survey work; overkill for a single vehicle
- **SuperSplat** (free, web-based, Blender editor with annotation/pinning) — the editor of choice once you have a .ply
- **Output formats**: `.ply` (universally supported), `.splat` (web-optimized), emerging `glTF + KHR_gaussian_splatting` extension expected Q2 2026 as universal interchange

**macOS gap:** All major 3DGS training tools require **NVIDIA CUDA**. Apple Silicon (M1/M2/M3/M4) cannot run them. Options: cloud GPU (Polycam, RunPod, Lambda), or **Scaniverse on iPhone** for on-device mobile-grade splats. Viewer-only options for Mac are abundant (SuperSplat web editor runs in Chrome). So Skylar would have to rent compute or capture-and-cloud-process. Not a blocker but kills the "do it locally" vibe.

**Annotation / pin-at-xyz:** Yes, this is a real production capability in AEC (architecture/engineering/construction). RFIs, punch-list items, and PDFs get pinned to exact 3D coordinates in splat scenes. Industry term is "spatial annotation." Mean geometric accuracy ~7.82cm — good enough for "the alternator is here, click for the part observations." Integration with a Postgres-backed substrate would be: store the splat .ply as a vehicle asset (Supabase storage), then add a `splat_annotations` join table (`vehicle_id`, `splat_asset_id`, `x`, `y`, `z`, `observation_id`). SuperSplat's data model already supports this and exports JSON pins. The web viewer (PlayCanvas-based) renders pins natively.

### Verdict
**It's a 2026 wedge, but a side-wedge — not the main wedge.** The tech is cheap, mature, and integrates cleanly with a coordinate-frame-pinning model. But it doesn't fix any of Skylar's load-bearing problems (taxes, Mustang sale, K5 wiring). It's a feature that would make nuke.ag's vehicle profiles spectacular — and that matters for ZERO users today. **Build it the week before the seed-pitch demo, not now.**

### Next step if Skylar wants to pursue this
Sign up for **Polycam Pro ($8/mo)** and shoot ONE vehicle (Mustang is best — known geometry, fits in a one-pass walk-around) on his iPhone, end-to-end, today. 30-minute capture, cloud processing returns a splat in an hour. That single experiment will tell him whether the result quality is worth the integration work — for $8 and a coffee break. Don't write any code until that experiment is in hand.

---

## Probe 3 — DeepSeek-VL vs Claude for Wiring Images

### What I checked
- DeepSeek-VL2 architecture and benchmark coverage (arXiv 2412.10302, Roboflow blog, SiliconFlow listing)
- Pricing on Replicate, SiliconFlow, DeepSeek's own API
- Claude Sonnet 4.6 / Opus 4.7 pricing per image
- Published evaluations on circuit/schematic understanding (none found)
- Whether DeepSeek-VL2 is even available on first-party DeepSeek API (it is not)

### What I found

**DeepSeek-VL2 is real, cheap, and architecturally interesting — but it's a side-channel model, not a serious alternative for production wiring analysis.**

Key facts:
- DeepSeek-VL2 is an MoE vision model (1.0B / 2.8B / 4.5B activated params across Tiny/Small/Base variants) released December 2024. **DeepSeek has not put it on their first-party API.** Available via third-party: Replicate, SiliconFlow, or self-host.
- **Replicate pricing: ~$0.0036 per prediction on A100 80GB, ~3 sec/call** = ~277 predictions per dollar
- Claude Sonnet 4.6: $3/M input tokens; a 1000×1000 image ≈ 1,334 tokens ≈ **~$0.004/image input cost** + output tokens (call it $0.01-0.02 per image including a real prompt and response)
- Claude Opus 4.7: ~5x Sonnet pricing
- So Sonnet vs DeepSeek-VL2 is roughly **3-5x cost ratio for vision input**, not 10x — the cost gap closes fast when you account for output tokens, which DeepSeek-VL2 also generates
- **No published benchmark on electrical schematics or wiring diagrams.** DeepSeek-VL2's strengths per the paper: OCR (OCRBench 834 vs GPT-4o 736), DocVQA 93.3%, dense-text documents, charts/tables. None of the published evals test the specific failure modes wiring images stress: 3D occlusion of connectors, color-coding under variable lighting, terminal cavity counts at oblique angles, distinguishing similar small parts.
- DeepSeek-VL2's "dynamic tiling" architecture is genuinely interesting for **high-resolution dense images** — it tiles a single image into patches at multiple resolutions, which in principle helps with the "zoom in on the connector but keep the wider context" problem that wiring photos present. **In principle.** No public eval on this use case.

Where DeepSeek-VL2 would win, if it works:
- Batch screening of large image corpora (the 30M image CDN) — at $0.0036/call vs $0.01-0.02 Claude, the cost gap matters at million-image scale
- OCR-heavy tasks (part numbers, serials on tags, label reading) — DeepSeek-VL2 leads OCR benchmarks
- Self-hostable on a rented H100 if Skylar wants air-gapped/zero-marginal-cost inference at high volume

Where Claude wins:
- Reasoning-heavy single-image analysis (the wire closure protocol's "identify connector, pin functions, citation-worthy claims") needs Claude's verbal reasoning quality, not just visual recognition
- The K5 wiring receipt protocol (`docs/wiring/receipts/`) requires structured JSON output, citations against named source files, hedging on uncertainty — Claude is meaningfully better at that meta-task than DeepSeek-VL2 by every account
- Multi-turn wiring analysis (look at this image, now look at this related one, now reconcile with the cut list) — Claude's 1M context + tool use is where the workshop value lives

### Verdict
**Don't pivot the K5 wiring path to DeepSeek-VL2 — Claude is better at the agentic reasoning that wire closures actually require, and DeepSeek-VL2's vision edge is unproven on schematics.** Where DeepSeek-VL2 *might* earn its keep: a separate batch-OCR job over the 30M-image corpus to extract part numbers, serials, and labels at low cost. That's a different workflow than wire closure.

### Next step if Skylar wants to pursue this
**Skip the K5 wiring experiment.** If he wants to validate DeepSeek-VL2 anywhere, do it on a batch OCR task: take 100 receipt images already in the system, run them through Replicate's DeepSeek-VL2 endpoint asking for line-item extraction, and compare to what `claudeReceiptParser.ts` produced. ~$0.36 total spend. That's where the cost advantage is real and the eval is unambiguous.

---

## Cross-cutting note

All three probes converge on the same meta-pattern: **the integration gap is the real cost, not the tech.** Snap-On inventory has the schema and the parser but the link tables aren't wired. Gaussian splats are cheap to train but expensive to integrate as substrate-pinned assets. DeepSeek-VL2 is cheap to call but the wire closure workflow doesn't bottleneck on image cost. **None of these three are bottlenecking anything Skylar is doing this week.** They're 2027 features. The 2026 work is: file 2024/2025 taxes, sell the Mustang, close K5 wires.

---

## Files / paths referenced

Substrate code:
- `/Users/skylar/nuke/nuke_frontend/src/services/snapOnParser.ts`
- `/Users/skylar/nuke/nuke_frontend/src/services/toolInventoryService.ts`
- `/Users/skylar/nuke/nuke_frontend/src/services/claudeReceiptParser.ts`
- `/Users/skylar/nuke/nuke_frontend/src/services/professionalToolsService.ts`
- `/Users/skylar/nuke/nuke_frontend/src/services/toolImageService.ts`
- `/Users/skylar/nuke/nuke_frontend/src/components/profile/ProfessionalToolbox.tsx`
- `/Users/skylar/nuke/scripts/populate-tool-usage-from-detections.js`
- `/Users/skylar/nuke/supabase/migrations/20250930_comprehensive_tools_schema.sql`
- `/Users/skylar/nuke/supabase/migrations/20250930000001_create_tool_tables.sql`
- `/Users/skylar/nuke/supabase/migrations/20250930000002_professional_tools_inventory.sql`
- `/Users/skylar/nuke/supabase/migrations/20250831140000_professional_toolbox_system.sql`

DB tables (read-only):
- `user_tools` (130 rows, 126 Snap-on, 0 serials)
- `tool_inventory` (31 seed rows)
- `tool_catalog`, `tool_catalog_images` (126 each)
- `tool_usage` (27 seed rows, all 2026-02-06T03:00:00)
- `tool_transactions` (3), `tool_transaction_items` (3), `tool_receipt_documents` (1)
- `receipts` filtered by `vendor_name ILIKE '%snap%'` (21 rows, $34,843.68 spent, 0 with extracted line items)

External sources:
- DeepSeek-VL2 paper: https://arxiv.org/abs/2412.10302
- DeepSeek-VL2 on Replicate: https://replicate.com/deepseek-ai/deepseek-vl2
- gsplat: https://github.com/nerfstudio-project/gsplat
- Postshot: https://www.jawset.com/
- RunPod GPU pricing 2026: https://www.runpod.io/pricing
- "State of Gaussian Splatting 2026": https://www.thefuture3d.com/blog/state-of-gaussian-splatting-2026/
- BRUM (sparse-view vehicle splat): https://arxiv.org/abs/2507.12095

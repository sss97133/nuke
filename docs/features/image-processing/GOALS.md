# Image Analysis + DB System — Goals

> Established 2026-06-09 with Skylar. Re-aimed 2026-06-10 against the overnight fleet sprint.
> The north star is his: **"all of those depend on accurate daily intake and context building over time."**
> Outcomes (revenue docs, tax substrate, verified timelines) are the *point*; the daily intake loop is the *foundation* they all stand on. If intake isn't accurate and context doesn't compound, every downstream number is built on sand.

## What the system is FOR (not imaginary users)

Turn Skylar's ~7,700-photo archive into three things that touch his real life:
1. **BaT-listing-ready build documentation** = revenue
2. **Per-vehicle COGS + labor ledger** = tax substrate
3. **Owner-verified build timelines** he actually trusts

## How it works today (verified 2026-06-10, post-fleet-sprint)

Two layers now exist and they were built by different hands:

**1. The intake pipeline (overnight fleet sprint, June 9→10, on `main`).** A real self-healing queue now drives photos from capture to analysis with no human babysitting:
- **Passive capture** — iPhone → nuke photo-sync daemon, zero touches (`65fdbd6e6`), with an on-device privacy/ownership gate (`5c1f28543`).
- **Self-healing queue** — `vehicle_images.ai_processing_status` (`pending → processing → completed`/`failed`), `reset_stuck_photo_pipeline_images()` re-arms anything stuck, orchestrator trigger fires on insert (`701e86df1`, migration `20260609000001`).
- **GPS auto-filing** — `auto_match_image_to_vehicles` RPC files a photo to a vehicle by location (`0839c4702`); previously this never existed.
- **Pulse control room** — `SystemStatus.tsx` + `pipeline_pulse` view: throughput per organ per day, red at zero (`1abcbea99`, migration `20260610000005`).

**2. The detective analysis (BYOK).** Claude Code *is* the compute, zero API spend (`deep-image-analysis-byok.mjs`, `byok-image-batch.sh`, `build-day.mjs`). DAY is the unit. Each frame gets a **context briefing**:
- **Dossier** — identity + build_summary + work timeline (`api-v1-vehicle-history?view=dossier`)
- **Lifecycle** — every prior `image_deep_byok` observation → `day:build_phases` map (THIS is the compounding mechanism)
- **GPS location legend** — coordinate clusters → known shops (Ernie's, Viva, off-property)
- Per-frame EXIF (Supabase strips it from pixels, so the harness hands it over)

Verdict → `vehicle_observations` (substrate) → projected into `work_sessions`, journal, invoice, showcase. Harness owns IDs + timestamps + supersession.

## FOUNDATION GOAL — Accurate daily intake + compounding context

Every photo-day ingested correctly; each day's analysis enriched by all confirmed prior days; per-vehicle intelligence **compounds** as more days land.

### Health metrics (the daily-intake KPIs) — K5 baseline 2026-06-09

| Metric | What it measures | K5 baseline | Target | Status |
|--------|------------------|-------------|--------|--------|
| **Drain coverage** | frames with a non-superseded byok verdict | 920 / 2,686 = **34%** | 100% per active vehicle | self-healing queue now drives it (`701e86df1`) |
| **Day completeness** | work-days with a rolled-up `work_sessions` summary | 51 days | every documented work-day | open |
| **Intent confirmation** | labor-claimed days **owner-confirmed** (the $410 gate) | **0%** — no loop | 100% of labor days | **STILL OPEN — the one crack the fleet didn't close** |
| **Provenance completeness** | byok obs carrying full source DNA (agent_model, method, cost, duration) | 3 / 920 = **0.3%** | 100% | writer fix still owed |
| **Context depth** | prior lifecycle days fed into each day's briefing | 920 obs available ✓ | grows monotonically | working |

### Crack status after the fleet sprint

- ✅ **Pipeline idle / manual — CLOSED.** Self-healing queue + passive sync daemon + GPS auto-file + pulse control room. The pipeline now drains hands-off and shows red at zero throughput. This was crack #3.
- 🟡 **Provenance — observability only.** The pulse view makes throughput visible, but the byok writer still doesn't land typed `agent_model` / `extraction_method` / `agent_cost_cents` / `agent_duration_ms`. "Numbers carry source DNA" is still half-broken at the row level. Fix is still in `deep-image-analysis-byok.mjs`. This was crack #1.
- 🔴 **No confirmation loop — UNTOUCHED, now the top priority.** `ai_processing_status='completed'` means *the AI analyzed the frame* — **not that Skylar confirmed what happened that day.** The strongest compounding input (owner ground truth becoming a prior for every future day) still does not exist. An `mcp__nuke__confirm_work_session` tool exists but nothing drives it. This was crack #2.

## THE NEXT MOVE — Close the intent-confirmation loop (crack #2)

The fleet made the pipeline *run*. It did not make the pipeline *learn from Skylar*. Until a labor day can be owner-confirmed, "context building over time" only ever compounds the model's own prior guesses — never ground truth. This is the single highest-leverage gap left, and it's the one the memory rule already flags ("Photo intent must be confirmed, not assumed" — the $410-for-a-text-to-dad incident).

### Scope: confirmation as a pipeline stage, not a side feature

The pipeline already has a status spine. Confirmation extends it by **one stage past `completed`**:

```
pending → processing → completed → [needs_confirmation] → confirmed
                                          │
                                          └─ owner denies → corrected (supersede the verdict)
```

Concretely, against tonight's substrate:

1. **A confirmation stage on the day, not the frame.** DAY is the analysis unit, so confirmation is per work-day, not per photo. Source the candidate days from `work_sessions` rows that carry a labor claim but no `confirmed_at`. (Add `confirmed_at` / `confirmed_by` / `intent` to `work_sessions` via migration — supersession-friendly, never overwrite the AI's verdict.)
2. **A triage surface that costs Skylar minutes, not hours.** One card per unconfirmed labor day: the day's hero frames, the AI's claimed intent (labor / inspection / parts_sourcing / comms), claimed hours, claimed location. Three actions: **confirm**, **correct** (change intent/hours), **not-mine**. Render it where he already is — top of the workspace (the `UserTodayCard` lane, `863ee4843`) or as a tab on the vehicle profile.
3. **Writes go through the existing tool, not raw SQL.** `mcp__nuke__confirm_work_session` already exists — wire the surface to it. A confirmation is testimony: owner-trust, highest tier, becomes a `day:` prior the next briefing reads.
4. **The loop closes when** the next day's BYOK briefing includes *confirmed* prior days distinctly from *inferred* prior days — so the detective compounds on ground truth, and metric #3 climbs from 0%.

### Why this and not the provenance fix first

Provenance (crack #1) is a writer bug — real, owed, but it only makes existing numbers self-describing. The confirmation loop is the only thing that injects **new ground truth** into the compounding mechanism. One makes the archive honest about its sources; the other makes the archive *get smarter every time Skylar touches it*. For "context building over time," the second is the foundation.

## OUTCOME GOALS (ride on the foundation)

- **A — K5 as complete proof.** Drain to 100%, owner-confirm every labor day, output ONE fully-verified timeline + invoice + showcase render. The dogfood AND the K20 template. *(Forces B, C, E into existence on one real vehicle.)*
- **B — Owner intent-confirmation loop.** Scoped above. The top priority. Feeds metric #3 and closes the compounding loop with ground truth.
- **C — Per-vehicle COGS/labor rollup.** Fuse `work_sessions` + `receipt_items` (148 K5 line items) into a cost basis. Feeds tax filing AND BaT listing.
- **D — Point the detective at the Mustang.** The nearest actual revenue car. Repeat the proven loop.
- **E — Pipeline reliability + provenance fix.** Drain reliability is now largely shipped (fleet). Remaining: land full source DNA in the byok writer.

## Sequencing

**A is the spine.** The fleet just built the road A drives on (the self-healing pipeline). What A still can't do is *confirm a labor day* (B) — that's now the binding constraint, not pipeline reliability. So the order is: **B (confirmation loop) → finish A's K5 drain on the new pipeline → C (cost basis) → D (Mustang).** Provenance (E) is a parallel writer fix that can land any time. Foundation metrics above are the scoreboard; report coverage toward them, never raw counts.

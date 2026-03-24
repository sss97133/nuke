# Active Agents

*Register yourself when starting. Remove yourself when done.*
*Format: `HH:MM | AGENT-NAME | task description | files/areas touched`*

---

## Completed This Session (2026-03-23)

**PERPLEXITY-TASKS** — 6-task package from claude-code-nuke-package. All done.

### What Was Built

**4 RPCs deployed (all working, tested):**
- `schema_stats()` — fill rate + distinct count + sample values for all 339 vehicles columns. Uses pg_stats, zero table scans.
- `source_vehicles(p_source, p_limit, p_offset, p_make, p_min_price, p_max_price)` — vehicles by source with filters + pagination.
- `make_stats(p_make)` — returns JSONB: totals, price low/median/high, top 10 models, top 5 sources, decade distribution.
- `mv_source_quality` — materialized view, hourly pg_cron refresh. Per-source fill rates across 5 domains.

**Garbage audit — 289K records flagged (zero deleted):**
- 282,325 `conceptcarz_event_sparse_data` — real vehicles, sparse data, pseudo-URLs
- 6,000 `duplicate_listing_url`
- 875 `non_vehicle_item` (gas pumps, signs, jukeboxes, pinball machines)
- 79 `parts_or_dimensions_in_make` (wheel sizes, displacement as make field)
- 9 `zero_useful_fields`
- All flags in `data_quality_flags` JSONB column, keyed by `flagged_by = 'claude-audit-2026-03-23'`

**VIN extraction from conceptcarz chassis numbers — 11,855 VINs promoted:**
- Extracted chassis numbers from `listing_url` field (pattern: `Chassis#: XXXXX` in conceptcarz:// URLs)
- 9,855 full 17-char VINs promoted to `vin` column with `vin_source = 'conceptcarz_chassis_extraction'`, confidence 85
- ~2,000 additional shorter chassis numbers promoted, confidence 70
- 49K remaining chassis numbers are entity resolution candidates (same chassis at multiple events, blocked by unique constraints)

**Batch extraction — 86 vehicles enriched:**
- 7 Mecum (3 VINs found)
- 61 BaT (descriptions + images)
- 18 bonhams/gooding/collecting_cars

### Known Issues From This Session

1. **`calculate_vehicle_completion_algorithmic` trigger** — fires on every vehicles UPDATE and is slow. Bulk updates (>1000 rows) timeout. Batching to 1000-2000 rows with 0.3s sleep works but is painful. Consider disabling trigger for bulk ops and running completion recalc as a separate batch afterward.

2. **Conceptcarz entity resolution** — 49K+ chassis numbers identify the same physical car appearing at multiple auction events across different sources. These are provenance chains, not duplicates. Current unique constraints (`vehicles_vin_unique_17char`, `vehicles_vin_unique_short`) prevent linking them. Need a `chassis_observations` or similar table to store "this chassis appeared at this event" without requiring one-VIN-per-row.

3. **Conceptcarz data quality tiers** — the chassis numbers from conceptcarz URLs have three reliability tiers:
   - **Gold**: Full 17-char VINs (16,762 found, ~10K unique after dedup). Mostly modern exotics.
   - **Silver**: Authentic short chassis numbers (Ferrari 4-digit serials, Aston Martin works numbers). ~48K found. Valid identity but need per-make validation rules.
   - **Junk**: Truncated VIN prefixes (first 4-8 chars), placeholders (ROAD ART, TBA, BILL OF SALE, 001/002). ~22K. Not usable as identity.

4. **Source quality as a metric** — `mv_source_quality` shows conceptcarz delivers identity + price but never description/images/VIN. BaT is 95% description fill. FB Marketplace is 99% price fill but 13% description fill. These source profiles are reportable data quality metrics.

### Files Touched
- DB migrations: `create_schema_stats_rpc`, `fix_schema_stats_performance`, `create_source_vehicles_rpc`, `create_make_stats_rpc`, `create_mv_source_quality`
- `data_quality_flags` JSONB on ~289K vehicle rows
- `vin`, `vin_source`, `vin_confidence` on ~11,855 vehicle rows
- `DONE.md` — appended completion summary
- `docs/strategy/USER_ADOPTION_DESIGN_BRIEF.md` — new file, adoption funnel design brief

### Design Brief Written
`docs/strategy/USER_ADOPTION_DESIGN_BRIEF.md` — user adoption + data contribution strategy. Key insight: primary intake is the **public vehicle profile page** (SEO-indexed at `nuke.ag/vin/{VIN}`), not Claude extension. 130K VINs = 130K landing pages. Extension is power-user tool for shops/builders. Brief covers 5 user types, trust model for user-submitted data, minimum viable loop (public profile → claim → photo upload → notification).

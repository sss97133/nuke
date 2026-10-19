# Repair memo: platform corrections through the sale-provenance writer do not hold (2026-10-15)

**Status:** proposal, docs only. Nothing here is applied. Written by the night run from read-only production reads on
2026-10-15, 08:33Z to 08:36Z (`scripts/data/q.sh`, statement timeouts of 3 to 4 s).

**Recommendation:** fix the writer, not the trigger. When a correction sets `canonical_platform`,
`correct_vehicle_sale_provenance_batch` should also correct the trigger's input, and it should stop writing the
citation into `platform_source`. The alternative is a trigger guard, described below.

## What happens today

1. `correct_vehicle_sale_provenance_batch` (latest body in 20261015210000, #1439) is the sanctioned writer for
   corrections. In one `UPDATE vehicles SET ...` it assigns, among other columns:
   - `canonical_platform = CASE WHEN v_set ? 'canonical_platform' THEN v_set->>'canonical_platform' ELSE canonical_platform END`
   - `platform_source = CASE WHEN v_set ? 'canonical_platform' THEN COALESCE(v_source->>'ref', 'correct_vehicle_sale_provenance') ELSE platform_source END`

   The same SET list also names `reserve_status`, `high_bid`, `winning_bid`, `bat_sold_price`, `sold_price` and
   `asking_price`, each through `CASE ... ELSE col END`. The `platform_source` line has been unchanged since
   20260927020100.
2. `trg_resolve_canonical_columns` is `BEFORE INSERT OR UPDATE OF source, listing_source, discovery_source,
   auction_source, price, asking_price, sale_price, sold_price, ..., reserve_status, ...`. A column named in SET
   fires an `UPDATE OF` trigger even when its value is unchanged. The trigger function never reads
   `OLD.canonical_platform`; it sets `NEW.canonical_platform := resolve_platform_slug(COALESCE(source,
   listing_source, discovery_source, auction_source))`.
3. The corrected platform is therefore replaced in the same statement. `platform_source`, which the trigger does
   not touch, keeps the writer's value. That value was the writer's own name in earlier versions. The current version
   requires `source.ref`, so it is now the citation: a URL or `vehicle_observations/<uuid>`. Neither is a platform slug.

## Measured

- 990 public vehicles have `platform_source = 'correct_vehicle_sale_provenance'`, and each carries exactly one
  `canonical_platform` entry in `provenance_metadata.sale_provenance_corrections`. **133** still hold the corrected
  value and **857 do not** (examples: corrected `bat`, now `cars-and-bids`; corrected `barrett-jackson`, now `bat`).
  Some of the 857 may come from later writes to the source columns. The mechanism above accounts for all of them.
- On 2026-10-15 at 08:34Z, no public row had a ref-shaped `platform_source` (0 beginning `vehicle_observations/`,
  0 beginning `http`). The citation problem is latent until the next platform correction.

## Options

### A. Fix the writer (recommended)
When `v_set ? 'canonical_platform'`:
- also write the trigger's first non-null input to a value that resolves to the corrected platform, so the trigger
  computes the same answer. For example, set `source` to the corrected slug, which `source_alias_mapping` already
  resolves for every slug that has a row.
- write `platform_source` from the corrected platform through the key repaired in #1251
  (`source_registry.observation_source_id` maps `bringatrailer` to `bat`). If no registry row exists, leave
  `platform_source` unchanged. Never write the citation there; it already lives in
  `provenance_metadata.sale_provenance_corrections[].source.ref`.

This changes one writer, keeps the trigger, and makes `canonical_platform` and `platform_source` agree.

### B. Guard the trigger
Have the trigger keep `NEW.canonical_platform` when it differs from `OLD.canonical_platform` and the write is a
sanctioned correction. It touches the hottest trigger on `vehicles`, and the trigger cannot see who wrote. Not
recommended.

## Repair of the 990 stored rows
They need superseding through the same writer once A is in place: the platform value with its source, and the
original kept in the corrections log. This memo does not do that.

## Limits
The trigger behavior is established by Postgres semantics and the live definitions, read 2026-10-15 at 08:34Z (the
writer matches 20261015210000 on main; the trigger function was read from `pg_proc`). It was not reproduced in a local
PG17 run. The 857 count compares current values only; per-row history was not read.

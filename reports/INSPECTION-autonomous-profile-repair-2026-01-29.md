# Inspection: What Went Wrong (Autonomous Profile Repair Loop, 2026-01-29)

## Summary

- **Gallery repairs = 0**: The RPC only changes rows where `vehicle_images.source = 'bat_import'`. Many bat_import vehicles likely have images with `source = 'user_upload'` (default) or NULL, so the RPC did nothing.
- **VIN from metadata = 0**: Extractors (e.g. bat-simple-extract) write VIN to `vehicles.vin` only; they do **not** write `origin_metadata.vin`. So there was nothing to backfill from.
- **3 timeouts**: The repair RPC and/or the batch query hit Supabase statement timeout on heavy vehicles (large galleries, complex CTEs).

---

## 1. Why gallery repairs stayed 0

### RPC behavior

`repair_bat_vehicle_gallery_images` only touches **`vehicle_images` rows where `source = 'bat_import'`**:

- **Partial path** (canonical `origin_metadata.image_urls` missing or &lt; 10): UPDATEs and the “pick primary” query filter with `vi.source = 'bat_import'`.
- **Strict path** (canonical ≥ 10): `to_hide` and primary selection also filter with `i.source = 'bat_import'` / `vi.source = 'bat_import'`.

So if images for a vehicle have `source = NULL` or `source = 'user_upload'`, the RPC matches **0 rows** and returns `marked_duplicates = 0`, `set_primary = 0`.

### Where does `source` get set?

- **bat-simple-extract** (current BaT importer) **does** set `source: 'bat_import'` when inserting `vehicle_images`.
- **Schema default**: `vehicle_images.source` has default `'user_upload'` (migration `ensure_vehicle_images_table`).
- Any other pipeline (process-import-queue, older bat backfills, image backfill from `origin_metadata`) that inserts rows **without** setting `source` will leave `source = 'user_upload'` or NULL.

So the 301 vehicles we processed may be:

- Imported by a path that **didn’t** set `source = 'bat_import'` on their images, or
- Already correct (no UI assets, primary already good), so the RPC had nothing to do.

In both cases the script’s condition `repairResult?.set_primary || repairResult?.marked_duplicates` stays false → **galleryRepairs stays 0**.

---

## 2. Why VIN from metadata was 0

The loop backfills VIN only from **`vehicles.origin_metadata.vin`**:

```ts
const originVin = v.origin_metadata?.vin;
if (vinStr && (!v.vin || !String(v.vin).trim())) {
  await supabase.from('vehicles').update({ vin: vinStr, ... }).eq('id', v.id);
  report.vinBackfilledFromMetadata += 1;
}
```

- **bat-simple-extract** (and the code paths checked) write VIN only to **`vehicles.vin`**. They do **not** set `origin_metadata` or `origin_metadata.vin`.
- So for these bat_import vehicles, `origin_metadata.vin` is effectively never set → nothing to backfill → **vinBackfilledFromMetadata = 0**.

The **9 vinReextractInvoked** calls to bat-simple-extract are the only place new VINs could have been written (into `vehicles.vin`); the report doesn’t record which IDs or whether each call succeeded.

---

## 3. Why there were 3 timeouts

- **2 vehicle-level errors**: “canceling statement due to statement timeout” when calling **`repair_bat_vehicle_gallery_images`** for:
  - `1dc6fc1a-79a9-464d-8c29-29c5ea97dbd6`
  - `0c200f4e-25d0-441f-b9c1-f61f17c85156`
- **1 batch error**: “fetchBatch: canceling statement due to statement timeout” — the vehicles batch query (or the follow-up `vehicle_images` `in(ids)` query) exceeded the DB statement timeout.

The repair RPC does several heavy CTEs and multiple UPDATEs; on vehicles with many images or slow plans, it can exceed Supabase’s default statement timeout (often ~8s). The batch query that fetches vehicles and then images for a large `in(ids)` can also time out.

---

## 4. Recommendations

### A. So the repair RPC actually fixes more vehicles

1. **Backfill `source = 'bat_import'`** for images that belong to bat_import vehicles but don’t have that source:
   - e.g. `vehicle_images` where `vehicle_id` in (select id from vehicles where profile_origin = 'bat_import') and (source is null or source = 'user_upload') and (image_url like '%bringatrailer.com%' or source_url like '%bringatrailer.com%').
   - Then re-run the repair loop (or re-run repair RPC for those vehicle IDs).

2. **Optionally** count “repairs” when the RPC did *any* work, e.g. also when `cleared_primaries > 0`, so the report reflects “we fixed something” even if the primary row was already correct and only duplicates were cleared.

### B. So VIN backfill from metadata can ever be non-zero

1. **Have extractors write VIN into `origin_metadata`** when they extract (e.g. bat-simple-extract: when updating/inserting a vehicle, set `origin_metadata = coalesce(origin_metadata, '{}'::jsonb) || jsonb_build_object('vin', extracted.vin)` when vin is present). Then future backfill runs can use it.
2. Or **drop the “VIN from metadata” path** and rely only on re-extract (bat-simple-extract) for missing VIN; document that in the script.

### C. So timeouts are less likely

1. **Increase statement timeout** for the repair RPC (e.g. `SET LOCAL statement_timeout = '30s'` at the start of the function) or for the session that runs the loop.
2. **Smaller batches** (e.g. `--batch 15`) so each batch and each RPC call is lighter.
3. **Retry** timed-out vehicles once with a longer timeout or skip and log them for a separate “heavy vehicle” run.

### D. Observability

1. **Log which vehicle IDs** get bat-simple-extract invoked (vinReextractInvoked), so you can later query `vehicles` to see if those IDs now have `vin` set.
2. **Sample check**: Run `repair_bat_vehicle_gallery_images(p_vehicle_id, true)` (dry run) for a few vehicle IDs and inspect returned `marked_duplicates`, `set_primary`, `canonical_count`, `partial` to confirm why no work was done (e.g. `source` or canonical mismatch).

---

## 5. Quick checks you can run

```sql
-- How many bat_import vehicles have at least one image with source = 'bat_import'?
SELECT count(DISTINCT v.id)
FROM vehicles v
JOIN vehicle_images vi ON vi.vehicle_id = v.id
WHERE v.profile_origin = 'bat_import'
  AND vi.source = 'bat_import';

-- How many bat_import vehicles have images but none with source = 'bat_import'?
SELECT count(*)
FROM vehicles v
WHERE v.profile_origin = 'bat_import'
  AND EXISTS (SELECT 1 FROM vehicle_images vi WHERE vi.vehicle_id = v.id)
  AND NOT EXISTS (SELECT 1 FROM vehicle_images vi WHERE vi.vehicle_id = v.id AND vi.source = 'bat_import');
```

If the second count is large, that confirms that most bat_import vehicles’ images don’t have `source = 'bat_import'`, so the RPC correctly did nothing and the fix is to backfill `source` then re-run.

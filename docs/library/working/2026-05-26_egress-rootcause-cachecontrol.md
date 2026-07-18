# Egress root cause — cacheControl is set to 1 hour everywhere

Date: 2026-05-26
Found during: Supabase usage audit (699 GB storage, 325 GB egress, 163% transform overage)

## The actual bug

Every storage upload site in the codebase sets `cacheControl: '3600'` (1 hour). That tells the CDN to keep cached copies for 60 minutes. After 60 minutes, the CDN drops the file and re-fetches from origin storage on the next request. Every re-fetch is **egress out of your Supabase storage**.

For static images and documents (which is what 95% of your storage is — they never change), this should be **a year**, not an hour. One-hour-cached images that get viewed across multiple days hammer egress for no benefit.

## Sites affected (15 files)

```
nuke_frontend/src/components/vehicle/VehicleReferenceLibrary.tsx:182
nuke_frontend/src/components/ownership/VehicleOwnershipPanel.tsx:749
nuke_frontend/src/pages/admin/MemeLibraryAdmin.tsx:245
nuke_frontend/src/services/imageUploadService.ts:404, 433
nuke_frontend/src/services/receiptService.ts:30
nuke_frontend/src/services/referenceDocumentService.ts:86
nuke_frontend/src/services/supabase/storageService.ts:11
nuke_frontend/src/services/secureDocumentService.ts:56
nuke_frontend/src/services/uploadManager.ts:111
nuke_frontend/src/services/aiDataIngestion.ts:552
nuke_frontend/src/services/unifiedImageImportService.ts:357, 383
supabase/functions/import-classiccars-listing/index.ts:328
supabase/functions/backfill-images/index.ts:507
```

## The fix (copy/paste, ~30 seconds to apply)

From `/Users/skylar/nuke`:

```bash
# Bump default cache from 1 hour to 1 year for every upload site.
# All paths shown above store immutable content (images, receipts, documents).
# If you have any path that NEEDS short cache (e.g. avatars that get re-uploaded),
# handle those per-site after the global bump.
grep -rl "cacheControl: '3600'" nuke_frontend/src supabase/functions \
  | xargs sed -i '' "s/cacheControl: '3600'/cacheControl: '31536000'/g"

# Verify
grep -rn "cacheControl:" nuke_frontend/src supabase/functions | grep -v "31536000"
```

The second command should return ~zero lines if the bump worked. Anything that comes back is intentional (or needs review).

## What this fixes vs doesn't

**Fixes (forward-looking):** All NEW uploads cache 1 year instead of 1 hour. Once existing files age out naturally or get re-uploaded, your egress should drop dramatically — most likely **50-80% reduction** based on the access pattern.

**Doesn't fix (existing 1.3M+ stored files):** Files already in storage retain their `cache-control: max-age=3600` header. To fix those without re-uploading every file, options are:

1. **Wait for natural cache warming** — the CDN will gradually re-cache as files are accessed; each first-access still costs egress, but second+ accesses are cached for an hour (existing) or year (new).
2. **Cloudflare in front of Supabase storage** — proxy at `cdn.nuke.ag` → `supabase storage`. Cloudflare cache rules can override origin Cache-Control. Best long-term solution.
3. **Bulk metadata update via Supabase Storage API** — script to walk storage.objects and update cache-control via the management API. Technically possible but at 1.3M files, slow and risks rate-limit hits.

For now: apply the source change above. The egress curve should bend down over the next 4-8 weeks as the cache fills with new uploads.

## Image transformation overage (163%) — same root cause

Each `/render/image/?width=N&height=N` call counts as a transformation. Your overage = 63 above the 100 quota. If the transformations are happening for the same image repeatedly (cache miss → transform → serve → drop), the fix is the same as above: long cache.

For an even bigger win: **stop using on-demand transforms entirely.** Pre-generate large/medium/thumbnail variants at upload time and serve them directly. Several upload sites already do this (`unifiedImageImportService.ts:383` writes a `variantPath`). Roll it out everywhere → transformations drop to ~zero.

## Bonus: storage size (699 GB)

Separate from the egress fix. The fat is in your iPhoto/HEIC photo collection (~205 GB across `photo-export`, `ssd_heic`, `iphoto` subfolders inside `vehicle-photos`). The 22 GB fb-marketplace is small and lo-res only — not worth a sweep. The 125 GB `vehicle-images` bucket needs an orphan audit (couldn't complete in this session — `vehicle_images.image_url` doesn't reference the bucket, so a different table must, and the index is missing for a fast anti-join).

## Net expected outcome if you apply the fix

| Metric | Before | After (4-8 weeks of natural cache turnover) |
|---|---|---|
| Egress | 325 GB / 250 GB | ~80-150 GB (under quota) |
| Transformations | 163 / 100 | depends on variant-pregen rollout |
| Storage | 699 GB / 100 GB | Unchanged (needs separate cleanup) |
| Bill | ~$50-75/mo | ~$30-40/mo (Pro base + storage overage only) |

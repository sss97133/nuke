# Video, screen-recording and screenshot sync — findings, plan, rules

Status: **plan + code behind a flag that is OFF by default**. The migration
(`supabase/migrations/20261109100000_capture_media_bucket.sql`: one private bucket + storage policies, no table
change) is written and **not applied**; merging this PR to `main` applies it automatically
(`supabase-deploy.yml`), so the owner approves it first.

Measured read-only on 2026-11-04 (project `qkgaybvrernstplzjaam`). Counts are for the owner's account
(`0b9f107a…`, the only user in `capture_upload_status`); other users were not measured.

## Owner scope (2026-11-04)

No bulk video sync. Never pull personal content. A video, screen recording or screenshot is picked up **only
inside an existing vehicle capture context** (screenshots may also match on on-device text); anything that does
not match stays on the phone and never uploads. A match uploads a low-resolution preview plus metadata first.
The full file stays on the phone until the item is attributed to a vehicle. All of it is behind a switch that is
OFF by default. Storage reuses the existing `vehicle_images` video columns (owner direction, verified below).

## 1. How photo sync works today

| Step | Where | What |
|---|---|---|
| Fetch | `SyncEngine.sync()` | `PHAsset.fetchAssets`, `mediaType == image`, `creationDate > watermark − 3 days`, 200 per pass, newest first; watermark advances only on a pass with zero failures |
| Gates | `SyncEngine.processAsset` | GPS site gate, asset/seen-set dedupe, Apple-camera EXIF, on-device triage (`VisionEngine.triage`) |
| Upload (pixels) | `UploadQueue.swift` | original bytes staged, a **background URLSession** `POST /storage/v1/object/vehicle-photos/users/<uid>/capture-relay/<sha256>/<filename>` (single request, not resumable) |
| Row | `SupabaseService.buildImageRow` | `vehicle_images` insert **after** a 200/409 from storage: `source='capture_relay_ios'`, `ai_processing_status='pending'`, `file_hash`, `storage_path`, `image_url` (public URL) |
| Row (held pixels) | `SupabaseService.uploadPhoto(uploadPixels:false)` | metadata-only row: `image_url=''`, `storage_path`/`file_hash` null, `ai_processing_status='skipped'`, `file_size` = the real byte count |
| After | `AttributionEngine`, `device_file_images`, `attribute_testimony` | filing to a vehicle; nothing writes `vehicle_id` from the client |

`capture_upload_status` is a table (not a view) written by the server pipeline: stage `classified` 4,436,
`uploaded` 886, `attached` 673, `failed` 31 (30 `classifier_rate_limited` HTTP 429 on 2026-11-04; 1
`classifier_response_invalid` on 2026-06-14). It has no row for a file that failed to upload.

**Video columns that already exist, verified read-only (2026-11-04).** `vehicle_images` has `is_video`
(boolean, default false), `duration_seconds` (numeric), `video_codec`, `video_resolution`, `mime_type`,
`ingest_kind` (check: live/backfill/import) and `image_medium` (check allows `screenshot`, `camera`, `other`…).
Nothing fills them: table-wide planner statistics (`pg_stats`) show `is_video` false for 100% of rows,
`video_codec`, `video_resolution` and `duration_seconds` null for 100%, `mime_type` null for 99.8% with only
`image/jpeg|webp|heic|png` values. For the owner's account an exact count agrees (0 of 29,749). (An exact
table-wide count times out; the statistics are the table-wide evidence.) So the claim is true, and this plan
uses those columns instead of a new table. The app's PhotoKit fetch has only ever been `.image`, and screenshots
(`PHAssetMediaSubtype.photoScreenshot`) are skipped (`SyncEngine` "screenshot" off-site reason).

**Buckets (verified).**

| Bucket | Public | Size limit | Allowed mime types |
|---|---|---|---|
| `vehicle-images` | yes | 50 MB | **image/jpeg, image/jpg, image/png, image/gif, image/webp only** (no video, no HEIC) |
| `vehicle-photos` (photo sync) | yes | none | none |
| `masters` | no | 200 MB | none |
| `vehicle-data` | yes | 1 GB | none |
| `vehicle-models` | no | 500 MB | model/zip/json/csv types |

The report that `vehicle-images` is image-only is true. The project-wide Storage upload limit is a dashboard
setting that SQL cannot read. **Proposed fix (reviewable, not applied):** a new **private** bucket
`capture-media` (500 MB, video + image mime types) with owner-only policies, in
`supabase/migrations/20261109100000_capture_media_bucket.sql`. Not recommended: adding video mime types to
`vehicle-images` or putting video in `vehicle-photos`, because both are public and a screen recording or
screenshot of a private conversation must not have a public URL.

**Triggers and policies on `vehicle_images` that a new kind of row meets (read-only):** 50 triggers. Relevant:
the photo pipeline fires only on `ai_processing_status = 'pending'` (these rows are `'skipped'`);
`capture_upload_status` and the clip carrier fire only for `source = 'capture_relay_ios'` (these rows use
`capture_relay_ios_media`); `capture_relay_default_vehicle_fn` files a NULL-vehicle row to a default vehicle only
when the object path contains the owner's marker (ours never does). The public read policy shows a row only
when `is_sensitive` is false, the gate is not rejected/review, and its vehicle `is_public`; a row with no
`vehicle_id` is never public, and a screenshot or screen recording is inserted `is_sensitive = true`.

### The 276 rows with no file

`vehicle_images` where `user_id` = owner, `source='capture_relay_ios'`, `image_url=''` (and `storage_path`,
`file_hash` null): **276 rows** = 271 created 2026-06-18…06-21 (67 on 06-19, 25 on 06-20, 179 on 06-21) +
5 created 2026-10-24…10-29. All 276: `ai_processing_status='skipped'`, `vision_gate_status='pending'`,
`is_sensitive=false`, `exif_data.synced_by='capture-relay-ios'`, a real `file_size` and `taken_at`.
That is the signature of `uploadPhoto(uploadPixels:false)`: **the on-device privacy triage held the
pixels on purpose and uploaded a metadata-only row.** They are not failed uploads.

- The background queue (since 2026-10-29) inserts a row only after storage returned 200/409, so a failure
  there leaves a file without a row, or neither, never a row without a file. A sample of the newest 300
  pixel rows (since 2026-10-15) all have their storage object (300/300).
- The 271 June rows are the first days after the triage shipped (`6ddbdf6b3`, 2026-06-17). Until 2026-10-15
  the rule required an affirmative vehicle label, so measurement shots and part close-ups were held;
  later rules hold documents, screenshots, and people in frame (`VisionDecision`). The database cannot
  say which rule held each row (the decision log is on the phone).
- Re-queuing these rows as they are would **upload pixels the privacy rule holds**, including photos with
  people in frame. So no re-queue PR was opened. See "Decisions needed".

Retry paths that exist: `retryGaveUp()` (Today screen), `enqueueBackfill`, the upload queue's own
retry; none revisits a metadata-only row, because the asset is marked seen once its row is in.

**CI note.** The first version of this PR added a `capture_video_assets` table; the repo's pii-exposure gate
failed it (latitude/longitude granted to `authenticated`). Moving to the existing `vehicle_images` columns
removed that table and the finding.

## 2. Plan

**Matching rules** (`VideoCaptureMatcher`, `ScreenshotVehicleTerms`; pure, unit-tested):

| Item | Matches when |
|---|---|
| Camera video | a photo **already filed to a vehicle** (`vehicle_id` set; not sensitive, superseded, duplicate, and not a clip or screenshot this feature filed) was taken within **30 min** before the clip starts or after it ends, **and** within **150 m** of the clip's GPS fix. No GPS = no match. Two vehicles = ambiguous = no match |
| Screen recording | it started inside one vehicle's **acquisition window: 7 days before through 2 days after `vehicles.purchase_date`** (local calendar days, through the end of the 2nd day). No GPS (a screen recording has none). Overlapping windows of two vehicles = no match |
| Screenshot, context | **a filed photo within 30 min** of the screenshot, **and within 150 m when the screenshot carries GPS** (most do not; then time alone), **or** the acquisition window above. Two vehicles = no match |
| Screenshot, text | only if the context rules did not match: Vision text recognition **on the phone** finds a **VIN with a valid check digit** (I/O/Q read as 1/0/0), or a **model year 1900–2029 immediately followed by a make** ("1972 Chevrolet"; a fixed list of ~55 makes). No vehicle is suggested for a text match |
| Video, either kind | length 1 s to **10 min**; a longer clip never matches |
| All | only items from the **last 14 days**, newest first, 60 videos + 60 screenshots read per pass; at most **3** video previews, **10** screenshot previews and **25** OCR reads per pass; iCloud-only originals are never downloaded |

PhotoKit is read for **metadata only** (creation date, duration, GPS, pixel size); no bytes are read for an
item that matches by context. A screenshot that does not match by context is decoded once to ~1600 px **on the
phone** for text recognition. The recognized text is held in memory for the check and then dropped: never
stored, never logged, never sent. Only the class of match (`vin`, `year_make`) is written, in the row's match
basis. A screenshot checked and not matched is remembered by hash only, so it is not read twice. A screen
recording is `PHAssetMediaSubtype.videoScreenRecording` or a resource named `RPReplay…`; when unsure the
stricter rule applies.

**Upload.** Preview = for video the first 60 s, video track only (no audio), 640x480 or smaller, MP4, 25 MB
cap; for a screenshot a JPEG of at most 1280 px on the long edge, quality 0.6, no EXIF/GPS, 2 MB cap.
Both go to the **private** `capture-media` bucket by a **resumable TUS upload** (6 MiB chunks, resumes from
the server's offset after a drop or relaunch). **Wi-Fi only by default**: gated on `NetworkMonitor.isUnmetered`
and on a URLSession with cellular / expensive / constrained access off; stops on Low Power Mode or a hot phone.
Runs at the end of each photo sync pass, so it adds no new background task identifier.

**Record = one `vehicle_images` row per matched item**, using the existing columns:

| Column | Value |
|---|---|
| `id` | client-generated uuid (the full-file object name uses it) |
| `vehicle_id` | **not set.** The phone only suggests, in `auto_suggested_vehicle_id` + `auto_suggestion_reasons` (the rule name); a person files it |
| `is_video`, `duration_seconds`, `video_codec`, `video_resolution`, `mime_type` | filled for video (codec of the source track, original pixel size, preview mime); `is_video=false`, `image/jpeg` for a screenshot |
| `image_url` | `''` (the sentinel the metadata-only photo rows use): the object is private, no public URL |
| `storage_path` | the preview path; after the full file lands, the full path (`users/<uid>/full/<row id>.<ext>`), with `file_size` and `mime_type` updated |
| `source` | `capture_relay_ios_media` (so the capture_relay_ios triggers and status table do not run) |
| `image_medium` | `camera` (video), `screenshot`, `other` (screen recording) |
| `ai_processing_status` | `skipped` (the photo pipeline does not run) |
| `is_sensitive` | `true` for screenshots and screen recordings (public read policy skips them even after filing) |
| `taken_at`, `latitude`, `longitude` | capture time; GPS only if the camera clip / screenshot carries it (never for a screen recording) |
| `exif_data` | `synced_by`, `asset_key` (sha256 of user id + PhotoKit id), `media{kind, bucket, preview_path, preview_bytes, full_state:"held_on_phone", device model/OS, width, height, match{rule, anchors, window_seconds, radius_m, days_before, days_after, terms}}` |

Not sent: the PhotoKit id, audio, OCR text, the original file name.

**Full file.** Stays on the phone. It uploads only when the row has a `vehicle_id` **and
`user_confirmed_vehicle = true`** (a vehicle alone is not enough because automatic attribution also sets it).
Enforced by the storage INSERT policy on `capture-media/users/<uid>/full/<row id>.*`, which looks the row up by
primary key; the app checks the same thing first. Nothing in the app sets `user_confirmed_vehicle` today (one
row in the table has it), so no full file moves until a screen confirms an item.

**Privacy default.** Photos with people in frame still never upload raw. For these items: nothing uploads unless
it matches; previews are silent / low-res / metadata-free; the bucket is private; the full file waits for the
owner's confirmation. Known cost of the screenshot rules: a personal screenshot taken inside the acquisition
window, or within 30 minutes of a filed photo, or one that contains a year + make, will upload a **preview**
(private, `is_sensitive`) for review. That is the price of "inside a capture window" being a time test.

**Reader risk of sharing `vehicle_images`** (not changed here): once an owner files an item to a vehicle,
`has_photos`, image counts and some vehicle activity triggers count it like a photo; its `image_url` is empty, so
galleries must skip `source = 'capture_relay_ios_media'` or `is_video`. Recommend a follow-up that adds that
filter before any screen shows these rows, and a signed-URL reader using `exif_data.media.bucket` + `storage_path`.

## 3. What is built (this PR)

`Sources/NukeCapture/VideoSync/`: `VideoSyncConfig` (switch + numbers), `VideoCaptureMatcher`,
`ScreenshotVehicleTerms`, `TusUpload`, `VideoSyncLedger`, `VideoSyncEngine`; one line in `SyncEngine.sync()`.
The switch is the UserDefaults key `videoSync.enabled` (absent = OFF); no screen turns it on (another agent
owns the iOS screens), so nothing runs until someone sets it. Tests: `VideoCaptureMatcherTests`,
`ScreenshotVehicleTermsTests`, `VideoSyncTests`.

Not built: a Settings toggle; the confirm-and-file buttons (they would set `vehicle_id` +
`user_confirmed_vehicle`); the reader filters above; any change to photo sync, to existing rows, or the
re-triage of the 276 held photos.

## 4. Decisions needed from the owner

1. Approve (or change) `20261109100000_capture_media_bucket.sql`; merging applies it.
2. Bucket choice: new private `capture-media` (recommended) vs loosening a public bucket (not recommended); 500 MB cap and the project-wide Storage limit.
3. Reusing `vehicle_images` (this PR) vs a new table (earlier version): confirm, given the reader risk above.
4. What counts as "attributed" for the full file: `vehicle_id` + `user_confirmed_vehicle` (as built) or `vehicle_id` alone.
5. Matching numbers: 30 min / 150 m; acquisition window −7/+2 days; 10 min clip cap; 14-day lookback.
6. Acquisition-window source: only 7 of the owner's 150 vehicles have `purchase_date`; use another date?
7. Screenshots with no GPS match on time alone: accept, or require the text match as well?
8. The OCR rule (valid VIN or year + make) and the make list.
9. Screen recordings and screenshots: preview upload at all, or hold previews for review?
10. The 276 held photo rows: leave held, or re-triage under today's rule (needs UPDATEs; not done).
11. A Settings toggle and a confirm/file UI for these items (not built).

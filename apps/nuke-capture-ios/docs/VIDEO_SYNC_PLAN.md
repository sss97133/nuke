# Video and screen-recording sync — findings, plan, rules

Status: **plan + code behind a flag that is OFF by default**. The migration
(`supabase/migrations/20261109100000_capture_video_assets.sql`) is written and **not applied**; merging
this PR to `main` applies it automatically (`supabase-deploy.yml`), so the owner approves it first.

Measured read-only on 2026-11-04 (project `qkgaybvrernstplzjaam`). Counts are for the owner's account
(`0b9f107a…`, the only user in `capture_upload_status`); other users were not measured.

## Owner scope (2026-11-04)

No bulk video sync. Never pull personal content. A video is picked up **only inside an existing vehicle
capture context**; anything that does not match stays on the phone and never uploads. A match uploads a
low-resolution preview plus metadata first. The full file stays on the phone until the clip is attributed
to a vehicle. All of it is behind a switch that is OFF by default.

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

**Video columns that already exist** on `vehicle_images`: `is_video`, `duration_seconds`, `video_codec`,
`video_resolution`, `mime_type`, `ingest_kind` (`live`/`backfill`/`import`). **None are used**: 0 of the
owner's 29,749 rows have `is_video`, a duration or a `video/*` mime type. The app's `PHAssetMediaType`
fetch has only ever been `.image`.

**Buckets.** `vehicle-photos` is PUBLIC with no bucket `file_size_limit` and no mime filter (the
project-wide Storage limit, a dashboard setting, also applies and is not readable from SQL). For
comparison: `vehicle-images` 50 MB images only; `masters` 200 MB private; `vehicle-data` 1 GB public;
`vehicle-models` 500 MB private. Storage RLS on `vehicle-photos` allows INSERT only into
`users/<own uid>/…`. A video must not go to a public bucket.

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

## 2. Plan

**Matching rules** (`VideoCaptureMatcher`, pure, unit-tested):

| Clip | Matches when |
|---|---|
| Camera video | a photo **already filed to a vehicle** (`vehicle_images.vehicle_id` set; not sensitive, superseded or duplicate) was taken within **30 min** before the clip starts or after it ends, **and** within **150 m** of the clip's GPS fix. No GPS on the clip = no match. Photos naming two vehicles = ambiguous = no match |
| Screen recording | it started inside one vehicle's **acquisition window: 7 days before through 2 days after `vehicles.purchase_date`** (local calendar days, end of the 2nd day). No GPS is used (a screen recording has none). Two overlapping windows = ambiguous = no match |
| Either | a clip over 10 min or with no duration never matches; only clips from the **last 14 days**, newest first, 60 per pass, 3 previews per pass. iCloud-only originals are never downloaded |

PHAssetMediaType.video is fetched for **metadata only** (creation date, duration, GPS, size in pixels);
no bytes are read for a clip that does not match. A screen recording is `PHAssetMediaSubtype.videoScreenRecording`
or, failing that, a resource named `RPReplay…`; when unsure the stricter screen-recording rule applies.

**Upload.** Preview = first 60 s, video track only (no audio), 640x480 or smaller, MP4, 25 MB cap, to the
**private** `capture-video` bucket by a **resumable TUS upload** (6 MiB chunks, resumes from the server's
offset after a drop or relaunch). **Wi-Fi only by default**: gated on `NetworkMonitor.isUnmetered` and
on a URLSession with cellular / expensive / constrained access off; also stops on Low Power Mode or a hot phone.
Runs at the end of each photo sync pass (foreground, the recent-window and charging jobs), so it adds no new
background task identifier.

**Metadata** (table row): taken_at, duration, GPS (camera video only), `device_model` (`iPhone17,1`),
OS, pixel size, the match rule and its numbers, and the suggested vehicle.

**Full file.** Stays on the phone. It uploads only when the server row is `attributed` (the owner chose a
vehicle: `capture_video_attribute`), and for a **screen recording also only after the owner's explicit
`capture_video_confirm_full`**. Enforced in the database (storage INSERT policy + `capture_video_mark_full_uploaded`),
not just in the app.

**Table: recommendation = new table `capture_video_assets`** (private by RLS, owner-only, no public policy),
not a `media_type` column on `vehicle_images`. `vehicle_images` already has video columns but every reader
of it assumes a still with a public URL (gallery eligibility, vision gate, the pending-INSERT trigger, public
SELECT policy for public vehicles), and a clip has a two-step life. Promotion into `vehicle_images` after
attribution is a separate, reviewed change.

**Privacy default.** Photos with people in frame still never upload raw. For video: nothing uploads unless
it matches a vehicle context; the preview is silent and low-resolution; the bucket is private; the
screen-recording full file is held on the phone until the owner confirms it. Proposed: a screen-recording
preview is itself reviewable, so an owner who prefers can set the match to "held for review" (not built).

## 3. What is built (this PR)

`Sources/NukeCapture/VideoSync/`: `VideoSyncConfig` (the switch, numbers), `VideoCaptureMatcher`,
`TusUpload`, `VideoSyncLedger`, `VideoSyncEngine`; one line in `SyncEngine.sync()`. The switch is the
UserDefaults key `videoSync.enabled` (absent = OFF); no screen turns it on (iOS screens are being changed
by another agent), so nothing runs until someone sets it. Tests: `VideoCaptureMatcherTests`,
`VideoSyncTests`.

Not built: a Settings toggle, the attribute / confirm-full buttons (they call `capture_video_attribute`
and `capture_video_confirm_full`), a "held for review" mode, promotion into `vehicle_images`.

# Vehicle video sync, attributed by content — findings, plan, rules

Status: **plan + code behind a flag that is OFF by default**. The migration
(`supabase/migrations/20261109100000_capture_media_bucket.sql`: one private bucket + storage policies, no table
change) is written and **not applied**; merging this PR to `main` applies it automatically
(`supabase-deploy.yml`), so the owner approves it first.

Measured read-only on 2026-11-04 (project `qkgaybvrernstplzjaam`). Counts are for the owner's account
(`0b9f107a…`, the only user in `capture_upload_status`); other users were not measured.

## Owner rule (2026-11-04, latest)

No confirm tap. A media item **auto-attributes to a vehicle only when its content evidence clears the same
confidence threshold photos use**. Content evidence = video frames, read on the phone by the same classifier,
plate/VIN readers and filing gate as photos. **Time and GPS only narrow the candidate vehicles; they never
attribute on their own.** Anything below the threshold stays on the phone, nothing about it is sent, and the user
is never prompted. A full-file upload is allowed once the item is auto-attributed (`vehicle_id` set by that gate).
Preview and full file stay private. Everything is behind a switch that is OFF by default, no bulk sync, no history
(14 days), storage reuses the existing `vehicle_images` video columns.

(Earlier scope this replaces: context-only matching with a "suggested" vehicle and a human confirm before the full
file; acquisition windows; screenshot OCR terms. All removed.)

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
`capture-media` (500 MB, video mime types only) with owner-only policies, in
`supabase/migrations/20261109100000_capture_media_bucket.sql`. Not recommended: adding video mime types to
`vehicle-images` or putting video in `vehicle-photos`, because both are public and a clip must not have a public URL.

**Triggers and policies on `vehicle_images` that a new kind of row meets (read-only):** 50 triggers. Relevant:
the photo pipeline fires only on `ai_processing_status = 'pending'` (these rows are `'skipped'`);
`capture_upload_status` and the clip carrier fire only for `source = 'capture_relay_ios'` (these rows use
`capture_relay_ios_media`); `capture_relay_default_vehicle_fn` files a NULL-vehicle row to a default vehicle only
when the object path contains the owner's marker (ours never does). The public read policy shows a row only
when `is_sensitive` is false, the gate is not rejected/review, and its vehicle `is_public`; a row with no
`vehicle_id` is never public.

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

### 2a. The attribution gate

**1. Narrow (time + GPS only; `VideoCaptureMatcher`).** For a camera video, the *candidate vehicles* are the
vehicles of photos **already filed to a vehicle** (`vehicle_id` set; not sensitive, superseded, duplicate, and not a
clip this feature filed) taken within **30 min** before the clip starts or after it ends **and** within **150 m** of
the clip's GPS fix. No GPS, or no filed photo nearby = no candidates = the clip is **not read at all**. Several
vehicles nearby are all candidates; the frames choose. Clips over **10 min** are not read. Never attributes.

**2. Read the frames on the phone (`VideoSyncEngine`).** 12 frames evenly spaced through the local file
(`AVAssetImageGenerator`, up to 4096 px, iCloud-only originals never downloaded). Each frame goes through the
**photo code itself**: `VisionEngine.classify` + `detectProminentFace` → `VisionDecision.decide`;
`OnDeviceAnalysis.analyzeIdentity` (the identity text reader: the VIN and plate reader photos use) →
`VisionEngine.vinCandidates/checkedVINs/labelledClassicSerialCandidates`, `isIdentityDocument`, `matchSerial`
against the owner's roster (`user_associated_vehicle_ids` → `vehicles`), `AttributionEngine.qualifiedIdentityRead`.
Frames, text and reads are never stored, logged or sent. A frame that cannot be read (Vision held, hot phone,
unavailable classifier/face detector) makes the clip *unread*, never "fine"; it is retried on a later pass.

**3. Gate (`MediaAttributionGate`, pure, unit-tested).** The clip clears only if:
- it is a camera video (never a screen capture);
- **every** sampled frame passes the photo pixel rule (`VisionDecision` = `work`: no person, no document/web
  capture), because the preview uploads those pixels; no frame is an identity document (invoice, receipt…);
- at least one frame has an **exact** (edit distance 0), single-identifier, qualified read (Apple Vision source,
  observation confidence ≥ 0.9, not repaired) of **exactly one** of the owner's vehicles, and no other identifier
  read anywhere in the clip (an inexact read of another vehicle, an unknown VIN, two serials on a frame all block);
- that vehicle is one of the **candidates** from step 1;
- confidence = the photo formula: **0.99** with a 17-character VIN (`vin_ocr`), **0.97** for an older serial
  (`serial_ocr`); both ≥ the server floor **0.9**. Fuzzy (edit distance 1–2) reads, which photos only suggest, never
  attribute a clip.

Anything else is refused: the clip stays on the phone, only its asset key and a fixed refusal word are remembered
(so it is not read twice), and the user is not asked anything.

### 2b. Which parts of the gate only exist on the server, and how they are handled

The photo gate has a phone half (above) and a server half in `device_file_images` → `device_file_images_as` →
`attribute_testimony`: caller owns the row; the vehicle is one of the caller's associated vehicles; the row is not
superseded and its `vision_gate_status` is not rejected; the vehicle is not merged-away/deleted; method
`vin_ocr`/`serial_ocr` with confidence ≥ 0.9 and a vehicle serial of the right length; first attribution only; a
`reattribution_audit` row; `vehicle_id` written. The phone cannot run these, and the RPC needs an existing
`vehicle_images` row, so "evaluate before anything uploads" is done like this:

1. The phone's half decides first. If it does not clear, **nothing is sent** (no row, no object).
2. If it clears, the phone inserts a **metadata-only row** (no pixels, no object, `image_url=''`, no `vehicle_id`,
   `ai_processing_status='skipped'`; duration/codec/resolution/GPS/time and the match basis numbers).
3. It calls **`device_file_images`** with the gate's method and confidence. The server's half runs and sets
   `vehicle_id`, or refuses (`not_associated`, `conflict`, `gate_rejected`, …) or defers (`deferred`/`busy`: retried
   on later passes, up to 8).
4. **Only when `vehicle_id` is set** does the phone export and upload the low-res preview, then the full file. The
   storage policy enforces it: an object under `capture-media/users/<uid>/(previews|full)/<row id>.*` is refused
   unless that row is the caller's, `source='capture_relay_ios_media'`, and has a `vehicle_id`. No
   `user_confirmed_vehicle` is read. The app also checks the filed state before each transfer.
5. If the server refuses, the row remains **metadata-only** and no object is uploaded.

Server-only and not re-run on the phone: association, supersession, rejected-gate states, VIN-length checks, audit.
Not run for these rows at all: the cloud vision gate (`vision_gate_status`), which only runs on pending photos with an
uploaded image; media rows are `skipped` with no image, so the privacy decision for these pixels is the on-device
`VisionDecision` on all 12 frames. No server change is required for this PR beyond the bucket and policy.

### 2c. Screenshots and screen recordings

Under the stated rule ("same classifier, plate and VIN readers and filing gate as photos") they can **never** clear:
the photo gate treats a screenshot as a document (`VisionEngine.isUnnecessary(isScreenshot:)` → `isIdentityDocument`
→ no identifier is accepted from a document, and `VisionDecision` holds the pixels), and a VIN printed on a document
cannot file a photo. So this PR does **not** read, upload or attribute screenshots or screen recordings: the
screenshot and acquisition-window code, OCR-term matching and image preview path were removed. Whether a separate
screen-capture evidence rule should exist is decision 1 below.

### 2d. Upload

Preview = first 60 s, video track only (no audio), 640x480 or smaller, MP4, 25 MB cap. Full file = the original
resource copied from the phone (needs ≥ 2 GB free; never from iCloud). Both go to the **private** `capture-media`
bucket by a **resumable TUS upload** (6 MiB chunks, resume from the server's offset). **Wi-Fi only by default**
(`NetworkMonitor.isUnmetered`, URLSession with cellular/expensive/constrained off); stops on Low Power Mode or a hot
phone. Runs at the end of each photo sync pass (no new background task identifier). Per pass: 60 videos listed
(metadata), at most 6 clips' frames read.

### 2e. The record: one `vehicle_images` row per attributed clip

| Column | Value |
|---|---|
| `id` | client-generated uuid; both object names use it |
| `vehicle_id` | **not set by the app**: `device_file_images` sets it after its checks. The row also carries `auto_suggested_vehicle_id` + reason `media_gate_v1` |
| `is_video`, `duration_seconds`, `video_codec`, `video_resolution`, `mime_type` | filled (codec of the source track, original pixel size, `video/mp4`) |
| `image_url` | `''` (the sentinel metadata-only rows use): objects are private, no public URL |
| `storage_path`, `file_size` | absent until an object lands: the preview path, then (full file) the full path with real size and mime |
| `source` | `capture_relay_ios_media` (the capture_relay_ios triggers and status table do not run) |
| `image_medium`, `ai_processing_status`, `is_sensitive`, `ingest_kind` | `other`, `skipped`, `false`, `live` |
| `taken_at`, `latitude`, `longitude` | capture time and the clip's GPS fix |
| `exif_data` | `synced_by`, `asset_key` (sha256 of user id + PhotoKit id), `media{kind, bucket, preview_path, full_state, device model/OS, width, height, match{rule:"media_gate_v1", method, confidence, frames_sampled, frames_exact, candidates, anchors, window_seconds, radius_m}}` |

Not sent: the PhotoKit id, audio, OCR text, frames, the identifier read, the original file name.

**Reader risk of sharing `vehicle_images`** (not changed here): once filed, `has_photos`, image counts and some
vehicle activity triggers count a clip like a photo; its `image_url` is empty, so galleries must skip
`source = 'capture_relay_ios_media'` or `is_video`. Recommend a follow-up that adds that filter before any screen shows
these rows, and a signed-URL reader using `exif_data.media.bucket` + `storage_path`. Unlike the earlier design,
attributed rows now carry a real `vehicle_id` with no human step, so this matters sooner.

## 3. What is built (this PR)

`Sources/NukeCapture/VideoSync/`: `VideoSyncConfig` (switch + numbers), `VideoCaptureMatcher` (narrowing only),
`MediaAttributionGate` (gate + per-frame evidence from the photo readers' outputs), `TusUpload`, `VideoSyncLedger`
(cleared → rowInserted → filed → transfers; refused/filed words), `VideoSyncEngine`; one line in `SyncEngine.sync()`.
Removed: `ScreenshotVehicleTerms`, the acquisition-window and screenshot paths, the confirm-gated full-file step.
The switch is the UserDefaults key `videoSync.enabled` (absent = OFF); no screen turns it on (another agent owns the iOS
screens). Tests: `VideoCaptureMatcherTests` (narrowing), `MediaAttributionGateTests` (gate rules and per-frame
evidence), `VideoSyncTests` (switch, paths, TUS requests, ledger, row shape).

Not built: a Settings toggle; the reader filters above; any change to photo sync, to existing rows, or the re-triage of
the 276 held photos. The frame-reading path (AVAssetImageGenerator + Vision on real video) is compile-checked by CI
only; it has not run on a device.

## 4. Decisions needed from the owner

1. **Screenshots and screen recordings never clear** under the photo gate (they are documents there), so they are
   not synced at all now. Accept that, or approve a separate screen-capture evidence rule (e.g. a valid VIN read from
   the screenshot's OCR, filed at a stated confidence, with its own privacy rule since a screenshot can show a
   private conversation).
2. **Clips with no nearby filed photo are not read** (no candidates). Accept, or let a clip's frames match against the
   whole roster (more reads; time/GPS then narrow nothing).
3. **Gate strictness:** all 12 frames must be `work` (a person in any frame holds the whole clip), one exact frame is
   enough, 12 frames per clip, up to 6 clips read per pass. Tighten (e.g. two exact frames) or loosen?
4. **A refused clip is not read again** (asset key + refusal word). Accept, or re-read when new photos are filed.
5. **A server-refused or never-filed clip leaves a metadata-only row** (no pixels). Accept, or have the app remove it
   (needs a delete grant the app does not have).
6. **`album_map` is not media evidence** (an album can't say what a clip shows). Confirm.
7. **The storage policy relies on `vehicle_id` set** (filed by the server gate), not on a join to the audit row.
8. **No cloud vision gate** runs on these rows; privacy is the on-device decision. Accept, or add a server check.
9. Approve (or change) `20261109100000_capture_media_bucket.sql`; **merging applies it**. Bucket choice, 500 MB cap and
   the project-wide Storage limit.
10. Reusing `vehicle_images` (reader risk above) vs a new table.
11. Numbers: 30 min / 150 m narrowing; 10 min clip cap; 14-day lookback; frames per clip.
12. A Settings toggle (not built); the 276 held photo rows: leave held, or re-triage under today's rule (needs UPDATEs;
    not done).

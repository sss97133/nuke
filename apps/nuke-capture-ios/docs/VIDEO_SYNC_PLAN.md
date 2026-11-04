# Vehicle video sync, attributed by content — findings, plan, rules

Status: **plan + code behind a flag that is OFF by default**. Two migrations are written and **not applied**:
`supabase/migrations/20261109100000_capture_media_bucket.sql` (one private bucket + storage policies) and
`20261109100100_capture_media_acquisition_document.sql` (the RPC `device_file_media_document` for screen captures).
Neither changes a table or column. Merging this PR to `main` applies both automatically (`supabase-deploy.yml`), so the
owner approves them first. The RPC has been syntax-checked only (pglast); it has never been executed.

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

**Update (2026-11-04, acceptance test): screen recordings and screenshots must be supported.** They are *documents*,
not photos, so they do not go through the photo gate. They have their own evidence rule, `screen_text_v1`
(section 2c), still decided on the phone, still behind the same switch.

(Earlier scope this replaces: context-only matching with a "suggested" vehicle and a human confirm before the full
file; acquisition windows; screenshot OCR terms. All removed.)

## Acceptance test: the '64 Corvette (vehicle `2e5ec4a1`)

**This is THE acceptance test for this PR.** Everything else is in service of it. It has two days and four steps.

Starting state, read from the database (read-only, 2026-11-04): vehicle `2e5ec4a1-c5fc-456d-8cff-82c6e582fd58`,
1964 Chevrolet Corvette, owned by the account `0b9f107a…`, **`vin` null, `purchase_date` null**, 27 photos filed to it,
the earliest taken **2023-09-17 05:27:58 UTC**. Nothing exists for 2023-09-16.

| # | Step | Expected | PASS when | FAIL when |
|---|---|---|---|---|
| 1 | **Sep 16, 2023** Facebook Marketplace screen recording of the purchase negotiation is on the phone. Switch on. A photo sync pass finishes. | The phone finds it (it is a `videoScreenRecording` made inside the Corvette's acquisition window), reads 12 frames of its first 60 s with Vision OCR **on the device**, and sees the Corvette, the price and the seller. | The pass log shows the item read and attributed (`screen captures: 1 attached as documents`), and no upload happened before the next step's server call succeeded. | It is never listed (window or anchor wrong), is read but refused (OCR missed the year/make/model line or the price/seller), or anything leaves the phone before the server attaches it. |
| 2 | The server attaches it. | A metadata-only `vehicle_images` row (`source capture_relay_ios_media`, no pixels, no `vehicle_id`) is inserted; `device_file_media_document` revalidates and **creates one `vehicle_documents` row**: `document_type acquisition_document`, `privacy_level private`, `vehicle_id = 2e5ec4a1`, `amount` = the price, `vendor_name` = the seller, and a description that cites **price, seller and date to frame index + timestamp**. The image row gets `vehicle_id = 2e5ec4a1` and `is_document = true`. | Exactly one document for this recording; every cited field has a frame (1 to 12) and a timestamp (0 to 60 s); `vehicle_id` equals the Corvette; nothing else on the Corvette changed (`purchase_price`, `purchase_date`, image counts, primary image). Re-running the pass makes no second document. | No document, a second document, a wrong vehicle, a cited field with no frame, any OCR text beyond the cited values in the database, or a change to the vehicle row. |
| 3 | A **private preview** uploads. | One object in the private `capture-media` bucket at `users/<uid>/previews/<row id>.mp4` (first 60 s, video only). No `full/` object exists. | The object exists, is readable only by the owner, `vehicle_images.storage_path` points at it, and the original recording is **not** in the bucket. | A public object, a `full/` object, audio, or an object for a refused capture. |
| 4 | **Sep 17, 2023**, 27 photos at Ann Rd (36.2618, -115.3024) should auto-land on `2e5ec4a1`, using the previous day's purchase as context. | With the attached acquisition document as context, photos of the next day near that place land on the Corvette without a person. | All 27 photos are filed to `2e5ec4a1` **by the photo filing path using the document as context** (not by hand, not by a script). | Any photo stays unfiled, or lands on another vehicle. |

Honest status of each step (details in "What the read-only check found" below):

* Steps 1 to 3 are built in this PR. Their **rules are unit-tested** with simulated Corvette OCR text
  (`ScreenCaptureEvidenceTests`). What can only be proven **on a real device**: that Vision reads a real Marketplace
  recording's text well enough (small fonts, scrolling, dark mode), that the recording is a `videoScreenRecording`,
  that PhotoKit hands over the local file, and that the 1080p preview export fits. The RPC has not run anywhere.
* Step 4 **is not delivered by this PR** and, in the live database, **has already happened by another route**: the
  Sep 17 photos are filed to `2e5ec4a1` (via `ssd_blast`, not the phone). Re-proving it from the phone would need a
  fresh, unfiled copy of those photos. What the context change needs is described in "Context for the photos".

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

### 2c. Screenshots and screen recordings: `screen_text_v1`

A screen capture is a record *about* a vehicle (a listing, a bill of sale, a text thread), not a photo *of* it. The
photo gate holds a document's pixels and never accepts an identifier from one, so screen captures take a separate
rule. `ScreenCaptureEvidence.swift` is the whole rule as pure code; `ScreenCaptureSync.swift` is the PhotoKit/Vision
plumbing. Four stages:

1. **Narrow by acquisition context** (metadata only; nothing is read yet). A vehicle is a candidate for a capture made
   inside its window: **21 days before to 2 days after its anchor** (3 days after when the anchor is a
   `purchase_date`, because that is a whole day). The anchor is, in order: **`vehicles.purchase_date`** (UTC
   midnight); else **the vehicle's first filed photo** (`taken_at` of the earliest real photo: not a clip this feature
   filed, not sensitive, superseded or duplicate). **`created_at` is never used**: for imported or merged profiles it is the
   import date (the Corvette's is 2026-01-13, three years after the purchase). A vehicle with neither is not a
   candidate. Only captures inside some window are listed: no bulk history. Windows are merged, at most 200 per pass.
2. **Read on the phone.** Vision OCR (`VNRecognizeTextRequest`, accurate, no language correction) over the screenshot,
   or over 12 frames evenly spaced across the first 60 s of the recording (the same span the preview carries, so every
   cited timestamp is findable in the uploaded preview). Recognised text lives in memory for one evaluation: never
   stored, logged or sent. Local files only (no iCloud download). Recordings over 15 min are not read.
3. **Decide.** Attribute only when the text gives **strong vehicle evidence that matches exactly one of the owner's
   vehicles AND a price or seller line**:
   * vehicle evidence: the vehicle's **own checksum-valid VIN** (confidence 0.97), or **year + make + model** (year
     and model on one line, the make anywhere in the same frame; `'64` and short makes like "Chevy" accepted;
     confidence 0.92). Both clear the 0.9 photo floor.
   * commercial evidence: a price line ($500 to $5,000,000) or a seller line ("Seller: Name", "Listed by", "Seller
     information" then a name, or a "Message seller" control).
   * **refused** (stays on the phone, no prompt, never read again): no vehicle evidence; two vehicles evidenced; a
     different valid VIN on screen; evidence for a vehicle outside its own window; no price or seller; a prominent
     face in any frame; private text in any frame (card number that passes Luhn, SSN pattern, "password",
     "verification code", "CVV", routing/account number).
4. **File.** A metadata-only `vehicle_images` row is inserted (no `vehicle_id`, no location), then the RPC
   **`device_file_media_document`** (migration `20261109100100`) is called with the method, confidence and the
   **cited fields only**: `{name, value, frame, seconds}` for `vehicle`, `vin`, `price` (+ up to two `price_seen`),
   `seller` (or `seller_line`), `date` (only a full date with a year). **Never the OCR dump.** The RPC revalidates
   ownership, association, the window (recomputed from the database), the text-to-vehicle agreement (a `vehicle`
   field must equal the vehicle's year make model; a `vin` field its VIN; a same-year/make/model second vehicle makes
   it ambiguous), the price bounds and the preview path, then in one transaction inserts a private
   **`acquisition_document`** (`amount` = price, `vendor_name` = seller, description = the cited fields with their
   frames) and sets the row's `vehicle_id` and `is_document = true`. On any failure **nothing is written**:
   `vehicle_id` stays null, there is no document, and the storage policy refuses the preview. (The row is a
   metadata-only residue, as for camera clips.)

Upload is **preview only**: a screenshot as a 1600 px JPEG (<= 2 MB), a recording as its first 60 s, video only,
1080p (falls back to 640x480). The **original never uploads**: the storage policy opens `full/` only for rows whose
`exif_data.media.kind` is `camera_video`. `vehicle_documents.file_url` is set by the RPC to
`capture-media/<preview path>`; `vehicle_images.storage_path` is patched by the app once the object lands.

The rule does **not** write `vehicles.purchase_price` or `purchase_date` (decision 14).

Why this reading of "prior-day purchase as context" stops at narrowing for the capture itself: the recording is
attributed by its own text. The window only decides which vehicles are worth reading it against.

### 2c-bis. What the read-only check found (2026-11-04, project `qkgaybvrernstplzjaam`)

* `2e5ec4a1-c5fc-456d-8cff-82c6e582fd58` exists: **1964 Chevrolet Corvette**, `vin` **null**, `purchase_date` **null**,
  `created_at` 2026-01-13 (a profile-split import), 27 `vehicle_images` (all the owner's), the first taken
  2023-09-17 05:27:58 UTC.
* Photos on **2023-09-17**: **26**, not 27 (the 27th is a 2025 photo from a dropbox sync). All 26 are **already filed**
  to `2e5ec4a1`, all via **`ssd_blast`**. None came from the phone's sync, so none went through the photo gate or
  `capture_sets_score`. Those near Ann Rd (36.2618, -115.3024) are among them.
* Why the *phone* path could not file them: the photo gate's methods are `vin_ocr` (needs the vehicle's 17-character
  VIN: the Corvette has **none**) and `serial_ocr` (needs a serial in `vehicles`: none). A 1964 Corvette photo with no
  readable VIN plate has no content evidence, so the gate does not file it. Only the server's context scorer could.
* Nothing exists for 2023-09-16 (no document, no image).
* Verified for the new RPC (read-only): `vehicle_documents` has `vehicle_id` (NOT NULL), `uploaded_by`,
  `document_type` (free text), `title`, `description`, `file_url`, `file_type`, `amount`, `vendor_name`, `currency`,
  `privacy_level` (default `private`), no metadata column (so the cited fields live in the description and in
  `vehicle_images.exif_data.media.screen_fields`). `vehicle_images` gallery eligibility
  (`vehicle_image_gallery_eligible`) already excludes `is_document = true` and empty `image_url`, and the primary-image
  function requires a non-empty `image_url`: a filed screen capture does not enter galleries, counts or the cover.
  The BEFORE UPDATE gate trigger (`enforce_vision_gate_filing`) fires only for `rejected_*` gate states, so setting
  `vehicle_id` on a fresh row is not blocked. Side effects that **do** still fire on `vehicle_id` set: `has_photos`,
  the activity bump (a `photo` activity at the capture's `taken_at`), completion/summary queues and
  `compute_vehicle_value`: all pre-existing for camera clips too.

### Context for the photos (acceptance step 4): what is needed

How the server decides today: `capture_sets_score` v3 scores `capture_relay_ios` photos with a non-empty `image_url`.
Its history prior uses **any filed `vehicle_images` row of the user**: weight `exp(-gap_days/2)` x (1.0 same GPS cell,
else 0.35), plus `work_sessions` (0.6). It **does not read `purchase_date` or documents**. An attached screen-capture
row is a filed row of the user, so it already counts, but with no GPS it is the "else 0.35" case and one day apart
gives `exp(-0.5) x 0.35 ~= 0.21`: too weak to land 27 photos by itself.

Two things are needed, both **server-side** and neither a small app change:

1. **An acquisition prior in `capture_sets_score`**: when a vehicle has an `acquisition_document` (or a `purchase_date`)
   within about 3 days before a capture set, add a dedicated prior for that vehicle (a stronger weight than the
   generic 0.35, window-limited, and still never the sole basis: the set's own visual/GPS evidence must not
   contradict). A purchase day is exactly when a new vehicle's first photos arrive, which is the Ann Rd case.
2. **The photo has to reach that scorer**: it does only if the phone's photo sync filed it as `capture_relay_ios`
   with an image. The app side needs no change for that.

Not implemented in this PR: it changes server scoring that moves photos between vehicles for every user, and it
cannot be tested without a database. Proposed as a follow-up migration with its own approval.

### 2d. Upload

Preview = first 60 s, video track only (no audio), 640x480 or smaller (screen recordings: 1080p first), MP4, 25 MB cap (screenshots: 1600 px JPEG, 2 MB). Full file = the original
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
| `exif_data` (camera clips and screen captures) | `synced_by`, `asset_key` (sha256 of user id + PhotoKit id), `media{kind, bucket, preview_path, full_state, device model/OS, width, height, match{rule:"media_gate_v1", method, confidence, frames_sampled, frames_exact, candidates, anchors, window_seconds, radius_m, anchor_source (screen captures)}}`; for screen captures `kind` is `screen_recording` or `screenshot`, `full_state` is `never_uploaded`, there is no location, and the server adds `document_id` and `screen_fields` |

Not sent: the PhotoKit id, audio, OCR text, frames, the identifier read, the original file name.

**Reader risk of sharing `vehicle_images`** (not changed here): once filed, `has_photos`, image counts and some
vehicle activity triggers count a clip like a photo; its `image_url` is empty, so galleries must skip
`source = 'capture_relay_ios_media'` or `is_video`. Recommend a follow-up that adds that filter before any screen shows
these rows, and a signed-URL reader using `exif_data.media.bucket` + `storage_path`. Unlike the earlier design,
attributed rows now carry a real `vehicle_id` with no human step, so this matters sooner.

## 3. What is built (this PR)

`Sources/NukeCapture/VideoSync/`: `VideoSyncConfig` (switch + numbers), `VideoCaptureMatcher` (narrowing only, camera
clips), `MediaAttributionGate` (camera-clip gate), **`ScreenCaptureEvidence`** (the screen-capture rule, pure),
**`ScreenCaptureSync`** (acquisition-window enumeration, Vision OCR, the document filing path, the preview export),
`TusUpload`, `VideoSyncLedger` (cleared -> rowInserted -> filed -> transfers; now also the screen payload and the anchor
cache), `VideoSyncEngine`; one line in `SyncEngine.sync()`. The switch is the UserDefaults key `videoSync.enabled`
(absent = OFF); no screen turns it on (another agent owns the iOS screens). Tests: `VideoCaptureMatcherTests`,
`MediaAttributionGateTests`, `VideoSyncTests`, **`ScreenCaptureEvidenceTests`** (the Corvette recording as simulated OCR,
anchor and window boundaries, evidence, refusals, privacy, citations, no OCR text in the payload or row, ledger).

Migrations (not applied): the bucket (now also `image/jpeg` for screenshot previews, `full/` only for camera clips) and
`device_file_media_document`.

Not built: a Settings toggle; the reader filters; the acquisition prior for photos (server, above); promoting the
document's price/date to the vehicle; any change to photo sync, existing rows, or the 276 held photos. The OCR/frame path
(AVAssetImageGenerator, Vision, PhotoKit, preview export) is compile-checked by CI only and has not run on a device; the
RPC has never executed.

## 4. Decisions needed from the owner

1. ~~Screen captures~~ **Resolved by the owner: supported**, as documents under `screen_text_v1`. Still open inside
   it: decisions 13 to 22 below.
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
13. **Context numbers for screen captures:** window 21 days before to 2 days after (3 for a `purchase_date`), 12
    frames from the first 60 s, 4 captures read per pass, recordings up to 15 min. Change?
14. **Promote the document to the vehicle?** The RPC does *not* set `vehicles.purchase_price` / `purchase_date`. The
    Corvette has neither; doing it from OCR needs your approval (and would make `purchase_date` the next anchor).
15. **Confidence 0.92 for year + make + model alone** (0.97 for a VIN). Both clear the 0.9 floor; a YMM-only match
    is weaker than a VIN and is protected by the price/seller requirement, the single-vehicle rule and the window.
16. **Anchor choice when `purchase_date` is missing:** the first filed photo (not `created_at`). The Corvette's
    anchor is therefore 2023-09-17 05:27:58 UTC; a capture 2 or more days after it, or 21+ days before, is out of
    window. If its photos were back-filled later than the purchase, the first photo is not the purchase.
17. **`document_type` name** `acquisition_document` (free text today; nothing reads it yet) and `file_url` holding
    `capture-media/<path>` (a private path, not a URL: readers need a signed-URL step).
18. **Seller name is PII** stored in `vendor_name` and the description, private to the owner. Accept, or store only
    "seller seen".
19. **Screenshots included** (a JPEG preview needs `image/jpeg` in the bucket and a 1600 px preview). A screenshot can
    show more than the OCR-checked lines (the preview is the whole screen): the face and private-text refusals are
    the only protection. Accept, or recordings only.
20. **Evidence window is the first 60 s only.** A recording whose vehicle appears later is refused and never re-read.
21. **Missing `vehicle_id` on failure:** a failed match leaves a metadata-only row and no document (it does not file an
    unattributed document). If you want an unattributed document kept in the owner's record instead, that is a
    different design (nullable `vehicle_id` does not exist on `vehicle_documents`).
22. **Photo context (acceptance step 4):** approve a follow-up that adds an acquisition-document / `purchase_date`
    prior to `capture_sets_score` (above). Until then, step 4 relies on whatever already filed the photos.

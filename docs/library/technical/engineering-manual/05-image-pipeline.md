# Chapter 5: Image Pipeline

## What This Subsystem Does

The image pipeline handles every photo that enters the system -- from auction listing images scraped from the web, to first-party photos taken by the vehicle owner via Apple Photos, to Facebook Marketplace listing images downloaded before CDN URLs expire. Images flow through upload to Supabase Storage, are linked to vehicles via `vehicle_images`, and then enter an AI analysis pipeline for classification (make detection, angle/zone classification, condition assessment, damage detection). The YONO classifier is a custom-trained local vision model that runs on Modal GPU infrastructure for zero-cost-per-image inference at scale.

---

## Key Tables and Functions

### Tables

| Table | Purpose |
|-------|---------|
| `vehicle_images` | Master record for every vehicle image. Links to vehicles and storage. |

### Edge Functions

| Function | Purpose |
|----------|---------|
| `image-intake` | Upload + create vehicle_images record + queue AI processing. |
| `photo-pipeline-orchestrator` | Process pending images through AI analysis. |
| `yono-classify` | YONO local model: make classification. |
| `yono-analyze` | YONO: condition + zone + damage analysis. |
| `yono-batch-process` | Bulk YONO classification. |
| `yono-vision-worker` | Cron worker for background vision processing. |
| `check-image-vehicle-match` | Claude Haiku vision: verify image matches assigned vehicle. |
| `auto-sort-photos` | Organize images into categories. |

### Scripts

| Script | Purpose |
|--------|---------|
| `scripts/iphoto-intake.mjs` | Import photos from Apple Photos library. |
| `scripts/photo-sync.mjs` | Sync photos from camera roll. |

### Storage

| Bucket | Purpose |
|--------|---------|
| `vehicle-photos` | Primary storage for all vehicle images. |
| `listing-snapshots` | Archived HTML (see Chapter 1), not images. |

---

## The vehicle_images Table

### Key Columns

```sql
CREATE TABLE vehicle_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID REFERENCES vehicles(id) NOT NULL,
  image_url TEXT,                    -- Public URL (Supabase Storage or external CDN)
  storage_path TEXT,                 -- Path within vehicle-photos bucket
  source TEXT,                       -- 'bat', 'iphoto', 'facebook-marketplace', etc.
  file_name TEXT,
  file_size INTEGER,
  mime_type TEXT,
  is_external BOOLEAN DEFAULT true,  -- true = CDN URL, false = our storage
  is_primary BOOLEAN DEFAULT false,  -- The hero image for this vehicle

  -- AI processing
  ai_processing_status TEXT DEFAULT 'pending',  -- pending/processing/completed/failed/skipped
  ai_caption TEXT,
  ai_tags TEXT[],
  ai_analysis JSONB,

  -- YONO classification
  angle TEXT,                        -- front, rear, side, interior, engine, wheel, etc.
  organization_status TEXT DEFAULT 'unorganized',  -- unorganized/organized/ignored

  -- Optimization
  optimization_status TEXT DEFAULT 'pending',  -- pending/processing/optimized/failed

  -- GPS / EXIF metadata (from iphoto intake)
  latitude NUMERIC,
  longitude NUMERIC,
  location_name TEXT,
  taken_at TIMESTAMPTZ,
  exif_data JSONB,

  -- Provenance
  documented_by_user_id UUID,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### Status Constraints

```sql
ALTER TABLE vehicle_images ADD CONSTRAINT chk_ai_processing_status
  CHECK (ai_processing_status IN ('pending', 'processing', 'completed', 'failed', 'skipped'));

ALTER TABLE vehicle_images ADD CONSTRAINT chk_optimization_status
  CHECK (optimization_status IN ('pending', 'processing', 'optimized', 'failed'));

ALTER TABLE vehicle_images ADD CONSTRAINT chk_organization_status
  CHECK (organization_status IN ('unorganized', 'organized', 'ignored'));
```

---

## Image Sources

### 1. Auction Listing Images (Scraped)

When an extractor processes a listing, it finds image URLs in the HTML and stores them in `vehicle_images` with `is_external = true`. These point to the auction site's CDN.

For BaT, images are extracted from the gallery data attribute:

```typescript
// From extract-bat-core/index.ts
function extractImages(html: string): string[] {
  const idx = h.indexOf('id="bat_listing_page_photo_gallery"');
  const win = h.slice(idx, idx + 5000000);
  const m = win.match(/data-gallery-items=(?:"([^"]+)"|'([^']+)')/i);
  // Parse JSON array, extract full-resolution URLs
  // Normalize: strip -scaled, -WxH size suffixes, query params
}
```

BaT image URLs are stable (they persist after auction ends), but other sources (Facebook Marketplace especially) have expiring CDN URLs. For those, images must be downloaded and stored locally.

### 2. Facebook Marketplace Images (Downloaded)

FB Marketplace CDN URLs expire. The scraper downloads images and stores them in Supabase Storage:

```typescript
// From scripts/fb-marketplace-local-scraper.mjs
async function downloadAndStoreImage(sourceUrl, vehicleId, index = 0) {
  const resp = await fetch(sourceUrl, {
    headers: { "User-Agent": "Mozilla/5.0 ..." },
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) return null;

  const buffer = Buffer.from(await resp.arrayBuffer());
  if (buffer.length < 5000) return null;  // Skip tiny images (icons/placeholders)

  const storagePath = `${vehicleId}/fb-marketplace/${Date.now()}-${index}.${ext}`;
  await supabase.storage.from("vehicle-photos")
    .upload(storagePath, buffer, { contentType, upsert: false });

  const { data: pubData } = supabase.storage
    .from("vehicle-photos")
    .getPublicUrl(storagePath);

  return pubData?.publicUrl;
}
```

### 3. iPhoto Intake (First-Party Photos)

The `iphoto-intake.mjs` script imports photos from the owner's Apple Photos library. This is the highest-value image source because first-party photos:
- Have GPS coordinates (where was the vehicle when photographed?)
- Have EXIF data (camera, lens, settings)
- Have temporal data (when was the photo taken?)
- Show the vehicle as-is (not staged for auction)

#### How It Works

1. **List albums**: Uses `osxphotos` CLI to enumerate albums that start with a year (e.g., "1984 Chevrolet K20 LWB")
2. **Parse album name**: Extracts year/make/model from the album title
3. **Match to vehicle**: Queries the database for a matching vehicle record
4. **Query metadata**: Uses `osxphotos query --album <name> --json` to get GPS, EXIF, taken_at for all photos
5. **Export**: Uses `osxphotos export` to extract photos from the Photos library
6. **Convert HEIC to JPEG**: Uses macOS `sips` for format conversion
7. **Upload**: Uploads to `vehicle-photos/{vehicle_id}/iphoto/{filename}`
8. **Insert records**: Creates `vehicle_images` rows with GPS, EXIF, taken_at metadata

#### Usage

```bash
# List all vehicle albums
dotenvx run -- node scripts/iphoto-intake.mjs --list

# Process a single album
dotenvx run -- node scripts/iphoto-intake.mjs --album "1977 K5 Chevrolet Blazer"

# Specify which vehicle to attach to
dotenvx run -- node scripts/iphoto-intake.mjs --album "1984 Chevrolet K20 LWB " --vehicle-id 6442df03-...

# Process all albums
dotenvx run -- node scripts/iphoto-intake.mjs --all

# Sync mode: download from iCloud, convert, upload, replace placeholders
dotenvx run -- node scripts/iphoto-intake.mjs --sync --album "1977 K5 Chevrolet Blazer"

# Map-only mode: record GPS metadata without uploading images
dotenvx run -- node scripts/iphoto-intake.mjs --map-only

# Backfill GPS for previously uploaded images
dotenvx run -- node scripts/iphoto-intake.mjs --backfill-gps
```

#### Key Implementation Details

**Album name parsing** handles various formats:

```javascript
// "1984 Chevrolet K20 LWB" -> year=1984, make=Chevrolet, model=K20 LWB
// "1977 K5 Chevrolet Blazer" -> year=1977, make=Chevrolet, model=K5 Blazer
// Known makes: Chevrolet, GMC, Ford, Dodge, Porsche, Ferrari, etc.
```

**Vehicle matching** uses a pre-loaded cache to avoid repeated database queries during long runs:

```javascript
async function loadVehicleCache() {
  // Load vehicles that already have iphoto records
  const iphotoVehicleIds = new Set();
  // ... fetch all vehicle_images with source='iphoto'
  // ... fetch vehicle details for those IDs
  // This is the user's actual vehicles -- much more accurate than searching 1.2M vehicles
}
```

**Mismatch guard** prevents accidentally uploading photos to the wrong vehicle:

```javascript
async function validateVehicleAlbumMatch(vehicleId, albumName) {
  // Parse album -> year/make/model
  // Fetch vehicle from DB
  // Compare year (must match)
  // Compare model first word (must match)
  // Abort with error if mismatch (unless --force)
}
```

**Duplicate prevention**: Checks existing `file_name` for the vehicle before uploading:

```javascript
const { data: existing } = await supabase
  .from('vehicle_images')
  .select('file_name')
  .eq('vehicle_id', vehicleId)
  .eq('source', 'iphoto');
const existingNames = new Set(existing.map(r => r.file_name));
const toUpload = files.filter(f => !existingNames.has(f));
```

**DNS workaround**: macOS system resolver can fail during long runs. The script uses Google DNS (8.8.8.8) directly:

```javascript
const resolver = new dns.Resolver();
resolver.setServers(['8.8.8.8', '1.1.1.1']);
```

---

## AI Analysis Pipeline

### Processing Flow

```
Upload/Insert
  |
  v
vehicle_images.ai_processing_status = 'pending'
  |
  v
[photo-pipeline-orchestrator claims batch]
  |
  v
ai_processing_status = 'processing'
  |
  +---> YONO classify (make + zone)
  +---> Claude Haiku vision (caption + tags)
  +---> Condition assessment
  |
  v
ai_processing_status = 'completed'
ai_caption, ai_tags, ai_analysis, angle populated
```

### The YONO Classifier

YONO (You Only Nuke Once) is a custom-trained vision model that runs on Modal GPU infrastructure. It provides:

- **Make classification**: Hierarchical. Tier 1 = family (American, European, Japanese). Tier 2 = specific make (Chevrolet, Porsche, Toyota). Trained on 58 makes.
- **Zone classification**: Which part of the vehicle is shown (front 3/4, rear, interior, engine bay, wheel detail, etc.). 72.8% accuracy on 2,764 training images. 224K surface observations available for retraining.
- **Condition scoring**: Overall condition assessment from visual inspection.
- **Damage detection**: Flags visible damage (rust, dents, paint defects).

#### Architecture

```
Image URL
  |
  v
[Edge Function: yono-classify or api-v1-vision/analyze]
  |
  v
[HTTP to Modal sidecar: YONO_SIDECAR_URL]
  |
  v
[Modal GPU: Florence-2 + custom classifiers]
  |
  v
{ make, condition_score, vehicle_zone, damage_flags }
```

#### Why YONO Is Not Yet Fully Integrated

YONO was developed as a sidecar service on Modal. The cost model is per-GPU-second, which creates a tension:
- **Cold start**: ~30 seconds for a new GPU container. Wasteful for single images.
- **Warm cost**: $500/month was burned on keepalive pings before the triage cut it.
- **Current approach**: Cold-start on demand only. Batch processing (yono-batch-process) is efficient; real-time single-image classification is too slow.

The long-term plan is to either:
1. Run YONO on a dedicated always-on GPU (if volume justifies the cost)
2. Switch to a serverless vision API (Claude Haiku vision) for real-time classification
3. Pre-compute all classifications in nightly batches

---

## Photo Coverage Map

The auction readiness system defines 20 photo zones that matter for selling a vehicle:

### MVPS (Minimum Viable Photo Set) -- 8 Required Zones

| Zone | Description |
|------|-------------|
| Front 3/4 | The hero shot. Shows front and one side. |
| Rear 3/4 | Shows rear and one side. |
| Driver Side Profile | Full side view. |
| Passenger Side Profile | Full side view. |
| Interior Dashboard | Shows dash, steering wheel, gauges. |
| Interior Rear | Shows back seat or cargo area. |
| Engine Bay | Shows engine compartment. |
| Odometer/Gauges | Shows mileage and instrument cluster. |

### CPS (Competitive Photo Set) -- 12 Additional Zones

| Zone | Description |
|------|-------------|
| Undercarriage | Frame, exhaust, suspension. |
| Trunk/Cargo | Storage area. |
| Wheel Detail | Close-up of wheel and tire. |
| VIN Plate | VIN tag or door jamb sticker. |
| Paint Detail | Close-up showing paint quality. |
| Weatherstrip | Door and window seals. |
| Headlights | Front lighting detail. |
| Taillights | Rear lighting detail. |
| Badges/Emblems | Identifying marks. |
| Documentation | Title, build sheet, service records. |
| Keys | All keys and fobs. |
| Imperfections | Honest documentation of flaws. |

The YONO zone classifier assigns incoming photos to these zones. The auction readiness score (see encyclopedia) uses zone coverage to compute the photo completeness dimension.

---

## How to Build the Image Pipeline from Scratch

### Step 1: Create the Storage Bucket

In Supabase Dashboard or via CLI:

```bash
# Create the vehicle-photos bucket (public read)
supabase storage create vehicle-photos --public
```

### Step 2: Create vehicle_images Table

Use the schema shown above.

### Step 3: Implement Image Intake

The simplest intake is direct insert after upload:

```typescript
// Upload to storage
const storagePath = `${vehicleId}/source/${filename}`;
const { error } = await supabase.storage
  .from('vehicle-photos')
  .upload(storagePath, fileData, { contentType: 'image/jpeg', upsert: true });

// Get public URL
const { data: { publicUrl } } = supabase.storage
  .from('vehicle-photos')
  .getPublicUrl(storagePath);

// Insert record
await supabase.from('vehicle_images').insert({
  vehicle_id: vehicleId,
  image_url: publicUrl,
  storage_path: storagePath,
  source: 'iphoto',
  file_name: filename,
  file_size: fileSize,
  mime_type: 'image/jpeg',
  is_external: false,
  ai_processing_status: 'pending',
});
```

### Step 4: Set Up AI Processing

Create a cron-driven pipeline that claims pending images and processes them:

```typescript
// Claim a batch of pending images
const { data: images } = await supabase
  .from('vehicle_images')
  .select('id, image_url, vehicle_id')
  .eq('ai_processing_status', 'pending')
  .limit(20);

// Process each image
for (const img of images) {
  await supabase.from('vehicle_images')
    .update({ ai_processing_status: 'processing' })
    .eq('id', img.id);

  // Call vision API (YONO or Claude Haiku)
  const analysis = await analyzeImage(img.image_url);

  await supabase.from('vehicle_images')
    .update({
      ai_processing_status: 'completed',
      ai_caption: analysis.caption,
      ai_tags: analysis.tags,
      angle: analysis.zone,
      ai_analysis: analysis,
    })
    .eq('id', img.id);
}
```

### Step 5: Build iPhoto Intake (If macOS)

Install `osxphotos`:

```bash
pip install osxphotos
```

The full script is at `scripts/iphoto-intake.mjs`. The key operations are:
1. `osxphotos albums` -- list albums
2. `osxphotos query --album <name> --json` -- get metadata
3. `osxphotos export <dir> --album <name>` -- export photos
4. `sips -s format jpeg <file> --out <output>` -- convert HEIC to JPEG

---

## Known Problems

1. **External CDN URLs expire.** BaT image URLs are persistent, but Facebook, Craigslist, and some auction house CDN URLs expire. Images should be downloaded and stored locally during extraction, but many extractors only store the URL.

2. **No image deduplication.** The same photo can be uploaded multiple times (e.g., from both iPhoto and auction scraping). There is no perceptual hash deduplication to detect near-identical images.

3. **YONO cold start latency.** Single-image classification takes 30+ seconds due to Modal container cold start. This makes real-time classification impractical.

4. **EXIF stripping.** Some auction sites strip EXIF data from uploaded images. Photos from iPhoto retain full EXIF, but scraped photos typically do not.

5. **No image optimization pipeline.** Images are stored at original resolution. A resize/compress pipeline for thumbnails and web-optimized versions would reduce storage costs and improve load times.

6. **Zone classification accuracy.** YONO zone classifier is at 72.8% accuracy. Misclassifying an engine bay photo as "interior" degrades the photo coverage map. More training data (224K surface observations are available) would improve accuracy.

### Import a Bring a Trailer listing into a vehicle profile

This repo has a Supabase Edge Function (`import-bat-listing`) that will:

- Create or update the correct `vehicles` profile (prefers URL match, then VIN match; fuzzy match is optional/off by default)
- Extract auction data + write into `vehicles` fields and `timeline_events`
- Scrape **all** listing photos and upload them into Supabase Storage (`vehicle-images`) and `vehicle_images` (deduped)

## Requirements

- **`SUPABASE_URL`** (or `VITE_SUPABASE_URL`)
- **`SUPABASE_SERVICE_ROLE_KEY`** (or `VITE_SUPABASE_SERVICE_ROLE_KEY`)

You can put these in `.env` at the repo root.

## One-command import

Run:

```bash
chmod +x scripts/import-bat-listing.sh
./scripts/import-bat-listing.sh "https://bringatrailer.com/listing/1977-gmc-jimmy-13/"
```

## Optional flags

- **`ORGANIZATION_ID`**: link the imported vehicle to an organization (optional)
- **`ALLOW_FUZZY_MATCH=true`**: allows year/make/model fuzzy match when VIN is missing (off by default)
- **`IMAGE_BATCH_SIZE=50`**: batch size for image backfill (10..100)



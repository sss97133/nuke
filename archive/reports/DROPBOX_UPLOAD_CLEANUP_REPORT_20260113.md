## Dropbox Upload Cleanup Report (2026-01-13)

This report summarizes the production cleanup work performed to remove cross-contamination originating from the historical Dropbox import pipeline.

### What was considered “contamination”

- **Hard contamination (must be zero)**: a `vehicle_images.image_url` that embeds a different vehicle UUID than `vehicle_images.vehicle_id` (e.g. `.../vehicle-data/vehicles/{other_uuid}/...`).
- **Soft anomaly (informational)**: “pre-created rows” where `child.created_at < vehicles.created_at`. This can be legitimate if `created_at` was backfilled from source timestamps (not necessarily DB insertion time), so it’s not treated as corruption by default.

### Results (hard contamination)

- **Foreign embedded vehicle IDs in image URLs**: **0** (db-wide, excluding `rehydrated_split` profiles)
- **Foreign Dropbox images remaining**: **0**

### Cleanup actions taken

#### 1) Rehydrated splits for wrong merges (BaT + other)

Used `public.rehydrate_profile_merge(...)` to create a new `rehydrated_split` vehicle and move only the clearly-foreign rows out of the primary profile.

New vehicles created by `rehydrate_profile_merge`:

- **Impala**: new `8bfcd0f0-e591-440f-89ec-16da1e1b6a29` (from `17b83b0b-89f6-401c-9b5a-646f3736dbc1`) — images=1, events=2, org_links=1, prices=1
- **Mustang**: new `a5846c70-7bc5-4a20-8720-8e15cb509469` (from `7411907e-0ba2-4a03-88f4-6ff55a493f09`) — images=2, events=2, org_links=1, prices=1
- **Harley Softail**: new `533e5bc8-6802-44f1-981e-1472d1b45d25` (from `7a8aec5e-f233-4bdc-9811-a9bafe68ee13`) — images=2, events=2, org_links=1, prices=1
- **Corvette**: new `2e5ec4a1-c5fc-456d-8cff-82c6e582fd58` (from `03ad5550-24b5-4dbf-addf-fb34fe25d67d`) — images=1, events=30, org_links=1, prices=2
- **Mazdaspeed Miata**: new `7719e908-9141-414d-8e05-986d4565cefb` (from `899765eb-ed7c-47d5-890f-911ac22da542`) — images=1, events=2, org_links=1, prices=1
- **Thunderbird**: new `64fb003d-9c2a-4cbb-a035-8958adeb1126` (from `d964717a-fd7c-426c-997e-832d11653ada`) — images=1, events=2, org_links=1, prices=1
- **C30 (KSL)**: new `c2f5dc7d-f0d3-48c6-902b-a60a737641be` (from `ae300e5b-d31a-4cfe-979a-22eb3422c7cb`) — images=1, events=0, org_links=1, prices=1
- **C10 (manual)**: new `e5edf5cf-78a7-4172-a54f-9cb5ea7b13c9` (from `ef844607-46fc-40a5-a27b-ad245ffe5ef5`) — images=1, events=0, org_links=0, prices=0

Each of the primary vehicles above was re-checked after execution: **no hard contamination signals remained**.

#### 2) Rehomed remaining “foreign Dropbox image” rows

For the final few cases where a Dropbox image URL embedded a different vehicle UUID than its `vehicle_id`, we:

- **Moved the image back to the embedded vehicle ID** when that vehicle still existed, or
- **Created a minimal `rehydrated_split` vehicle** (`discovery_source='dropbox_cleanup'`) to hold the orphaned image.

New vehicles created by `dropbox_cleanup` (each has 1 image):

- `fd6e211d-8e30-4382-9e94-4aaf8dcc7ad8` (from `05f27cc4-914e-425a-8ed8-cfea35c1928d`, embedded `89afcc13-febb-4a79-a4ad-533471c2062f`)
- `1ab85a1a-dc03-477f-b312-8b86df832c98` (from `21ee373f-765e-4e24-a69d-e59e2af4f467`, embedded `9d7d6671-65e0-4a22-a2fd-70c21fe613b0`)
- `6032eb48-0caa-41aa-bebc-fe0458386de5` (from `a90c008a-3379-41d8-9eb2-b4eda365d74c`, embedded `c36bd77b-402b-400d-a904-6a5c30252b1a`)
- `90b58e8e-1fb5-4e4a-9f39-f33182e60a0c` (from `b5a0c58a-6915-499b-ba5d-63c42fb6a91f`, embedded `92cee14e-d256-4bce-a2b7-46807a60e7e4`)

### Prevention (so it doesn’t happen again)

- **Auto-merge is now VIN-only** (threshold raised to 100 and a function-level “VIN-only gate” enforced).
- **Duplicate detection now has a provenance gate** for BaT-vs-Dropbox profiles (caps confidence for non-VIN matches).

### Follow-ups

- **Unresolved risky merges (confidence < 100, not yet rehydrated)**: **2** (both on `db1d19e4-3a88-463b-bb0d-753a747d7d0c`, a Vincent profile). Current permissions do not allow running `rehydrate_profile_merge` as the acting user for these vehicles.
- **Soft anomalies**: several vehicles have “pre-created rows” signals (likely due to imported timestamps). These were not modified as part of the Dropbox cleanup.


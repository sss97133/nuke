# 2026-05-24 — Substrate: (x,y,z) Spatial Anchors for vehicle_observations

**Status:** design proposal, awaiting approval. **NO DDL APPLIED.**
**Author:** Substrate design pass (agent under Skylar)
**Lane:** `vehicle_observations` only + one new table `vehicle_coordinate_frames`. Does NOT touch `vehicles` or `vehicle_images` (agent 72093 owns those).
**Companion:** `2026-05-24_substrate_pgvector-embedding-design.md`
**Source axiom:** Skylar 2026-05-24 — *"the only ground truth would be an x,y,z volumetric observation and a 0-100 scale condition rating per volumetric measurement."*
**Realizes:** `docs/library/intellectual/papers/novel-ontological-contributions.md` §I (Spatial Condition Ontology — currently aspirational).

---

## 1. Motivation — the volumetric ground-truth axiom

Standard condition grading collapses an entire vehicle to one number ("#2 condition"). Skylar's framing inverts this: **condition is a scalar field over a 3D body envelope, sampled at specific coordinates.** A vehicle isn't "in #2 condition" — it has a 92/100 driver's door, a 71/100 quarter panel, a 14/100 underbody pan, etc. Each rating is anchored to a specific `(x, y, z)` point or volume on the vehicle's mesh.

This is exactly the spec in `novel-ontological-contributions.md` §I.B (three coordinate spaces: image, zone, physical) and §I.C (fractal-zoom resolution levels). The DB carries a partial implementation:

- `vehicle_surface_templates` (102 rows): per-archetype (year_range, make, model, body_style) AABB envelopes with zone bounds in inches.
- `surface_observations` (378K rows): per-image observations with `u_min/u_max/v_min/v_max/h_min/h_max` AABBs in inches, tagged to a zone string.
- `vehicle_surface_coverage` (view): aggregate per vehicle × zone.

**What's missing** (per Skylar 2026-05-24):
- No per-vehicle mesh / coordinate frame. The current system anchors to *archetype* envelopes (every 1971–1989 350SL shares a single 180"×71"×51" box). It cannot point at "the dent at (x=42.1", y=18.2", z=31.7") on Skylar's specific K5."
- No path from an arbitrary (x, y, z) observation to a 3D viewer. The K5 has a Blender file, but it lives outside the DB.
- No first-class condition_rating column on `vehicle_observations`. Condition observations stuff a rating into `structured_data` JSONB at random key names depending on which extractor wrote them.
- No notion of a per-vehicle (vs per-archetype) coordinate frame. Restomodded / stretched / chopped trucks don't fit their archetype envelope.

This design adds the volumetric layer **above** the existing zone-based surface system. Zones stay as a coarse-grained classifier; (x, y, z) is the fine-grained ground truth.

---

## 2. Substrate state at design time

Confirmed via direct DB query 2026-05-24:

- `vector` 0.8.0 installed.
- **`postgis` 3.3.7 installed** — gives us `geometry(PointZ, ...)` types if we want them. (Recommendation: see §6, don't use PostGIS for this.)
- Existing related tables: `vehicle_surface_templates` (102), `surface_observations` (378K), `image_coordinate_observations` (79K), `image_coordinate_consensus`, `image_spatial_metadata`, `vehicle_surface_coverage`. **None of these carry per-vehicle mesh references or freeform (x,y,z) points.**
- `vehicle_observations` has 48 columns; none are spatial.

---

## 3. Schema proposal — three options compared

### Option A: typed columns on `vehicle_observations`

```
-- DESIGN ONLY
ALTER TABLE vehicle_observations
  ADD COLUMN anchor_frame_id          uuid REFERENCES vehicle_coordinate_frames(id),
  ADD COLUMN anchor_x_mm              real,
  ADD COLUMN anchor_y_mm              real,
  ADD COLUMN anchor_z_mm              real,
  ADD COLUMN anchor_extent_mm         real,           -- radius/half-extent of the sample volume
  ADD COLUMN condition_rating_0_100   smallint
    CHECK (condition_rating_0_100 BETWEEN 0 AND 100);
```

**Pros:** indexable directly (`CREATE INDEX ON vehicle_observations (vehicle_id, anchor_x_mm, anchor_y_mm, anchor_z_mm)`), nullable for non-spatial observations (works alongside existing kinds without forcing a schema bifurcation), low ceremony, no JOIN needed for the time-lapse-at-coordinate query.

**Cons:** adds 6 nullable columns to an already-wide (48-column) table. Most rows will have them NULL. Wastes a small amount of storage per non-spatial row (~24 bytes for the floats + 1 byte for the int + null bitmap overhead — ~30 bytes/row × 7.5M = ~225 MB).

### Option B: separate `observation_spatial_anchors` table

```
-- DESIGN ONLY
CREATE TABLE observation_spatial_anchors (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  observation_id          uuid NOT NULL REFERENCES vehicle_observations(id) UNIQUE,
  anchor_frame_id         uuid NOT NULL REFERENCES vehicle_coordinate_frames(id),
  anchor_x_mm             real NOT NULL,
  anchor_y_mm             real NOT NULL,
  anchor_z_mm             real NOT NULL,
  anchor_extent_mm        real,
  condition_rating_0_100  smallint NOT NULL CHECK (condition_rating_0_100 BETWEEN 0 AND 100),
  created_at              timestamptz NOT NULL DEFAULT now()
);
```

**Pros:** clean separation; spatial observations occupy a dedicated table; no NULL bloat; can carry additional spatial-only columns later without further widening `vehicle_observations`.

**Cons:** every time-lapse-at-coordinate query becomes a JOIN. Slower. More machinery. Two places to write per spatial observation (the testimony goes to `vehicle_observations`, the anchor to this table) — ingestion has to be transactional.

### Option C: stuff it all into `structured_data` JSONB

**Pros:** zero schema change.

**Cons:** unindexable for range queries (`WHERE anchor_x BETWEEN 30 AND 50` is a sequential scan over 7.5M JSONB blobs). Every consumer hand-rolls the key names. Drifts immediately. **Rejected.**

### Recommendation: Option A (typed columns)

Reasons:

1. **The query pattern is "give me all observations at coordinate (X, Y, Z) ± ε over time for vehicle V."** That's a multi-column range scan on `(vehicle_id, anchor_x_mm, anchor_y_mm, anchor_z_mm)`. Option A makes this a single index lookup. Option B requires a JOIN, which on 7.5M rows + an eventual hundreds-of-thousands of spatial anchors will start to hurt for interactive use.
2. **The volumetric axiom is foundational, not optional.** Skylar's framing positions (x,y,z) as ground truth for the system, not as an exotic add-on. Foundational data belongs on the core testimony row, not in a side table.
3. **Storage cost is trivial.** 225 MB across 7.5M rows is rounding error against the existing 171 GB DB size.
4. **Supersession works correctly under Option A.** A condition re-measurement at the same coordinate creates a new row, sets `is_superseded=true` on the previous one, points `superseded_by` at the new row. Existing supersession machinery already handles this. Under Option B we'd need to either (a) replicate supersession into the side table or (b) chase observation supersession chains through a JOIN — more failure modes.
5. **Non-spatial observations are unharmed.** All six new columns are nullable. A media-kind observation that doesn't carry a spatial anchor sets them all NULL — same as today.

**Justification for the new column count (per Hard Rule #2):** Six columns add the load-bearing axiom of the platform — the volumetric ground truth that the spatial condition ontology paper has been describing for two months without backing data. This is the minimal expression of that axiom.

---

## 4. The coordinate-frame registry — `vehicle_coordinate_frames`

A `(x, y, z)` value is meaningless without a frame. Skylar's K5 Blender file has *its own origin, its own units, its own axis convention*. We need a registry.

```
-- DESIGN ONLY
CREATE TABLE vehicle_coordinate_frames (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Scope: either tied to a specific vehicle (preferred for K5-like cases)
  --        or to an archetype (year_start, year_end, make, model, body_style)
  vehicle_id            uuid REFERENCES vehicles(id),           -- nullable; READ-ONLY FK
  archetype_make        text,
  archetype_model       text,
  archetype_year_start  smallint,
  archetype_year_end    smallint,
  archetype_body_style  text,

  -- Mesh asset
  mesh_url              text NOT NULL,             -- S3/Supabase storage URL
  mesh_format           text NOT NULL,             -- 'blend', 'gltf', 'obj', 'fbx'
  mesh_version          text,                      -- semver or commit hash
  mesh_origin_doc       text,                      -- prose: "origin at center of front axle, floor plane"
  units                 text NOT NULL DEFAULT 'mm', -- 'mm', 'in', 'm'
  axis_convention       text NOT NULL DEFAULT 'X_forward_Y_left_Z_up',
                                                    -- right-handed; Blender default is Z-up
  bbox_min_mm           real[3],                   -- [-2400, -1100, -50] kind of thing
  bbox_max_mm           real[3],
  is_default_for_vehicle boolean DEFAULT false,    -- if vehicle has multiple frames

  -- Trust/provenance
  source                text,                      -- 'skylar_blender', 'oem_cad', 'photogrammetry'
  trust_score           numeric CHECK (trust_score BETWEEN 0 AND 1),
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            text,

  CHECK (vehicle_id IS NOT NULL OR archetype_make IS NOT NULL)  -- must be scoped somehow
);

CREATE INDEX vcf_vehicle ON vehicle_coordinate_frames(vehicle_id) WHERE vehicle_id IS NOT NULL;
CREATE INDEX vcf_archetype ON vehicle_coordinate_frames(archetype_make, archetype_model)
  WHERE archetype_make IS NOT NULL;
```

**Notes:**

- The FK to `vehicles.id` is **read-only from this table's perspective** — we never modify the `vehicles` row, only point to it. Agent 72093 retains exclusive write authority on `vehicles`. This is permitted under their lane.
- `mesh_url` points at a Blender file (or glTF, OBJ, FBX) stored in Supabase Storage or S3. The DB doesn't store mesh geometry — just the pointer + metadata.
- `mesh_origin_doc` is prose that lets a future human (or agent) verify the origin convention. Without this, a `(x=0, y=0, z=0)` value is unverifiable.
- `axis_convention` defaults to Blender's right-handed X-forward / Y-left / Z-up. Restomod / OEM CAD files may use different conventions; this field surfaces the difference.
- `archetype_*` fields let a single coordinate frame cover all K5s of a year range if a per-vehicle mesh isn't available. Best-effort fallback when per-vehicle data is missing.
- `is_default_for_vehicle` handles the case where a vehicle has multiple frames (e.g. a rough scan plus a high-fidelity follow-up).

**Justification for the new table (per Hard Rule #2):** This is the substrate registry for the volumetric ground-truth axiom. There is no existing table that maps a vehicle (or archetype) to a 3D mesh URL with units, axis convention, and origin documentation. It cannot live as a column on `vehicles` because Skylar's `vehicles` table is read-locked by agent 72093 and the data has its own provenance lifecycle (mesh updates, multiple frames, archetype vs per-vehicle scoping).

---

## 5. The K5 bootstrap path

The shortest round-trip to make this real:

### Step 1 — Stage the Blender file

Skylar's K5 Blender file goes into Supabase Storage at a stable URL. (If it's currently on his local filesystem, a one-shot upload is the move.) **Even rough is fine.** A box car with proxy geometry is better than no frame.

### Step 2 — Register the frame

```
-- DESIGN ONLY (after user approval)
INSERT INTO vehicle_coordinate_frames (
  vehicle_id, mesh_url, mesh_format, units, axis_convention,
  mesh_origin_doc, source, trust_score, is_default_for_vehicle
) VALUES (
  '<skylar K5 vehicle_id>',
  'https://<supabase-storage>/k5/k5_master_v1.blend',
  'blend',
  'mm',
  'X_forward_Y_left_Z_up',
  'Origin at intersection of front axle centerline and floor plane. +X toward front bumper.',
  'skylar_blender',
  0.85,
  true
);
```

This is the first row. The substrate now knows the K5 has a mesh.

### Step 3 — The pin-drop demo

A tiny frontend / Blender-MCP / CLI flow:

1. **Open the mesh** (Blender MCP can do this — `mcp__blender__execute_blender_code`).
2. **Pick a point on the surface.** Hovering / clicking in Blender returns a world-space `(x, y, z)` in the mesh's frame.
3. **Type a search query** ("oxidation near the driver-side rear quarter") → existing `vehicle_observations` are filtered by `vehicle_id = K5 AND` (some text match or embedding similarity if §1's design lands first) → user picks one.
4. **Write the anchor** to the selected observation:

```
-- DESIGN ONLY (per-pin write, post-approval)
UPDATE vehicle_observations
SET anchor_frame_id = '<K5 frame id>',
    anchor_x_mm = -1850, anchor_y_mm = -480, anchor_z_mm = 920,
    anchor_extent_mm = 25,
    condition_rating_0_100 = 38
WHERE id = '<observation_id>';
```

**Trust-invariant check:** is this an UPDATE on a testimony row that violates `agent-trust-invariants.md` rule 2? Reading carefully: rule 2 says "NEVER `UPDATE` to overwrite a value on a testimony row." Adding a spatial anchor to a previously-unanchored observation is *not an overwrite* — the columns were NULL before. The original testimony (content_text, structured_data, observed_at, source) is unchanged.

**However**, *changing* an existing anchor (re-pinning) IS a supersession. Treat re-pin as: create a new observation row with kind `'condition'` (or original kind) pointing to the new (x,y,z) + rating, mark the old as superseded. This is consistent with the existing pattern.

### Step 4 — Demonstrate the round-trip

```sql
-- All anchored observations for the K5, ordered for visualization
SELECT id, kind, observed_at,
       anchor_x_mm, anchor_y_mm, anchor_z_mm, condition_rating_0_100,
       content_text
FROM vehicle_observations
WHERE vehicle_id = '<K5>' AND anchor_frame_id IS NOT NULL
ORDER BY observed_at DESC;
```

Pump those rows into a Blender script (or three.js viewer in the frontend) → render colored spheres at each (x,y,z), color by condition_rating_0_100. **That's the heat map.** That's the K5 with its damage mapped.

### Why "even rough is fine"

The whole point of this substrate is iteration. A bad mesh produces a misregistered heat map. The user (Skylar) sees the misregistration, fixes the mesh, the heat map updates because mesh_version is tracked. Compare with the alternative — *waiting for the perfect mesh* — which is how this aspiration has stayed aspirational for two months.

---

## 6. PostGIS — should we use `geometry(PointZ, ...)`?

PostGIS is installed. We *could* store anchors as `geometry(PointZ, <srid>)` and use GiST indexes for spatial queries.

**Recommendation: do not, at least not in Phase 1.** Reasons:

1. PostGIS is built for geodetic / cartographic data. Its SRIDs encode Earth-relative coordinate systems. There is no standard SRID for "the local frame of a 1976 K5 Blazer." We'd need to register a custom SRID for every coordinate frame.
2. The query patterns we need (axis-aligned range, k-NN to a point, distance from a point) are well-served by plain B-tree indexes on three real columns plus `cube` extension if we want true k-NN. The performance gain from PostGIS GiST is marginal at our scale (probably hundreds of thousands of anchors, not millions).
3. PostGIS adds machinery (SRID coercion errors, geometry vs geography confusion, function namespace pollution) that doesn't pay back at our coordinate-frame count.

**The upgrade path is open.** If Phase 2 needs PostGIS-style operations (spatial joins between different frames after registration, nearest-neighbor on millions of anchors), the migration is `ALTER TABLE ... ADD COLUMN anchor_geom geometry(PointZ, <srid>) GENERATED ALWAYS AS (ST_MakePoint(anchor_x_mm, anchor_y_mm, anchor_z_mm))`. Cheap.

---

## 7. Query patterns enabled

### 7.1 Time-lapse at a coordinate

```sql
-- How did condition at this point evolve over time?
SELECT observed_at, condition_rating_0_100, kind, content_text
FROM vehicle_observations
WHERE vehicle_id = $1
  AND anchor_x_mm BETWEEN $2 - 50 AND $2 + 50
  AND anchor_y_mm BETWEEN $3 - 50 AND $3 + 50
  AND anchor_z_mm BETWEEN $4 - 50 AND $4 + 50
  AND is_superseded IS NOT TRUE
ORDER BY observed_at;
```

This is the **canonical query** Skylar described. It's a multi-column index scan, fast.

### 7.2 Volumetric coverage map

```sql
-- For a vehicle, return all anchored observations binned into a 50mm grid
SELECT
  (anchor_x_mm / 50)::int * 50 AS gx,
  (anchor_y_mm / 50)::int * 50 AS gy,
  (anchor_z_mm / 50)::int * 50 AS gz,
  count(*) AS obs_count,
  avg(condition_rating_0_100)::int AS avg_condition
FROM vehicle_observations
WHERE vehicle_id = $1
  AND anchor_frame_id IS NOT NULL
  AND is_superseded IS NOT TRUE
GROUP BY gx, gy, gz;
```

This drives the heat-map render.

### 7.3 Differential / before-and-after

```sql
-- For each spatial bin, change in condition between two date ranges
WITH binned AS (
  SELECT
    (anchor_x_mm / 50)::int AS gx, (anchor_y_mm / 50)::int AS gy, (anchor_z_mm / 50)::int AS gz,
    CASE WHEN observed_at < $2 THEN 'before' ELSE 'after' END AS era,
    avg(condition_rating_0_100) AS rating
  FROM vehicle_observations
  WHERE vehicle_id = $1 AND anchor_frame_id IS NOT NULL
  GROUP BY gx, gy, gz, era
)
SELECT gx, gy, gz,
       max(CASE WHEN era='after' THEN rating END) -
       max(CASE WHEN era='before' THEN rating END) AS delta
FROM binned GROUP BY gx, gy, gz HAVING count(*) = 2;
```

Where did the truck get worse / better between dates? Bin-level differential.

### 7.4 Cross-vehicle archetype comparison

For owners with the same archetype frame, "show me which trucks in the corpus have rust at (x=-2100, y=-450, z=120) ± 100mm." Maps directly to a multi-vehicle range scan once archetype frames are registered. The archetype path is the long tail; the per-vehicle path is the priority.

---

## 8. Integration with `ingest-observation`

New optional fields in the request body:

```typescript
// addition to ObservationInput
anchor?: {
  frame_id?: string;           // explicit
  vehicle_id_for_default?: string;  // resolve to that vehicle's default frame
  x_mm: number;
  y_mm: number;
  z_mm: number;
  extent_mm?: number;
  condition_rating_0_100?: number;
};
```

Logic added between vehicle resolution and insert:

1. If `anchor` is present, resolve `frame_id` (either explicit or via `vehicle_id_for_default` → SELECT default frame for that vehicle).
2. If frame_id resolves AND vehicle_id matches the frame's vehicle scope (or archetype scope matches the vehicle), accept.
3. Otherwise: reject with 400, "anchor frame mismatch."
4. Write anchor columns alongside the rest of the row in the same INSERT.

No change to the supersession or dedup paths.

---

## 9. Integration with existing surface system

We have two layers:

| Layer | Granularity | Scope | Driven by |
|---|---|---|---|
| `surface_observations` (existing) | Zone-level AABB in archetype frame | Archetype (year range × make × model × body) | Existing vision pipeline |
| Anchor columns (proposed) | Point + extent in vehicle-specific or archetype frame | Per-vehicle (preferred) or archetype | Manual pin-drop, future precise CV |

These are **complementary, not competing.** The zone layer gives us coarse-grained heat at scale (378K observations across 4.7K vehicles). The point layer gives us precise heat for vehicles that warrant it (Skylar's K5, key high-value vehicles he or trusted reviewers pin).

When both exist on the same observation, the point layer wins for display. Zone falls back when point is absent. A future enhancement could auto-promote zone observations to point observations by snapping the zone centroid to the mesh surface — but that's downstream.

---

## 10. Open questions Skylar must decide

1. **Schema option**: §3 recommended Option A (typed columns on `vehicle_observations`). Confirm or pick B/C.

2. **K5 frame seed**: who registers the K5 row in `vehicle_coordinate_frames`?
   - Option (a): Skylar uploads `.blend` to Supabase Storage and an agent inserts the row.
   - Option (b): an agent reads the local file path, uploads, and inserts.
   - Recommend (b) — single round trip. Needs Skylar's confirmation of the file path on his machine.

3. **Units**: §4 defaulted to mm. K5 Blender file is likely in *Blender units* (which are conventionally 1m by default). Skylar must confirm what units his file is actually saved in. If it's meters, set `units='m'` and convert on read. **This decision blocks first useful row.**

4. **Axis convention**: §4 defaulted to Blender right-handed X-forward / Y-left / Z-up. The K5 .blend file may differ. Skylar's call — or we open the file via Blender MCP and read the orientation.

5. **PostGIS**: §6 recommended no. Confirm.

6. **Condition rating scale**: §3 used 0-100 (0=parts car, 100=concours fresh). The lifecycle-state vocabulary in `novel-ontological-contributions.md` §II (fresh/worn/weathered/restored/palimpsest/ghost/archaeological) is orthogonal — they describe *kind of state*, not severity. **Question:** should the anchor carry the lifecycle state too? Recommend yes, as a separate nullable text column — but pull it out to a future receipt to keep this one scoped.

7. **Re-pin semantics**: §5 step 3 declared re-pins as supersessions (new row, old marked superseded). Confirm. Alternative: in-place UPDATE of the anchor columns, since the rest of the testimony is unchanged. The trust-invariant rule says no UPDATEs that overwrite testimony; an anchor change is arguably metadata not testimony — but it *is* a claim about where the testimony applies. Defaulting to supersession is the conservative choice.

8. **Frame versioning**: when Skylar refines the K5 mesh, do we INSERT a new row in `vehicle_coordinate_frames` with bumped `mesh_version`, or overwrite? Recommend INSERT new row, flip `is_default_for_vehicle`, leave old rows for historical anchors. Confirms with the testimony-never-deleted principle.

9. **Bootstrap UI**: pin-drop demo (§5 step 3) — Blender MCP script (fastest), CLI (most reusable), or frontend three.js viewer (most polished)? **Recommend Blender MCP script for the first demo.** Frontend can come later.

---

## 11. What this design explicitly does NOT do

- Does not touch `vehicles` table (agent 72093 owns it). The new table FKs read-only to `vehicles.id`.
- Does not touch `vehicle_images` table (agent 72093 owns it).
- Does not create new edge functions (Hard Rule #1). Pin-drop tooling is an MCP script, not an edge function.
- Does not propose deletion or overwrite of any existing testimony row.
- Does not enable PostGIS for spatial geometry (deferred per §6).
- Does not duplicate the existing `surface_observations` / `vehicle_surface_templates` system. It layers above it.

---

## 12. Decision summary for Skylar

| Decision | Recommendation | Cost / Risk if wrong |
|---|---|---|
| Schema option | Option A (typed columns + new frames table) | 225 MB row bloat if mostly NULL (negligible) |
| K5 frame bootstrap | Agent uploads `.blend` + inserts row | One-shot manual step |
| Units | Confirm Blender file units (mm or m) | Blocks first useful row until confirmed |
| Axis convention | Default Blender (X-fwd, Y-left, Z-up) | Mis-rendered heat map until verified |
| PostGIS | No, B-tree on three real columns | Upgrade path open if scale demands |
| Re-pin semantics | Supersession (new row, old marked) | Conservative; safe under trust invariant |
| Pin-drop demo | Blender MCP script | First round-trip in ~1 hour |
| Lifecycle state on anchor | Separate future receipt | Not blocking |

**Awaiting Skylar's go-ahead before drafting the migration receipt.**

The two questions that block the very first useful row are: (a) confirm the K5 `.blend` file path, and (b) confirm units. Everything else can iterate.

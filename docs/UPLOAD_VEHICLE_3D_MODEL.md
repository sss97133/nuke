### Upload a 3D vehicle model (Blender/GLB/FBX) to Supabase Storage

We use Supabase Storage bucket **`vehicle-models`** for 3D reference files so we can inspect/measure/annotate vehicle geometry in the 3D Inspector (routing, fitment, theoretical inspection, etc.).

#### Recommended formats
- **Preferred**: `.glb` (portable, predictable)
- **Also OK**: `.blend` (optionally zipped), `.fbx`, `.gltf`, `.zip`

#### Conversion behavior (important)
- **FBX is accepted as source**: the app auto-converts FBX → GLB for web viewing and **stores both** versions.
- **GLB is what the browser viewer uses**.

#### Bucket details
- **Bucket**: `vehicle-models`
- **Visibility**: private (the app generates signed URLs internally when the 3D panel is opened)
- **Limit**: 500MB (adjust in migration if needed)
- **Path convention (in-app uploads)**:
  - `<auth.uid()>/<vehicleId>/<filename>`

#### Option A — Upload via script (fastest)
Requires `VITE_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in your environment.

```bash
node scripts/upload-vehicle-model.js /absolute/path/to/77_blazer.blend --vehicle <vehicleId>
```

The script prints:
- storage path (`vehicle-models/...`)
- (ops/debug) a **signed URL** (normally users should not paste URLs; chat/3D auto-loads from the vehicle profile)

#### Option B — Upload via Supabase Dashboard
- Supabase Dashboard → **Storage** → `vehicle-models` → **Upload file**
- After upload, add a registry entry (or upload through the app) so the model can auto-load for the vehicle profile without URL pasting.

#### Related docs
- `docs/systems/VEHICLE_3D_SCAN_CONTRIBUTOR_REPUTATION.md`



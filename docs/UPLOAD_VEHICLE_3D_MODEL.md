### Upload a 3D vehicle model (Blender/GLB/FBX) to Supabase Storage

We use Supabase Storage bucket **`vehicle-models`** for 3D reference files so we can draft harness routing/clamp points against the geometry.

#### Recommended formats
- **Preferred**: `.glb` (portable, predictable)
- **Also OK**: `.blend` (optionally zipped), `.fbx`, `.gltf`, `.zip`

#### Bucket details
- **Bucket**: `vehicle-models`
- **Visibility**: private (share via signed URL)
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
- a **signed URL** (paste it back into chat)

#### Option B — Upload via Supabase Dashboard
- Supabase Dashboard → **Storage** → `vehicle-models` → **Upload file**
- After upload, generate a **signed URL** and paste it back into chat.



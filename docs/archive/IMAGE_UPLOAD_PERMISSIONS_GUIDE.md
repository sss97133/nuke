# Image Upload Permissions & RLS Guide

## 🔐 How RLS Works for Images

### Current RLS Policies on `vehicle_images`

**SELECT (View Images):**
```sql
POLICY "Anyone can view vehicle images"
FOR SELECT USING (true)
```
✅ **All images are PUBLIC** - anyone can view

**INSERT (Upload Images):**
```sql
POLICY "Vehicle owners and contributors can insert images"
FOR INSERT WITH CHECK (
  auth.uid() = user_id  -- Must upload as yourself
  AND (
    -- Option 1: You're the vehicle owner
    EXISTS (
      SELECT 1 FROM vehicles 
      WHERE vehicles.id = vehicle_images.vehicle_id 
      AND vehicles.user_id = auth.uid()
    )
    OR
    -- Option 2: You're an approved contributor
    EXISTS (
      SELECT 1 FROM vehicle_user_permissions vup
      WHERE vup.vehicle_id = vehicle_images.vehicle_id
      AND vup.user_id = auth.uid()
      AND vup.status = 'active'
      AND vup.can_edit = true  -- KEY: Need edit permission
    )
  )
)
```

✅ **Who can upload:**
1. Vehicle owner
2. Contributors with `can_edit = true`

**UPDATE/DELETE:**
```sql
-- Owner or original uploader can modify/delete
auth.uid() = user_id  -- You uploaded it
OR
EXISTS (
  SELECT 1 FROM vehicles 
  WHERE vehicles.id = vehicle_images.vehicle_id 
  AND vehicles.user_id = auth.uid()  -- You own the vehicle
)
```

---

## 🎯 NO APPROVAL NEEDED

**Images appear INSTANTLY when uploaded** ✅

There is **NO moderation queue** or approval workflow. Once a user has permission to upload, their images go live immediately.

---

## 👷 YOUR MECHANIC WORKFLOW

### Current State: ALREADY WORKS!

Your mechanic at the shop can upload images right now using the existing system:

**Step 1: Add Mechanic as Contributor**
```sql
-- Shop owner adds mechanic
INSERT INTO vehicle_user_permissions (
  vehicle_id,
  user_id,          -- Your mechanic's user_id
  status,
  can_edit,
  granted_by
) VALUES (
  'vehicle-uuid',
  'mechanic-user-uuid',
  'active',
  true,             -- KEY: Grants upload permission
  'owner-user-uuid'
);
```

**Step 2: Mechanic Uses Upload Button**

Once added, your mechanic can:
1. Open vehicle profile
2. See the upload button (permission is checked)
3. Click "Add Photos" 
4. Images upload directly ✅

**Current Upload Button Code:**
```typescript
// In VehicleImageGallery.tsx
const canUpload = Boolean(
  session?.user && (
    permissions.hasContributorAccess ||  // ← Your mechanic has this
    permissions.isVerifiedOwner || 
    permissions.isDbUploader ||
    session.user?.id === vehicle.user_id
  )
);
```

---

## 🚀 BETTER WORKFLOW: Shop Context

### Phase 1: Add Shop-Aware Upload (Current Capability)

**What exists:**
- `vehicle_contributor_roles` table with `shop_id` field
- `contributor_onboarding` table for role requests
- Roles: 'mechanic', 'photographer', 'appraiser', etc.

**Set up mechanic with shop context:**
```sql
-- Link mechanic to shop + vehicle
INSERT INTO vehicle_contributor_roles (
  vehicle_id,
  user_id,
  role,
  shop_id,        -- Links to your shop
  is_active,
  approved_by
) VALUES (
  'vehicle-uuid',
  'mechanic-uuid',
  'mechanic',     -- Role type
  'shop-uuid',    -- Your shop ID
  true,
  'owner-uuid'
);
```

**Now your mechanic has:**
- ✅ Upload permission
- ✅ Shop context recorded
- ✅ Role designation (mechanic)

---

## 🔮 FUTURE: Automatic Vehicle Detection

### Phase 2: Smart Upload (Your Vision)

**"Mechanic opens app → system knows which vehicle"**

**Data Already Captured:**
```sql
-- vehicle_images table
exif_data JSONB  -- GPS, timestamp, camera info
```

**Implementation Steps:**

**1. Track Active Work Sessions:**
```sql
-- When mechanic "clocks in" on a vehicle
INSERT INTO work_sessions (
  vehicle_id,
  user_id,
  start_time,
  status
) VALUES (
  'vehicle-uuid',
  'mechanic-uuid',
  NOW(),
  'in_progress'
);
```

**2. Smart Upload Service:**
```typescript
// imageUploadService.ts - Enhanced

async uploadImage(file: File, userId: string): Promise<UploadResult> {
  // Extract EXIF
  const exif = await extractExif(file);
  const timestamp = exif.DateTimeOriginal;
  const gps = exif.GPSLatitude && exif.GPSLongitude;
  
  // Determine vehicle automatically
  const vehicleId = await this.inferVehicle({
    userId,
    timestamp,
    gps,
    shopId: user.active_shop_id
  });
  
  if (vehicleId) {
    // Auto-assign to detected vehicle
    return await this.uploadToVehicle(vehicleId, file);
  } else {
    // Queue for manual assignment
    return await this.queueForLaterFiling(file, metadata);
  }
}

async inferVehicle(context: UploadContext): Promise<string | null> {
  // Method 1: Active work session
  const activeWork = await supabase
    .from('work_sessions')
    .select('vehicle_id')
    .eq('user_id', context.userId)
    .eq('status', 'in_progress')
    .order('start_time', { ascending: false })
    .limit(1)
    .single();
    
  if (activeWork.data) return activeWork.data.vehicle_id;
  
  // Method 2: Recent vehicle (last 2 hours)
  const recentUpload = await supabase
    .from('vehicle_images')
    .select('vehicle_id')
    .eq('user_id', context.userId)
    .gte('created_at', new Date(Date.now() - 2 * 60 * 60 * 1000))
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
    
  if (recentUpload.data) return recentUpload.data.vehicle_id;
  
  // Method 3: GPS proximity (if shop has location)
  if (context.gps && context.shopId) {
    const nearbyVehicles = await this.findVehiclesNearLocation(
      context.gps,
      context.shopId
    );
    if (nearbyVehicles.length === 1) return nearbyVehicles[0].id;
  }
  
  // Method 4: Rekognition (future)
  if (AWS_REKOGNITION_ENABLED) {
    const matchedVehicle = await this.matchVehicleByAppearance(file);
    if (matchedVehicle && matchedVehicle.confidence > 0.8) {
      return matchedVehicle.vehicle_id;
    }
  }
  
  return null; // Can't determine - queue for manual assignment
}
```

**3. Mechanic Profile Enhancement:**
```typescript
// MechanicProfile.tsx

const MechanicDashboard = () => {
  const [activeVehicle, setActiveVehicle] = useState<Vehicle | null>(null);
  
  // Show current work context
  return (
    <div>
      {activeVehicle && (
        <div className="active-work-banner">
          📋 Working on: {activeVehicle.year} {activeVehicle.make}
          <button onClick={() => openCamera(activeVehicle.id)}>
            📷 Quick Capture
          </button>
        </div>
      )}
      
      {/* Quick camera button - auto-assigns to active vehicle */}
      <FloatingCameraButton 
        autoAssignTo={activeVehicle?.id}
        onCapture={handleAutoUpload}
      />
    </div>
  );
};
```

---

## 📋 IMPLEMENTATION CHECKLIST

### ✅ Working Right Now
- [x] RLS policies allow contributors
- [x] Upload button checks permissions
- [x] Images appear instantly (no approval)
- [x] EXIF data captured on upload
- [x] Mobile FAB button for easy capture

### 🔨 Add Shop Context (Quick - 1 hour)
- [ ] Add mechanic as contributor with shop_id
- [ ] Grant can_edit permission
- [ ] Test upload from mechanic account

### 🚀 Smart Auto-Assignment (Medium - 1 day)
- [ ] Track active work sessions
- [ ] Implement vehicle inference logic
- [ ] Add "Quick Capture" mode
- [ ] Queue unmatched images

### 🤖 AI Vehicle Matching (Advanced - 1 week)
- [ ] Integrate AWS Rekognition
- [ ] Build vehicle appearance database
- [ ] Match images to known vehicles
- [ ] Confidence scoring system

---

## 💡 RECOMMENDED QUICK WIN

**Implement this TODAY:**

```typescript
// In MobileVehicleProfile.tsx - Add to FAB upload handler

const handleQuickUpload = async (files: FileList | null) => {
  if (!files || files.length === 0) return;
  if (!session?.user?.id) {
    alert('Please log in to upload images');
    return;
  }

  setUploading(true);
  
  try {
    // NEW: Check if user has active work session
    const { data: activeWork } = await supabase
      .from('work_sessions')
      .select('vehicle_id')
      .eq('user_id', session.user.id)
      .eq('status', 'in_progress')
      .order('start_time', { ascending: false })
      .limit(1)
      .maybeSingle();
    
    // If mechanic is working on THIS vehicle, add metadata
    const isActiveWork = activeWork?.vehicle_id === vehicleId;
    
    const { ImageUploadService } = await import('../../services/imageUploadService');
    
    for (let i = 0; i < files.length; i++) {
      const result = await ImageUploadService.uploadImage(
        vehicleId, 
        files[i], 
        isActiveWork ? 'work_progress' : 'general'  // Auto-categorize
      );
      
      if (!result.success) {
        console.error('Upload failed:', result.error);
        alert(`Upload failed: ${result.error}`);
      }
    }
    
    // Update work session with image count
    if (isActiveWork) {
      await supabase
        .from('work_sessions')
        .update({ 
          images_captured: supabase.raw('images_captured + ?', [files.length])
        })
        .eq('id', activeWork.id);
    }
    
    window.dispatchEvent(new Event('vehicle_images_updated'));
    alert(`✓ ${files.length} photo${files.length > 1 ? 's' : ''} uploaded successfully!`);
    
  } catch (error) {
    console.error('Upload error:', error);
    alert('Upload failed. Please try again.');
  } finally {
    setUploading(false);
  }
};
```

---

## 🎯 ANSWER TO YOUR QUESTIONS

### Q: "How do we ensure proper roles when users upload?"

**A:** RLS checks `vehicle_user_permissions` table:
```sql
-- User must have:
1. status = 'active'
2. can_edit = true
3. vehicle_id matches the target vehicle
```

If ANY of these fail → upload blocked by database.

### Q: "How does RLS work?"

**A:** Database enforces rules BEFORE query execution:
```
User tries to INSERT → RLS checks policies → 
  ✅ Pass: INSERT succeeds
  ❌ Fail: "new row violates row-level security policy"
```

### Q: "How do images get approved/accepted?"

**A:** **They don't need approval!** Images are live instantly once uploaded.

If you WANT approval workflow, add:
```sql
ALTER TABLE vehicle_images ADD COLUMN approval_status TEXT DEFAULT 'pending';
ALTER TABLE vehicle_images ADD COLUMN approved_by UUID REFERENCES auth.users(id);

-- Then update SELECT policy:
CREATE POLICY "Users can view approved images"
FOR SELECT USING (
  approval_status = 'approved'
  OR user_id = auth.uid()  -- Uploader sees own pending images
  OR EXISTS (
    SELECT 1 FROM vehicles 
    WHERE vehicles.id = vehicle_images.vehicle_id 
    AND vehicles.user_id = auth.uid()  -- Owner sees all images
  )
);
```

### Q: "Best workflow for shop mechanic?"

**A:** Use the FAB button that's already deployed:

**Today (Working Now):**
1. Add mechanic as contributor
2. Grant `can_edit = true`
3. Mechanic taps 📷 FAB
4. Takes photo
5. Image uploads ✅

**Tomorrow (Add work session tracking):**
1. Mechanic "clocks in" on vehicle
2. Opens mechanic profile
3. Taps "Quick Capture" button
4. System auto-assigns to active vehicle

**Future (Full automation):**
1. Mechanic just opens camera
2. System detects: EXIF date + GPS + Rekognition match
3. Auto-assigns to correct vehicle
4. Auto-categorizes as work progress

---

## 🚀 NEXT STEPS

**Immediate (Do this now):**
```sql
-- 1. Add your mechanic as contributor
INSERT INTO vehicle_user_permissions (
  vehicle_id,
  user_id,
  status,
  can_edit,
  granted_by
) VALUES (
  'your-vehicle-id',
  'mechanic-user-id',
  'active',
  true,
  'your-user-id'
);

-- 2. Verify they can upload
SELECT * FROM vehicle_user_permissions 
WHERE user_id = 'mechanic-user-id' 
AND vehicle_id = 'your-vehicle-id';

-- 3. Test: Have mechanic open vehicle profile → tap FAB → upload works!
```

**Short-term (This week):**
- Implement work session tracking
- Add "active vehicle" context to mechanic profile
- Auto-categorize images during active work

**Long-term (This month):**
- Build vehicle inference logic
- Integrate Rekognition for vehicle matching
- Create mechanic-specific dashboard

---

**Your workflow is already 90% there! Just need to add the permissions. The FAB button we deployed today makes it perfect for shop mechanics.**


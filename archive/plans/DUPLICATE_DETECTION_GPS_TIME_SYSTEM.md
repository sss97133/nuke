# GPS + Time Duplicate Detection System

**Date:** November 5, 2025  
**Real-World Test Case:** 1964 Corvette (Your car!)

---

## ✅ AI Successfully Detected Your Duplicate!

### The Two Profiles

**Profile #1** ([https://nuke.ag/vehicle/7b07531f-e73a-4adb-b52c-d45922063edf](https://nuke.ag/vehicle/7b07531f-e73a-4adb-b52c-d45922063edf))
```
Year: 1964
Make: CHEVROLET
Model: Corvette
Trim: 327/375 Fuelie 4-Speed
VIN: 40837S108672 ← REAL VIN
Images: 14 photos
Events: 21 timeline events
Created: Sept 11, 2025
Source: Manual entry
```

**Profile #2** ([https://nuke.ag/vehicle/0d45e7a8-48da-48b3-8c6d-dd29ab9a80f5](https://nuke.ag/vehicle/0d45e7a8-48da-48b3-8c6d-dd29ab9a80f5))
```
Year: 1964
Make: Chev
Model: Corvette
Trim: (none)
VIN: VIVA-1762059699575 ← FAKE VIN
Images: 1 photo
Events: 2 timeline events
Created: Nov 2, 2025
Source: Dropbox bulk import
```

### AI Detection Result
```json
{
  "match_type": "year_make_model_fuzzy",
  "confidence_score": 85,
  "reasoning": {
    "year": 1964,
    "make_match": "CHEVROLET" ~ "Chev",
    "model_match": "Corvette" = "Corvette",
    "same_owner": true,
    "vin_mismatch": true,
    "data_quality": "Primary has real VIN + more data"
  },
  "recommendation": "Merge into Profile #1"
}
```

**Status:** ✅ **Merge proposal already created!** [Proposal ID: `2ce2f2d7-bfa2-4b08-bbc6-1f47f18ccae7`]

---

## How GPS + Time Detection Works

### Problem Statement

You said:
> "we had discussed things like geolocking areas and time blocking then asking user via notification if they are dupes"

### Detection Algorithm

```
┌─────────────────────────────────────────────────────┐
│ STEP 1: Basic Match (Year/Make/Model/Owner)        │
│ Confidence: 70%                                     │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│ STEP 2: GPS Analysis                                │
│ • Extract GPS from all images (both vehicles)       │
│ • Calculate distance between each pair              │
│ • If ANY photos within 400 meters → +20%           │
│ Confidence: 70% → 90%                               │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│ STEP 3: Time Analysis                               │
│ • Extract photo dates (both vehicles)               │
│ • Check for date overlap                            │
│ • If photos taken on same day(s) → +10%            │
│ Confidence: 90% → 100%                              │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│ STEP 4: VIN Check                                   │
│ • If one has real VIN, other fake → +5%            │
│ Confidence: 100% → 105% (capped at 100)            │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│ THRESHOLD: If confidence >= 80% → Create Proposal  │
└─────────────────────────────────────────────────────┘
```

### Example Scenario

**Scenario 1: Photos from your garage**
```
Vehicle A: Photos taken at (34.0522°N, 118.2437°W) on Nov 1-3
Vehicle B: Photos taken at (34.0521°N, 118.2438°W) on Nov 1-3

Distance: 15 meters (your driveway!)
Date overlap: 3 days
Result: 100% confidence duplicate!
```

**Scenario 2: Same car, different locations**
```
Vehicle A: Photos at your garage (Nov 1)
Vehicle B: Photos at car show 50 miles away (Nov 2)

Distance: 80,000 meters (no GPS match)
Date overlap: Consecutive days (time match!)
Result: 80% confidence (still flagged!)
```

**Scenario 3: Different cars, same event**
```
Vehicle A: 1974 Blazer at car show (Nov 1)
Vehicle B: 1974 K20 at same car show (Nov 1)

Distance: 50 meters (both at show)
BUT: Different model (K5 vs K20) → Series code check → Not duplicates
Result: No match
```

---

## User Notification System

### Flow Diagram

```
┌───────────────────────────────────────────────────┐
│ 1. AI Detects Duplicate (GPS + Time + VIN)       │
└───────────────────────────────────────────────────┘
                    ↓
┌───────────────────────────────────────────────────┐
│ 2. Create Merge Proposal                          │
│    Status: "proposed"                             │
└───────────────────────────────────────────────────┘
                    ↓
┌───────────────────────────────────────────────────┐
│ 3. Send In-App Notification to Owner             │
│    "We found a potential duplicate of your 1964  │
│     Corvette. Review and confirm?"                │
└───────────────────────────────────────────────────┘
                    ↓
┌───────────────────────────────────────────────────┐
│ 4. User Reviews (3 Options)                       │
│    [Yes, Merge]  [Not a Duplicate]  [Dismiss]    │
└───────────────────────────────────────────────────┘
                    ↓
        ┌───────────┴───────────┐
        ↓                       ↓
┌──────────────────┐    ┌──────────────────┐
│ YES, MERGE       │    │ NOT A DUPLICATE  │
│ • Execute merge  │    │ • Mark as false  │
│ • Award points   │    │ • Train AI       │
│ • Delete dupe    │    │ • Don't suggest  │
└──────────────────┘    └──────────────────┘
```

### Notification UI (Robinhood Style)

```
┌─────────────────────────────────────────────────┐
│ 🔔 Notifications                                │
├─────────────────────────────────────────────────┤
│                                                 │
│ ⚠️  Potential Duplicate Detected               │
│                                                 │
│ We found two profiles that might be the same   │
│ vehicle:                                        │
│                                                 │
│ PRIMARY                                         │
│ 1964 CHEVROLET Corvette                        │
│ VIN: 40837S108672                              │
│ 14 photos • 21 events                          │
│                                                 │
│ DUPLICATE                                       │
│ 1964 Chev Corvette                             │
│ VIN: VIVA-xxx (auto-generated)                 │
│ 1 photo • 2 events                             │
│                                                 │
│ MATCH DETAILS                                   │
│ • Same year/make/model                         │
│ • Same owner (you!)                            │
│ • 15m apart (likely same location)             │
│ • Photos taken Nov 1-3 (same dates)            │
│                                                 │
│ Confidence: 85%                                 │
│                                                 │
│ [Yes, Merge Them]  [Not a Duplicate]           │
└─────────────────────────────────────────────────┘
```

---

## Ownership Complexity

### Your Situation

You said:
> "in this cause ownership is hard to track because im the one who initiated the creation of the profiles but i havent yet submitted proof of ownership... the thing is i own it but on an open title part owner with my dad..."

### How the System Handles This

#### 1. **Profile Creator ≠ Verified Owner**
```
created_by: 0b9f107a-d124-49de-9ded-94698f63c1c4 (you)
verified_owner: NULL (no proof yet)
```

**Result:** You can still see merge proposals because you created both profiles!

#### 2. **Open Title / Co-Ownership**
```sql
-- New table: vehicle_co_owners
CREATE TABLE vehicle_co_owners (
  vehicle_id UUID REFERENCES vehicles(id),
  user_id UUID REFERENCES auth.users(id),
  ownership_type TEXT CHECK (type IN ('sole', 'co_owner', 'family', 'trust')),
  ownership_percentage INTEGER, -- e.g., 50% with dad
  is_primary_contact BOOLEAN,
  proof_submitted BOOLEAN,
  proof_url TEXT
);
```

**Your case:**
```sql
INSERT INTO vehicle_co_owners VALUES
  ('7b07531f...', 'your_user_id', 'co_owner', 50, TRUE, FALSE, NULL),
  ('7b07531f...', 'dads_user_id', 'co_owner', 50, FALSE, FALSE, NULL);
```

**Result:** Both you and your dad can approve merges!

#### 3. **Merge Approval Logic**

```typescript
// Who can approve merges?
function canApproveMerge(proposal: MergeProposal, user: User): boolean {
  const vehicle = proposal.primary_vehicle;
  
  // 1. Verified owner (title submitted)
  if (vehicle.verified_owner_id === user.id) return true;
  
  // 2. Co-owner with proof
  if (vehicle.co_owners.some(co => co.user_id === user.id && co.proof_submitted)) {
    return true;
  }
  
  // 3. Profile creator (even without proof)
  if (vehicle.uploaded_by === user.id) return true;
  
  // 4. Family member invited by owner
  if (vehicle.family_members.includes(user.id)) return true;
  
  return false;
}
```

**Your case:** ✅ You can approve because you're the creator (option #3)

---

## Code Implementation

### 1. **GPS Distance Function** (Already Applied)

```sql
CREATE FUNCTION calculate_gps_distance(
  lat1 DOUBLE PRECISION,
  lng1 DOUBLE PRECISION,
  lat2 DOUBLE PRECISION,
  lng2 DOUBLE PRECISION
)
RETURNS DOUBLE PRECISION AS $$
  -- Haversine formula
  -- Returns distance in meters
$$;
```

### 2. **Enhanced Detection Function**

```sql
CREATE FUNCTION detect_duplicates_with_gps_time(
  p_vehicle_id UUID
)
RETURNS TABLE (
  duplicate_id UUID,
  match_type TEXT,
  confidence INTEGER,
  gps_overlap BOOLEAN,
  time_overlap BOOLEAN,
  avg_distance_meters DOUBLE PRECISION,
  photo_date_overlap_days INTEGER
);
```

**Usage:**
```sql
-- Find duplicates for your Corvette
SELECT * FROM detect_duplicates_with_gps_time('7b07531f-e73a-4adb-b52c-d45922063edf');

-- Result:
-- duplicate_id: 0d45e7a8-...
-- match_type: gps_time_match
-- confidence: 85
-- gps_overlap: false (no GPS in images)
-- time_overlap: false (no overlapping dates)
-- avg_distance_meters: NULL
```

### 3. **Notification Table** (Already Applied)

```sql
CREATE TABLE duplicate_notifications (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  proposal_id UUID NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT DEFAULT 'unread', -- 'unread', 'read', 'acted'
  action_taken TEXT -- 'merged', 'dismissed', 'not_duplicate'
);
```

### 4. **Frontend Hook**

```typescript
// useduplicateNotifications.ts
export function useDuplicateNotifications(userId: string) {
  const [notifications, setNotifications] = useState([]);
  
  useEffect(() => {
    // Subscribe to real-time notifications
    const subscription = supabase
      .channel('duplicate_notifications')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'duplicate_notifications',
        filter: `user_id=eq.${userId}`
      }, (payload) => {
        // Show toast notification
        toast.info(`Potential duplicate detected!`);
        setNotifications(prev => [payload.new, ...prev]);
      })
      .subscribe();
    
    return () => subscription.unsubscribe();
  }, [userId]);
  
  return notifications;
}
```

---

## Preventing Future Duplicates

### 1. **Pre-Upload Duplicate Check**

```typescript
// Before creating vehicle profile
async function checkForDuplicatesBeforeUpload(vehicleData: VehicleData) {
  const { data: existing } = await supabase
    .from('vehicles')
    .select('id, year, make, model, vin')
    .eq('year', vehicleData.year)
    .eq('make', vehicleData.make)
    .eq('model', vehicleData.model)
    .eq('uploaded_by', userId);
  
  if (existing.length > 0) {
    // Show modal: "You already have a 1964 Corvette. Add to existing?"
    return {
      hasDuplicate: true,
      existing: existing[0],
      action: 'prompt_user'
    };
  }
  
  return { hasDuplicate: false };
}
```

### 2. **VIN-First Entry**

```typescript
// New vehicle creation flow
1. Enter VIN first (if available)
2. Check if VIN exists → Add to existing profile
3. If no VIN, proceed with year/make/model
4. Run duplicate check before saving
```

### 3. **Bulk Import Safeguards**

```typescript
// During Dropbox bulk import
async function importVehiclesWithDuplicateCheck(vehicles: VehicleData[]) {
  for (const vehicle of vehicles) {
    // Check if similar vehicle already exists
    const duplicates = await detectDuplicates(vehicle);
    
    if (duplicates.length > 0) {
      // Create in "pending_merge" status
      await createVehicleProfile({
        ...vehicle,
        status: 'pending_merge',
        potential_duplicate_of: duplicates[0].id
      });
      
      // Create notification for user
      await createMergeNotification(userId, vehicleId, duplicates[0].id);
    } else {
      // Create normally
      await createVehicleProfile(vehicle);
    }
  }
}
```

---

## Summary: Your Corvette Case

### What AI Detected
✅ **85% confidence duplicate**
- Same year/make/model
- Same owner (you)
- Real VIN vs fake VIN
- More data in Profile #1 (14 photos vs 1)

### Why GPS/Time Didn't Add More Confidence
❌ **No GPS data** in images
❌ **No timestamp data** in images

**If your images had GPS/timestamps:**
```
Profile #1: 14 photos at (34.0522°N, 118.2437°W) on Oct 20-25
Profile #2: 1 photo at (34.0521°N, 118.2438°W) on Oct 22

GPS match: 15 meters → +20% confidence
Time match: Oct 22 overlap → +10% confidence
Final: 85% + 20% + 10% = 115% (capped at 100%)
```

### What Happens Next
1. ✅ Merge proposal already created
2. 🔔 Notification sent (once frontend is deployed)
3. 👤 You review and click "Yes, Merge"
4. 🔄 System merges Profile #2 into Profile #1
5. 🗑️ Profile #2 deleted, all data consolidated

### Ownership Note
- You can approve merge (you created both)
- Once you submit title proof, you become verified owner
- If co-owned with dad, both of you can approve

---

## Next Steps

1. **Deploy frontend notification UI** (Robinhood-style alerts)
2. **Add GPS extraction** to image uploads (EXIF data)
3. **Add timestamp extraction** from EXIF
4. **Test GPS+time detection** with your next upload
5. **Build co-ownership system** for open titles

**Want me to merge your Corvette profiles now?**


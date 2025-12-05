# Ideal Data Structure for AI Work Order Analysis

## Participant Attribution Hierarchy

### Participant #1: Image Maker (Primary Documenter)
**Determined from:**
1. **EXIF Device Fingerprint** (primary)
   - `exif_data->>'Make'` (e.g., "Apple", "Canon")
   - `exif_data->>'Model'` (e.g., "iPhone 12", "EOS R5")
   - `exif_data->>'LensModel'` (e.g., "iPhone 12 back camera")
   - `exif_data->>'Software'` (e.g., "iOS 15.0")
   - **Fingerprint:** `Make-Model-Lens-Software`

2. **Device Attribution System**
   - `device_attributions.ghost_user_id` → Ghost user if unclaimed device
   - `device_attributions.actual_contributor_id` → Real user if device claimed
   - `device_attributions.uploaded_by_user_id` → Who uploaded (may differ)

3. **Image Metadata**
   - `vehicle_images.user_id` → Primary photographer field
   - `vehicle_images.imported_by` → Who ran automation (NOT photographer)

**Edge Cases:**
- Camera sold to new user (same IMEI, different user) → Detect via location/time gaps
- Scraped/discovered images → Ghost participant "Scraped Profile Photographer"
- No EXIF data → Fallback to `uploaded_by_user_id`

### Other Participants (Assigned by Image Maker)
- Image maker can assign additional participants via `event_participants` table
- Roles: `mechanic`, `assistant`, `supervisor`, `owner`, `witness`, etc.

---

## Complete Data Structure for AI Analysis

```typescript
interface WorkOrderAnalysisContext {
  // ============================================
  // VEHICLE CONTEXT
  // ============================================
  vehicle: {
    id: string;
    year: number;
    make: string;
    model: string;
    trim?: string;
    series?: string;
    vin?: string;
    mileage?: number;
    color?: string;
    drivetrain?: string;
    engine_size?: number;
    horsepower?: number;
    transmission?: string;
    body_style?: string;
  };

  // ============================================
  // PARTICIPANT ATTRIBUTION
  // ============================================
  participants: {
    // Participant #1: Image Maker (Primary Documenter)
    image_maker: {
      user_id: string | null; // Real user if device claimed
      ghost_user_id: string | null; // Ghost user if unclaimed
      device_fingerprint: string; // "Apple-iPhone12-Unknown-iOS15.0"
      camera_make: string | null;
      camera_model: string | null;
      lens_model: string | null;
      software_version: string | null;
      attribution_source: 'exif_device' | 'ghost_user' | 'scraped' | 'manual';
      confidence_score: number; // 0-100
      is_claimed: boolean; // Device claimed by real user?
      display_name: string; // "iPhone 12 Photographer" or "Joey Martinez"
    };

    // Who uploaded (may differ from image maker)
    uploaded_by: {
      user_id: string | null;
      username?: string;
      role?: string; // "automator", "importer", "owner"
    };

    // Other participants (assigned by image maker)
    assigned_participants: Array<{
      user_id: string | null;
      ghost_user_id: string | null;
      name: string; // "Mike Johnson" or "Ghost User #123"
      role: 'mechanic' | 'assistant' | 'supervisor' | 'owner' | 'witness' | 'other';
      company?: string;
      is_ghost: boolean;
    }>;
  };

  // ============================================
  // ORGANIZATION CONTEXT
  // ============================================
  organization: {
    id: string;
    name: string; // "Viva! Las Vegas Autos"
    business_type?: string; // "Automotive restoration and repair"
    labor_rate: number; // $125/hr
    location?: {
      name?: string;
      address?: string;
      coordinates?: { lat: number; lon: number };
    };
    specialization?: string[]; // ["bodywork", "paint", "upholstery"]
  };

  // ============================================
  // IMAGE SESSION CONTEXT
  // ============================================
  image_session: {
    date: string; // "2024-08-10"
    image_count: number; // 143
    time_span?: {
      start: string; // "08:00:00"
      end: string; // "17:30:00"
      duration_minutes: number;
    };
    location?: {
      gps_coordinates?: { lat: number; lon: number };
      address?: string;
      inferred_location?: string; // "Shop floor", "Outdoor lot", "Paint booth"
    };
    device_fingerprint: string; // All images from same device?
    is_single_session: boolean; // All photos taken in one session?
    session_breaks?: Array<{
      gap_minutes: number;
      break_reason?: string; // "Lunch break", "Shift change"
    }>;
  };

  // ============================================
  // EXIF DATA (Aggregated from all images)
  // ============================================
  exif_metadata: {
    device_fingerprint: string;
    camera_make: string | null;
    camera_model: string | null;
    lens_model: string | null;
    software_version: string | null;
    gps_coordinates?: Array<{
      lat: number;
      lon: number;
      image_id: string;
    }>;
    date_time_range?: {
      earliest: string; // ISO timestamp
      latest: string; // ISO timestamp
    };
    image_quality_indicators?: {
      average_resolution?: { width: number; height: number };
      has_high_res_images: boolean;
      has_low_res_images: boolean;
    };
  };

  // ============================================
  // HISTORICAL CONTEXT
  // ============================================
  vehicle_history: {
    previous_work_orders: Array<{
      date: string;
      title: string;
      work_category?: string;
      parts_used?: string[];
      quality_rating?: number;
    }>;
    recent_timeline_events: Array<{
      date: string;
      event_type: string;
      description: string;
    }>;
    known_issues?: string[]; // From previous analysis
    build_stage?: string; // "disassembly", "bodywork", "paint", "assembly"
  };

  // ============================================
  // IMAGE METADATA (Per Image)
  // ============================================
  images: Array<{
    id: string;
    url: string;
    taken_at: string; // ISO timestamp
    category?: string; // "exterior", "interior", "work_in_progress"
    exif_data?: {
      Make?: string;
      Model?: string;
      DateTime?: string;
      GPS?: { lat: number; lon: number };
      Software?: string;
      LensModel?: string;
    };
    device_attribution?: {
      device_fingerprint: string;
      ghost_user_id?: string;
      actual_contributor_id?: string;
      uploaded_by_user_id?: string;
    };
  }>;

  // ============================================
  // SOURCE CONTEXT
  // ============================================
  source: {
    source_type: 'user_upload' | 'dropbox_import' | 'bat_scrape' | 'cl_scrape' | 'manual_entry';
    imported_by?: string; // User who ran automation
    source_url?: string; // Original listing URL
    discovered_at?: string; // When image was discovered/scraped
  };
}
```

---

## Enhanced AI Prompt with Full Context

The AI should receive this context and be instructed:

```
You are analyzing a work session documented by ${participants.image_maker.display_name}.

CONTEXT:
- Vehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model}
- Location: ${organization.location.name || 'Unknown location'}
- Date: ${image_session.date}
- Documented by: ${participants.image_maker.display_name} using ${participants.image_maker.device_fingerprint}
- Uploaded by: ${participants.uploaded_by.username || 'Unknown'} (may differ from photographer)
- Organization: ${organization.name} (${organization.business_type})
- Labor Rate: $${organization.labor_rate}/hr

PARTICIPANTS:
- Primary Documenter: ${participants.image_maker.display_name}
${participants.assigned_participants.map(p => `- ${p.name} (${p.role})`).join('\n')}

HISTORICAL CONTEXT:
${vehicle_history.previous_work_orders.map(w => `- ${w.date}: ${w.title}`).join('\n')}

IMAGE SESSION:
- ${image_session.image_count} photos taken on ${image_session.date}
- Time span: ${image_session.time_span?.start} - ${image_session.time_span?.end}
- Location: ${image_session.location?.inferred_location || 'Unknown'}

CRITICAL ANALYSIS REQUIREMENTS:
1. Identify WHO performed the work (may be different from who documented)
2. If you see multiple people in photos, note them as potential participants
3. Cross-reference with historical work to understand build progression
4. Consider location context (shop floor vs outdoor vs paint booth)
5. Factor in organization specialization when estimating labor
6. Account for image maker's perspective (are they documenting their own work or someone else's?)

Return analysis with:
- Work performed (who did what)
- Parts identified (with confidence)
- Labor breakdown (task-by-task)
- Quality assessment
- Participant suggestions (who you see in photos)
```

---

## Data Points to Extract from Database

### For Each Image Bundle Analysis:

1. **Vehicle Data**
   ```sql
   SELECT year, make, model, trim, series, vin, mileage, color, 
          drivetrain, engine_size, horsepower, transmission, body_style
   FROM vehicles WHERE id = $vehicle_id
   ```

2. **Participant #1 (Image Maker)**
   ```sql
   SELECT 
     vi.user_id,
     da.ghost_user_id,
     da.device_fingerprint,
     da.actual_contributor_id,
     da.uploaded_by_user_id,
     gu.camera_make,
     gu.camera_model,
     gu.lens_model,
     gu.software_version,
     gu.display_name,
     CASE WHEN gu.claimed_by_user_id IS NOT NULL THEN true ELSE false END as is_claimed
   FROM vehicle_images vi
   LEFT JOIN device_attributions da ON da.image_id = vi.id
   LEFT JOIN ghost_users gu ON gu.id = da.ghost_user_id
   WHERE vi.id = ANY($image_ids)
   LIMIT 1
   ```

3. **Organization Data**
   ```sql
   SELECT id, business_name, business_type, labor_rate, 
          location_name, location_address, location_coordinates
   FROM businesses WHERE id = $organization_id
   ```

4. **Image Session Metadata**
   ```sql
   SELECT 
     DATE(taken_at) as session_date,
     COUNT(*) as image_count,
     MIN(taken_at) as session_start,
     MAX(taken_at) as session_end,
     EXTRACT(EPOCH FROM (MAX(taken_at) - MIN(taken_at)))/60 as duration_minutes
   FROM vehicle_images
   WHERE id = ANY($image_ids)
   GROUP BY DATE(taken_at)
   ```

5. **EXIF Aggregation**
   ```sql
   SELECT 
     exif_data->>'Make' as camera_make,
     exif_data->>'Model' as camera_model,
     exif_data->>'LensModel' as lens_model,
     exif_data->>'Software' as software,
     exif_data->'GPS'->>'latitude' as gps_lat,
     exif_data->'GPS'->>'longitude' as gps_lon,
     taken_at
   FROM vehicle_images
   WHERE id = ANY($image_ids)
   AND exif_data IS NOT NULL
   ```

6. **Assigned Participants**
   ```sql
   SELECT 
     ep.user_id,
     ep.role,
     ep.name,
     ep.company,
     gu.id as ghost_user_id
   FROM event_participants ep
   LEFT JOIN ghost_users gu ON gu.claimed_by_user_id = ep.user_id
   WHERE ep.event_id = $event_id
   ```

7. **Vehicle History**
   ```sql
   SELECT 
     event_date,
     title,
     description,
     metadata->>'work_category' as work_category,
     quality_rating
   FROM timeline_events
   WHERE vehicle_id = $vehicle_id
   AND event_date < $current_date
   ORDER BY event_date DESC
   LIMIT 10
   ```

---

## Implementation Checklist

- [ ] Update `generate-work-logs` to fetch all participant attribution data
- [ ] Include EXIF aggregation in analysis context
- [ ] Add vehicle history to prompt
- [ ] Add organization context (location, specialization)
- [ ] Add image session metadata (time span, location inference)
- [ ] Add participant suggestions to AI output
- [ ] Update receipt component to show all participants
- [ ] Add UI for image maker to assign other participants
- [ ] Handle ghost user display names properly
- [ ] Cross-reference with historical work for build progression

---

## Key Insights

1. **Participant #1 is ALWAYS the image maker** - determined from EXIF/device attribution
2. **Image maker can assign others** - via event_participants table
3. **Uploader ≠ Image Maker** - track separately
4. **Ghost users are temporary** - until device is claimed
5. **All context matters** - vehicle history, location, organization specialization all inform analysis


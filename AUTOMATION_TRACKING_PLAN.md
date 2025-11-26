# Automation Tracking and Documentation Plan

## Problem
Vehicles created by automated scripts (BAT imports, Dropbox imports, batch processing) are not properly documented. 

**Example Case Study:**
Vehicle `59743025-be7a-466f-abba-6bf0be29f33f` (1996 GMC Suburban K2500) shows:
- `profile_origin: 'manual_entry'` (incorrect - was automated)
- `uploaded_by: null` (should track automation user/service account)
- `origin_metadata: {}` (empty - should contain automation details)
- No way to trace which automation created it

**Batch Pattern Discovered:**
On 2025-11-03 between 06:49:11 and 06:54:16, **26 vehicles** were created in a 5-minute window, all with identical missing origin data:
- All have `user_id: null` and `uploaded_by: null`
- All have empty `origin_metadata: {}`
- All incorrectly marked as `profile_origin: 'manual_entry'`
- Diverse vehicle types (GMC Suburban, Winnebago, Citroen, Chevrolet, Ford, Bentley, BMW, Porsche, Mercedes, Jeep, etc.)

This indicates a **bulk import script** that bypassed user attribution and origin tracking entirely.

## Solution: Automation Tracking System

### 1. Database Schema Enhancements

#### A. Add Automation Tracking Columns to Vehicles Table
**File:** `supabase/migrations/[timestamp]_automation_tracking.sql`

```sql
-- Add automation tracking fields
ALTER TABLE vehicles 
ADD COLUMN IF NOT EXISTS automation_id TEXT, -- Unique ID for this automation run
ADD COLUMN IF NOT EXISTS automation_name TEXT, -- Human-readable name (e.g., 'bat_import_viva', 'dropbox_bulk_import')
ADD COLUMN IF NOT EXISTS automation_version TEXT, -- Version of automation script
ADD COLUMN IF NOT EXISTS automation_run_id UUID REFERENCES automation_runs(id); -- Link to run record

-- Index for querying by automation
CREATE INDEX IF NOT EXISTS idx_vehicles_automation_run ON vehicles(automation_run_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_automation_name ON vehicles(automation_name);
```

#### B. Create Automation Runs Table
**File:** `supabase/migrations/[timestamp]_automation_tracking.sql`

```sql
-- Track automation executions
CREATE TABLE IF NOT EXISTS automation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_name TEXT NOT NULL, -- 'bat_import', 'dropbox_bulk_import', 'batch_image_processor'
  automation_version TEXT, -- Script version or git commit
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status TEXT DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  vehicles_created INTEGER DEFAULT 0,
  vehicles_updated INTEGER DEFAULT 0,
  errors_count INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}'::jsonb, -- Script-specific metadata
  triggered_by_user_id UUID REFERENCES auth.users(id), -- Who/what triggered it
  triggered_by_type TEXT, -- 'user', 'scheduled', 'webhook', 'manual'
  log_url TEXT, -- Link to logs if stored externally
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_runs_name ON automation_runs(automation_name);
CREATE INDEX IF NOT EXISTS idx_automation_runs_status ON automation_runs(status);
CREATE INDEX IF NOT EXISTS idx_automation_runs_started ON automation_runs(started_at DESC);
```

### 2. Update Origin Metadata Structure

Enhance `origin_metadata` JSONB to include automation details:

```json
{
  "automation": {
    "name": "bat_import_viva",
    "version": "1.2.0",
    "run_id": "uuid-here",
    "script_path": "scripts/import-viva-bat-listings.js",
    "triggered_by": "scheduled",
    "triggered_at": "2025-11-03T06:52:40Z"
  },
  "source": {
    "type": "bat_auction",
    "url": "https://bringatrailer.com/listing/...",
    "seller": "Viva Las Vegas Autos"
  },
  "import_date": "2025-11-03",
  "import_source": "bat_import"
}
```

### 3. Standardize Automation Entry Points

#### A. Create Automation Helper Function
**File:** `supabase/migrations/[timestamp]_automation_tracking.sql`

```sql
-- Helper function to start an automation run
CREATE OR REPLACE FUNCTION start_automation_run(
  p_automation_name TEXT,
  p_automation_version TEXT DEFAULT NULL,
  p_triggered_by_user_id UUID DEFAULT NULL,
  p_triggered_by_type TEXT DEFAULT 'manual',
  p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS UUID AS $$
DECLARE
  v_run_id UUID;
BEGIN
  INSERT INTO automation_runs (
    automation_name,
    automation_version,
    triggered_by_user_id,
    triggered_by_type,
    metadata,
    status
  ) VALUES (
    p_automation_name,
    p_automation_version,
    p_triggered_by_user_id,
    p_triggered_by_type,
    p_metadata,
    'running'
  ) RETURNING id INTO v_run_id;
  
  RETURN v_run_id;
END;
$$ LANGUAGE plpgsql;

-- Helper function to complete an automation run
CREATE OR REPLACE FUNCTION complete_automation_run(
  p_run_id UUID,
  p_status TEXT DEFAULT 'completed',
  p_vehicles_created INTEGER DEFAULT 0,
  p_vehicles_updated INTEGER DEFAULT 0,
  p_errors_count INTEGER DEFAULT 0,
  p_notes TEXT DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
  UPDATE automation_runs
  SET 
    completed_at = NOW(),
    status = p_status,
    vehicles_created = p_vehicles_created,
    vehicles_updated = p_vehicles_updated,
    errors_count = p_errors_count,
    notes = p_notes
  WHERE id = p_run_id;
END;
$$ LANGUAGE plpgsql;
```

#### B. Create JavaScript Helper Module
**File:** `nuke_frontend/src/services/automationTrackingService.ts`

```typescript
export interface AutomationRun {
  id: string;
  automation_name: string;
  automation_version?: string;
  started_at: string;
  completed_at?: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  vehicles_created: number;
  vehicles_updated: number;
  errors_count: number;
  metadata: Record<string, any>;
}

export class AutomationTrackingService {
  static async startRun(
    automationName: string,
    options?: {
      version?: string;
      userId?: string;
      triggeredBy?: 'user' | 'scheduled' | 'webhook' | 'manual';
      metadata?: Record<string, any>;
    }
  ): Promise<string> {
    const { data, error } = await supabase.rpc('start_automation_run', {
      p_automation_name: automationName,
      p_automation_version: options?.version || process.env.AUTOMATION_VERSION,
      p_triggered_by_user_id: options?.userId || null,
      p_triggered_by_type: options?.triggeredBy || 'manual',
      p_metadata: options?.metadata || {}
    });
    
    if (error) throw error;
    return data;
  }

  static async completeRun(
    runId: string,
    status: 'completed' | 'failed' | 'cancelled',
    stats?: {
      vehiclesCreated?: number;
      vehiclesUpdated?: number;
      errorsCount?: number;
      notes?: string;
    }
  ): Promise<void> {
    const { error } = await supabase.rpc('complete_automation_run', {
      p_run_id: runId,
      p_status: status,
      p_vehicles_created: stats?.vehiclesCreated || 0,
      p_vehicles_updated: stats?.vehiclesUpdated || 0,
      p_errors_count: stats?.errorsCount || 0,
      p_notes: stats?.notes || null
    });
    
    if (error) throw error;
  }

  static async createVehicleWithAutomation(
    vehicleData: any,
    automationRunId: string,
    automationName: string
  ): Promise<string> {
    // Set automation tracking in vehicle data
    const enrichedData = {
      ...vehicleData,
      automation_run_id: automationRunId,
      automation_name: automationName,
      profile_origin: this.inferOriginFromAutomation(automationName),
      origin_metadata: {
        ...(vehicleData.origin_metadata || {}),
        automation: {
          name: automationName,
          run_id: automationRunId,
          triggered_at: new Date().toISOString()
        }
      }
    };

    const { data, error } = await supabase
      .from('vehicles')
      .insert(enrichedData)
      .select('id')
      .single();

    if (error) throw error;
    return data.id;
  }

  private static inferOriginFromAutomation(name: string): string {
    if (name.includes('bat')) return 'bat_import';
    if (name.includes('dropbox')) return 'dropbox_import';
    if (name.includes('scraper') || name.includes('url')) return 'url_scraper';
    return 'automated_entry';
  }
}
```

### 4. Update Existing Automation Scripts

#### A. BAT Import Scripts
**Files to update:**
- `scripts/create-missing-bat-vehicles.js`
- `scripts/import-viva-bat-listings.js`
- `scripts/batch-import-viva-bat-sales.js`

**Pattern:**
```javascript
import { AutomationTrackingService } from '../nuke_frontend/src/services/automationTrackingService.js';

async function importBATListings() {
  const runId = await AutomationTrackingService.startRun('bat_import_viva', {
    version: '1.2.0',
    triggeredBy: 'manual',
    metadata: { source: 'viva_las_vegas_autos' }
  });

  let vehiclesCreated = 0;
  let errors = 0;

  try {
    for (const batUrl of batListings) {
      try {
        const vehicleId = await createVehicleFromBAT(vehicleData, batUrl, runId);
        vehiclesCreated++;
      } catch (error) {
        errors++;
        console.error(`Error importing ${batUrl}:`, error);
      }
    }

    await AutomationTrackingService.completeRun(runId, 'completed', {
      vehiclesCreated,
      errorsCount: errors
    });
  } catch (error) {
    await AutomationTrackingService.completeRun(runId, 'failed', {
      errorsCount: errors,
      notes: error.message
    });
    throw error;
  }
}

async function createVehicleFromBAT(vehicleData, batUrl, automationRunId) {
  const vehicleId = await AutomationTrackingService.createVehicleWithAutomation(
    {
      year: vehicleData.year,
      make: vehicleData.make,
      model: vehicleData.model,
      bat_auction_url: batUrl,
      discovery_url: batUrl,
      origin_metadata: {
        source: { type: 'bat_auction', url: batUrl }
      }
    },
    automationRunId,
    'bat_import_viva'
  );
  
  return vehicleId;
}
```

#### B. Dropbox Import Scripts
**Files to update:**
- `nuke_frontend/src/pages/DropboxAIProcess.tsx`
- `nuke_frontend/src/pages/DealerDropboxImport.tsx`
- `supabase/functions/dropbox-bulk-import/index.ts`

**Pattern:** Same as BAT imports, but with `automation_name: 'dropbox_bulk_import'`

#### C. Edge Functions
**Files to update:**
- `supabase/functions/dropbox-bulk-import/index.ts`
- Any other edge functions that create vehicles

### 5. Update Trigger to Handle Automation

**File:** `supabase/migrations/[timestamp]_automation_tracking.sql`

Update `set_default_vehicle_origin()` function to check for automation fields:

```sql
CREATE OR REPLACE FUNCTION set_default_vehicle_origin()
RETURNS TRIGGER AS $$
BEGIN
  -- If automation fields are set, use those
  IF NEW.automation_name IS NOT NULL THEN
    IF NEW.profile_origin IS NULL THEN
      NEW.profile_origin = CASE
        WHEN NEW.automation_name LIKE '%bat%' THEN 'bat_import'
        WHEN NEW.automation_name LIKE '%dropbox%' THEN 'dropbox_import'
        WHEN NEW.automation_name LIKE '%scraper%' OR NEW.automation_name LIKE '%url%' THEN 'url_scraper'
        ELSE 'automated_entry'
      END;
    END IF;
  END IF;

  -- Existing logic for non-automated vehicles...
  -- (keep existing trigger logic)
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### 6. Create View for Easy Querying

**File:** `supabase/migrations/[timestamp]_automation_tracking.sql`

```sql
-- View to easily query vehicle origins with automation details
CREATE OR REPLACE VIEW vehicle_origin_details AS
SELECT 
  v.id,
  v.year,
  v.make,
  v.model,
  v.vin,
  v.profile_origin,
  v.discovery_source,
  v.discovery_url,
  v.bat_auction_url,
  v.automation_name,
  v.automation_version,
  v.automation_run_id,
  v.uploaded_by,
  v.user_id,
  v.created_at,
  v.status,
  v.origin_metadata,
  
  -- Automation run details
  ar.started_at as automation_started_at,
  ar.completed_at as automation_completed_at,
  ar.status as automation_status,
  ar.triggered_by_type,
  
  -- User details
  p.username as uploaded_by_username,
  p.full_name as uploaded_by_name,
  
  -- Organization details
  b.business_name as origin_org_name
  
FROM vehicles v
LEFT JOIN automation_runs ar ON ar.id = v.automation_run_id
LEFT JOIN profiles p ON p.id = v.uploaded_by
LEFT JOIN businesses b ON b.id = v.origin_organization_id;
```

### 7. Backfill Existing Vehicles

**File:** `supabase/migrations/[timestamp]_backfill_automation_tracking.sql`

```sql
-- Try to infer automation for existing vehicles based on patterns

-- Step 1: Identify batch imports (vehicles created in quick succession with null user_id)
WITH batch_imports AS (
  SELECT 
    DATE_TRUNC('minute', created_at) as batch_minute,
    COUNT(*) as vehicle_count,
    MIN(created_at) as batch_start,
    MAX(created_at) as batch_end
  FROM vehicles
  WHERE uploaded_by IS NULL 
    AND user_id IS NULL
    AND origin_metadata = '{}'::jsonb
  GROUP BY DATE_TRUNC('minute', created_at)
  HAVING COUNT(*) >= 5  -- Batches of 5+ vehicles in same minute
)
UPDATE vehicles v
SET 
  automation_name = 'bulk_import_legacy',
  profile_origin = COALESCE(profile_origin, 'automated_entry'),
  origin_metadata = COALESCE(origin_metadata, '{}'::jsonb) || jsonb_build_object(
    'inferred_automation', true,
    'batch_import', true,
    'batch_size', bi.vehicle_count,
    'batch_window', jsonb_build_object(
      'start', bi.batch_start,
      'end', bi.batch_end
    ),
    'backfilled_at', NOW()
  )
FROM batch_imports bi
WHERE DATE_TRUNC('minute', v.created_at) = bi.batch_minute
  AND v.uploaded_by IS NULL
  AND v.user_id IS NULL
  AND v.origin_metadata = '{}'::jsonb;

-- Step 2: Infer from existing origin indicators
UPDATE vehicles
SET 
  automation_name = CASE
    WHEN bat_auction_url IS NOT NULL OR discovery_url ILIKE '%bringatrailer%' THEN 'bat_import_legacy'
    WHEN discovery_source ILIKE '%dropbox%' THEN 'dropbox_import_legacy'
    WHEN discovery_url IS NOT NULL THEN 'url_scraper_legacy'
    ELSE NULL
  END,
  profile_origin = COALESCE(
    profile_origin,
    CASE
      WHEN bat_auction_url IS NOT NULL THEN 'bat_import'
      WHEN discovery_source ILIKE '%dropbox%' THEN 'dropbox_import'
      WHEN discovery_url IS NOT NULL THEN 'url_scraper'
      ELSE 'manual_entry'
    END
  ),
  origin_metadata = COALESCE(
    origin_metadata,
    '{}'::jsonb
  ) || jsonb_build_object(
    'inferred_automation', true,
    'backfilled_at', NOW()
  )
WHERE automation_name IS NULL
  AND (bat_auction_url IS NOT NULL 
       OR discovery_source IS NOT NULL 
       OR discovery_url IS NOT NULL);
```

## Implementation Order

1. **Database Schema** - Create tables, functions, views
2. **Helper Service** - Create AutomationTrackingService
3. **Update Triggers** - Enhance origin inference
4. **Update Scripts** - Add tracking to all automation scripts
5. **Backfill** - Infer automation for existing vehicles
6. **Documentation** - Update README with automation tracking standards

## Verification

After implementation, verify with:
```sql
-- Check automation coverage
SELECT 
  automation_name,
  COUNT(*) as vehicle_count
FROM vehicles
WHERE automation_name IS NOT NULL
GROUP BY automation_name
ORDER BY vehicle_count DESC;

-- Check for vehicles still missing automation tracking
SELECT 
  COUNT(*) as missing_tracking,
  COUNT(*) FILTER (WHERE uploaded_by IS NULL AND user_id IS NULL) as missing_user_attribution
FROM vehicles
WHERE automation_name IS NULL
  AND profile_origin = 'manual_entry'
  AND origin_metadata = '{}'::jsonb;

-- Check batch imports detected
SELECT 
  DATE_TRUNC('minute', created_at) as batch_time,
  COUNT(*) as vehicle_count,
  automation_name
FROM vehicles
WHERE automation_name LIKE '%batch%' OR automation_name LIKE '%bulk%'
GROUP BY DATE_TRUNC('minute', created_at), automation_name
ORDER BY batch_time DESC
LIMIT 20;

-- Check recent automation runs
SELECT * FROM automation_runs
ORDER BY started_at DESC
LIMIT 10;

-- Query specific vehicle origin
SELECT * FROM vehicle_origin_details
WHERE id = '59743025-be7a-466f-abba-6bf0be29f33f';

-- Check the Nov 3 batch we discovered
SELECT 
  id,
  year,
  make,
  model,
  automation_name,
  profile_origin,
  origin_metadata->>'batch_size' as batch_size
FROM vehicles
WHERE created_at >= '2025-11-03T06:49:00'
  AND created_at <= '2025-11-03T06:55:00'
ORDER BY created_at;
```


-- 20251120000001_data_integrity_fixes.sql
-- Goal: Add 'IF NOT EXISTS' safety shims and enforce dual-deletion logic (Image -> Timeline Event)

BEGIN;

-- 1. Ensure core tables exist (Shim)
CREATE TABLE IF NOT EXISTS timeline_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_date TIMESTAMPTZ,
  description TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vehicle_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL,
    is_primary BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Dual Deletion Trigger: When an Image is deleted, remove its Timeline Event
CREATE OR REPLACE FUNCTION delete_timeline_event_on_image_delete()
RETURNS TRIGGER AS $$
BEGIN
    -- If the image had a linked timeline event (stored in metadata or deduced), delete it.
    -- Strategy: Look for timeline events where metadata->>'image_id' matches the deleted image ID.
    DELETE FROM timeline_events
    WHERE metadata->>'image_id' = OLD.id::text;
    
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_delete_image_timeline_event ON vehicle_images;

CREATE TRIGGER tr_delete_image_timeline_event
AFTER DELETE ON vehicle_images
FOR EACH ROW
EXECUTE FUNCTION delete_timeline_event_on_image_delete();

-- 3. Reverse Trigger: When a Timeline Event (type=image_upload) is deleted, remove the Image?
-- DEBATED: Actually, we usually want the Image to be the source of truth.
-- DECISION: If a user deletes the Timeline Event for a photo, it implies the photo is also unwanted.
CREATE OR REPLACE FUNCTION delete_image_on_timeline_event_delete()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.event_type = 'image_upload' AND (OLD.metadata->>'image_id') IS NOT NULL THEN
        DELETE FROM vehicle_images
        WHERE id = (OLD.metadata->>'image_id')::uuid;
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_delete_timeline_event_image ON timeline_events;

CREATE TRIGGER tr_delete_timeline_event_image
AFTER DELETE ON timeline_events
FOR EACH ROW
EXECUTE FUNCTION delete_image_on_timeline_event_delete();

COMMIT;


-- Migration: Create shipping tracking system for vehicle transportation
-- This enables tracking complex shipping processes like truck->boat->destination

CREATE TABLE IF NOT EXISTS shipping_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    task_type TEXT NOT NULL CHECK (task_type IN ('truck_transport', 'boat_container', 'customs_clearance', 'unloading', 'final_delivery', 'tracking_installation', 'documentation')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
    title TEXT NOT NULL,
    description TEXT,
    responsible_party TEXT, -- e.g., 'Tropical Shipping', 'FBM Garage', 'Customs Miami'
    estimated_cost DECIMAL(10,2),
    actual_cost DECIMAL(10,2),
    currency TEXT DEFAULT 'USD',
    start_date TIMESTAMPTZ,
    completion_date TIMESTAMPTZ,
    due_date TIMESTAMPTZ,
    priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
    notes TEXT,
    metadata JSONB DEFAULT '{}', -- For flexible additional data like tracking numbers, GPS coords, etc.
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_shipping_tasks_vehicle_id ON shipping_tasks(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_shipping_tasks_status ON shipping_tasks(status);
CREATE INDEX IF NOT EXISTS idx_shipping_tasks_task_type ON shipping_tasks(task_type);
CREATE INDEX IF NOT EXISTS idx_shipping_tasks_due_date ON shipping_tasks(due_date);

-- RLS Policies
ALTER TABLE shipping_tasks ENABLE ROW LEVEL SECURITY;

-- Vehicle owners can see all shipping tasks for their vehicles
CREATE POLICY "Vehicle owners can view shipping tasks" ON shipping_tasks
    FOR SELECT USING (
        vehicle_id IN (
            SELECT id FROM vehicles WHERE user_id = auth.uid()
        )
    );

-- Contributors can view shipping tasks for vehicles they contribute to
CREATE POLICY "Contributors can view shipping tasks" ON shipping_tasks
    FOR SELECT USING (
        vehicle_id IN (
            SELECT vehicle_id FROM vehicle_user_permissions WHERE user_id = auth.uid()
        )
    );

-- Only vehicle owners can modify shipping tasks
CREATE POLICY "Vehicle owners can manage shipping tasks" ON shipping_tasks
    FOR ALL USING (
        vehicle_id IN (
            SELECT id FROM vehicles WHERE user_id = auth.uid()
        )
    );

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_shipping_task_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_shipping_task_updated_at
    BEFORE UPDATE ON shipping_tasks
    FOR EACH ROW
    EXECUTE FUNCTION update_shipping_task_updated_at();

-- Function to create shipping timeline events
CREATE OR REPLACE FUNCTION create_shipping_timeline_event()
RETURNS TRIGGER AS $$
DECLARE
    event_data JSONB;
    event_title TEXT;
BEGIN
    -- Build event data
    event_data := jsonb_build_object(
        'task_id', NEW.id,
        'task_type', NEW.task_type,
        'status', NEW.status,
        'responsible_party', NEW.responsible_party,
        'estimated_cost', NEW.estimated_cost,
        'actual_cost', NEW.actual_cost,
        'metadata', NEW.metadata
    );

    -- Create descriptive title
    event_title := CASE
        WHEN NEW.task_type = 'truck_transport' THEN 'Truck Transport Scheduled'
        WHEN NEW.task_type = 'boat_container' THEN 'Boat Container Booking'
        WHEN NEW.task_type = 'customs_clearance' THEN 'Customs Clearance Process'
        WHEN NEW.task_type = 'unloading' THEN 'Vehicle Unloading'
        WHEN NEW.task_type = 'final_delivery' THEN 'Final Delivery to Owner'
        WHEN NEW.task_type = 'tracking_installation' THEN 'GPS Tracking Device Installation'
        ELSE 'Shipping Task: ' || NEW.title
    END;

    -- Insert timeline event
    INSERT INTO timeline_events (
        vehicle_id,
        event_type,
        event_category,
        title,
        description,
        event_data,
        created_by,
        confidence_score
    ) VALUES (
        NEW.vehicle_id,
        'shipping',
        'transportation',
        event_title,
        COALESCE(NEW.description, NEW.title),
        event_data,
        NEW.created_by,
        100
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_create_shipping_timeline_event
    AFTER INSERT OR UPDATE ON shipping_tasks
    FOR EACH ROW
    EXECUTE FUNCTION create_shipping_timeline_event();

-- Comments
COMMENT ON TABLE shipping_tasks IS 'Tracks complex shipping processes for vehicle transportation including costs, responsible parties, and timeline';
COMMENT ON COLUMN shipping_tasks.metadata IS 'Flexible JSON storage for additional data like tracking numbers, GPS coordinates, contact info, etc.';

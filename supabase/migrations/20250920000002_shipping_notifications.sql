-- Migration: Add notification system to shipping_tasks
-- This enables tracking notifications for buyers/clients

-- Add notification fields to shipping_tasks
ALTER TABLE shipping_tasks 
ADD COLUMN IF NOT EXISTS notification_recipients JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS last_notification_sent TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS notification_history JSONB DEFAULT '[]';

-- Create notification_subscriptions table for managing who gets notified
CREATE TABLE IF NOT EXISTS shipping_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shipping_task_id UUID NOT NULL REFERENCES shipping_tasks(id) ON DELETE CASCADE,
    recipient_name TEXT NOT NULL,
    recipient_phone TEXT,
    recipient_email TEXT,
    notification_method TEXT CHECK (notification_method IN ('sms', 'email', 'both')) DEFAULT 'sms',
    is_active BOOLEAN DEFAULT true,
    is_buyer BOOLEAN DEFAULT false, -- Flag for the actual buyer
    last_notified TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id)
);

-- Create notification_logs table for tracking what was sent
CREATE TABLE IF NOT EXISTS shipping_notification_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shipping_task_id UUID NOT NULL REFERENCES shipping_tasks(id) ON DELETE CASCADE,
    recipient_id UUID REFERENCES shipping_notifications(id),
    notification_type TEXT NOT NULL, -- 'status_change', 'manual_update', 'milestone_complete'
    message TEXT NOT NULL,
    status TEXT CHECK (status IN ('sent', 'failed', 'pending')) DEFAULT 'pending',
    error_message TEXT,
    metadata JSONB DEFAULT '{}',
    sent_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_shipping_notifications_task_id ON shipping_notifications(shipping_task_id);
CREATE INDEX IF NOT EXISTS idx_shipping_notifications_active ON shipping_notifications(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_notification_logs_task_id ON shipping_notification_logs(shipping_task_id);
CREATE INDEX IF NOT EXISTS idx_notification_logs_sent_at ON shipping_notification_logs(sent_at);

-- RLS Policies
ALTER TABLE shipping_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipping_notification_logs ENABLE ROW LEVEL SECURITY;

-- Notification subscriptions policies
DROP POLICY IF EXISTS "Task owners can manage notifications" ON shipping_notifications;
CREATE POLICY "Task owners can manage notifications" ON shipping_notifications
    FOR ALL USING (
        shipping_task_id IN (
            SELECT id FROM shipping_tasks WHERE vehicle_id IN (
                SELECT id FROM vehicles WHERE user_id = auth.uid()
            )
        )
    );

DROP POLICY IF EXISTS "Recipients can view their own notifications" ON shipping_notifications;
CREATE POLICY "Recipients can view their own notifications" ON shipping_notifications
    FOR SELECT USING (
        recipient_email = (SELECT email FROM auth.users WHERE id = auth.uid())
    );

-- Notification logs policies
DROP POLICY IF EXISTS "Task owners can view logs" ON shipping_notification_logs;
CREATE POLICY "Task owners can view logs" ON shipping_notification_logs
    FOR SELECT USING (
        shipping_task_id IN (
            SELECT id FROM shipping_tasks WHERE vehicle_id IN (
                SELECT id FROM vehicles WHERE user_id = auth.uid()
            )
        )
    );

-- Function to send notification when status changes
DROP TRIGGER IF EXISTS trigger_notify_shipping_status ON shipping_tasks;

DROP FUNCTION IF EXISTS notify_shipping_status_change();

CREATE OR REPLACE FUNCTION notify_shipping_status_change()
RETURNS TRIGGER AS $$
DECLARE
    notification_record RECORD;
BEGIN
    -- Only proceed if status actually changed
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        -- Get all active notification recipients
        FOR notification_record IN
            SELECT * FROM shipping_notifications
            WHERE shipping_task_id = NEW.id
            AND is_active = true
        LOOP
            -- Insert notification log (actual sending will be handled by API)
            INSERT INTO shipping_notification_logs (
                shipping_task_id,
                recipient_id,
                notification_type,
                message,
                status,
                metadata
            ) VALUES (
                NEW.id,
                notification_record.id,
                'status_change',
                format('Shipping status updated to: %s for %s', NEW.status, NEW.title),
                'pending',
                jsonb_build_object(
                    'old_status', OLD.status,
                    'new_status', NEW.status,
                    'responsible_party', NEW.responsible_party
                )
            );
        END LOOP;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_notify_shipping_status
    AFTER UPDATE ON shipping_tasks
    FOR EACH ROW
    EXECUTE FUNCTION notify_shipping_status_change();

-- Comments
COMMENT ON TABLE shipping_notifications IS 'Manages notification recipients for shipping milestones';
COMMENT ON TABLE shipping_notification_logs IS 'Tracks all notifications sent for shipping updates';
COMMENT ON COLUMN shipping_notifications.is_buyer IS 'Identifies the actual vehicle buyer for priority notifications';

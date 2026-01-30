-- Fix SMS tables with correct FKs

-- Create sms_work_submissions
CREATE TABLE IF NOT EXISTS sms_work_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_phone_link_id UUID REFERENCES technician_phone_links(id) NOT NULL,
  from_phone TEXT NOT NULL,
  message_sid TEXT UNIQUE,
  message_body TEXT,
  media_urls TEXT[] DEFAULT ARRAY[]::TEXT[],
  received_at TIMESTAMPTZ DEFAULT NOW(),
  ai_processed_at TIMESTAMPTZ,
  ai_interpretation JSONB,
  confidence_score NUMERIC(3,2),
  detected_vehicle_id UUID REFERENCES vehicles(id),
  detected_vehicle_hints JSONB,
  detected_work_type TEXT,
  detected_description TEXT,
  timeline_event_id UUID REFERENCES vehicle_timeline(id),
  observation_id UUID REFERENCES vehicle_observations(id),
  payout_amount NUMERIC(10,2),
  payout_status TEXT DEFAULT 'pending'
    CHECK (payout_status IN ('pending', 'approved', 'paid', 'disputed')),
  processing_status TEXT DEFAULT 'received'
    CHECK (processing_status IN ('received', 'processing', 'needs_context', 'processed', 'logged', 'failed')),
  follow_up_question TEXT,
  follow_up_response TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sms_submissions_tech ON sms_work_submissions(technician_phone_link_id);
CREATE INDEX IF NOT EXISTS idx_sms_submissions_status ON sms_work_submissions(processing_status);
CREATE INDEX IF NOT EXISTS idx_sms_submissions_vehicle ON sms_work_submissions(detected_vehicle_id);
CREATE INDEX IF NOT EXISTS idx_sms_submissions_received ON sms_work_submissions(received_at);
CREATE INDEX IF NOT EXISTS idx_sms_submissions_payout ON sms_work_submissions(payout_status) WHERE payout_status = 'pending';

COMMENT ON TABLE sms_work_submissions IS 'Individual SMS/MMS submissions from technicians';

-- Create sms_reminders
CREATE TABLE IF NOT EXISTS sms_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_phone_link_id UUID REFERENCES technician_phone_links(id) NOT NULL,
  reminder_type TEXT NOT NULL,
  message_template TEXT,
  message_params JSONB DEFAULT '{}'::JSONB,
  vehicle_id UUID REFERENCES vehicles(id),
  scheduled_for TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  response_received BOOLEAN DEFAULT FALSE,
  response_submission_id UUID REFERENCES sms_work_submissions(id),
  status TEXT DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'sent', 'delivered', 'failed', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sms_reminders_tech ON sms_reminders(technician_phone_link_id);
CREATE INDEX IF NOT EXISTS idx_sms_reminders_scheduled ON sms_reminders(scheduled_for) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_sms_reminders_pending ON sms_reminders(status) WHERE status = 'scheduled';

COMMENT ON TABLE sms_reminders IS 'Scheduled SMS reminders to technicians';

-- Create leaderboard view
DROP VIEW IF EXISTS technician_leaderboard;
CREATE VIEW technician_leaderboard AS
SELECT
  tpl.id,
  tpl.display_name,
  COALESCE(p.full_name, tpl.display_name, 'Anonymous Tech') as name,
  tpl.photos_submitted,
  tpl.work_sessions_logged,
  tpl.total_earned,
  tpl.primary_shop_id,
  b.business_name as shop_name,
  tpl.specialties,
  tpl.last_submission_at,
  CASE
    WHEN tpl.last_submission_at > NOW() - INTERVAL '1 day' THEN 'hot'
    WHEN tpl.last_submission_at > NOW() - INTERVAL '7 days' THEN 'active'
    WHEN tpl.last_submission_at > NOW() - INTERVAL '30 days' THEN 'cooling'
    ELSE 'dormant'
  END as activity_status,
  (
    SELECT COUNT(DISTINCT DATE(received_at))
    FROM sms_work_submissions sws
    WHERE sws.technician_phone_link_id = tpl.id
    AND sws.received_at > NOW() - INTERVAL '30 days'
  ) as days_active_last_30
FROM technician_phone_links tpl
LEFT JOIN profiles p ON p.id = tpl.user_id
LEFT JOIN businesses b ON b.id = tpl.primary_shop_id
WHERE tpl.onboarding_status IN ('verified', 'active')
ORDER BY tpl.photos_submitted DESC;

COMMENT ON VIEW technician_leaderboard IS 'Ranked technicians by activity for gamification';

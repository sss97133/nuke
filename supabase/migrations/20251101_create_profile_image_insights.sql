-- AI-generated insights for grouped vehicle image analysis
CREATE TABLE IF NOT EXISTS public.profile_image_insights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id TEXT UNIQUE NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE SET NULL,
    vehicle_name TEXT,
    summary_date DATE NOT NULL,
    summary TEXT,
    condition_score NUMERIC,
    condition_label TEXT,
    estimated_value_usd NUMERIC,
    labor_hours NUMERIC,
    confidence NUMERIC,
    key_findings JSONB DEFAULT '[]'::JSONB,
    recommendations JSONB DEFAULT '[]'::JSONB,
    image_ids UUID[] DEFAULT '{}'::UUID[],
    raw_response JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profile_image_insights_user_date
    ON public.profile_image_insights (user_id, summary_date DESC);

CREATE INDEX IF NOT EXISTS idx_profile_image_insights_vehicle
    ON public.profile_image_insights (vehicle_id, summary_date DESC);

ALTER TABLE public.profile_image_insights ENABLE ROW LEVEL SECURITY;

-- Users can view their own AI insights
CREATE POLICY "Users view own image insights"
    ON public.profile_image_insights
    FOR SELECT
    USING (auth.uid() = user_id);

-- Service role inserts/updates via edge function
CREATE POLICY "Service role upserts image insights"
    ON public.profile_image_insights
    FOR INSERT
    WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role updates image insights"
    ON public.profile_image_insights
    FOR UPDATE
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- Keep updated_at current
CREATE OR REPLACE FUNCTION public.touch_profile_image_insights()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_touch_profile_image_insights ON public.profile_image_insights;
CREATE TRIGGER trg_touch_profile_image_insights
    BEFORE UPDATE ON public.profile_image_insights
    FOR EACH ROW
    EXECUTE FUNCTION public.touch_profile_image_insights();


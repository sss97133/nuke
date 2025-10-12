-- Create user_interactions table for tracking user engagement and interest learning
CREATE TABLE IF NOT EXISTS public.user_interactions (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    post_id text NOT NULL,
    action_type text NOT NULL CHECK (action_type IN ('view', 'like', 'comment', 'share', 'click')),
    timestamp timestamp with time zone DEFAULT now() NOT NULL,
    metadata jsonb DEFAULT '{}',
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_interactions_user_id ON public.user_interactions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_interactions_post_id ON public.user_interactions(post_id);
CREATE INDEX IF NOT EXISTS idx_user_interactions_action_type ON public.user_interactions(action_type);
CREATE INDEX IF NOT EXISTS idx_user_interactions_timestamp ON public.user_interactions(timestamp);

-- Create composite index for user interest analysis
CREATE INDEX IF NOT EXISTS idx_user_interactions_user_action_time ON public.user_interactions(user_id, action_type, timestamp);

-- Enable RLS
ALTER TABLE public.user_interactions ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can insert their own interactions"
ON public.user_interactions
AS PERMISSIVE
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own interactions"
ON public.user_interactions
AS PERMISSIVE
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Create function to analyze user interests based on interactions
CREATE OR REPLACE FUNCTION analyze_user_interests(target_user_id uuid)
RETURNS TABLE (
    interest_category text,
    interaction_count bigint,
    engagement_score numeric,
    last_interaction timestamp with time zone
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        CASE 
            WHEN ui.post_id LIKE 'discovery_%' THEN 'vehicle_discovery'
            WHEN ui.post_id LIKE 'forsale_%' THEN 'for_sale'
            WHEN ui.post_id LIKE 'text_%' THEN 'text_updates'
            WHEN ui.post_id LIKE 'maintenance_%' THEN 'maintenance'
            ELSE 'other'
        END as interest_category,
        COUNT(*) as interaction_count,
        -- Weight different actions differently for engagement score
        SUM(
            CASE ui.action_type
                WHEN 'view' THEN 1
                WHEN 'like' THEN 3
                WHEN 'comment' THEN 5
                WHEN 'share' THEN 4
                WHEN 'click' THEN 2
                ELSE 1
            END
        )::numeric as engagement_score,
        MAX(ui.timestamp) as last_interaction
    FROM public.user_interactions ui
    WHERE ui.user_id = target_user_id
        AND ui.timestamp > (now() - interval '30 days') -- Only consider last 30 days
    GROUP BY 
        CASE 
            WHEN ui.post_id LIKE 'discovery_%' THEN 'vehicle_discovery'
            WHEN ui.post_id LIKE 'forsale_%' THEN 'for_sale'
            WHEN ui.post_id LIKE 'text_%' THEN 'text_updates'
            WHEN ui.post_id LIKE 'maintenance_%' THEN 'maintenance'
            ELSE 'other'
        END
    ORDER BY engagement_score DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to get personalized feed recommendations
CREATE OR REPLACE FUNCTION get_feed_recommendations(target_user_id uuid, limit_count integer DEFAULT 20)
RETURNS TABLE (
    post_type text,
    recommendation_score numeric,
    reason text
) AS $$
DECLARE
    user_interests RECORD;
BEGIN
    -- Get user's top interests
    FOR user_interests IN 
        SELECT * FROM analyze_user_interests(target_user_id) 
        ORDER BY engagement_score DESC 
        LIMIT 3
    LOOP
        RETURN QUERY
        SELECT 
            user_interests.interest_category as post_type,
            user_interests.engagement_score as recommendation_score,
            format('Based on %s interactions with %s content', 
                   user_interests.interaction_count, 
                   user_interests.interest_category) as reason;
    END LOOP;
    
    -- If no interactions, return default recommendations
    IF NOT FOUND THEN
        RETURN QUERY
        SELECT 
            'vehicle_discovery'::text as post_type,
            1.0::numeric as recommendation_score,
            'Default recommendation for new users'::text as reason
        UNION ALL
        SELECT 
            'for_sale'::text as post_type,
            0.8::numeric as recommendation_score,
            'Popular content type'::text as reason;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create view for user engagement analytics
CREATE OR REPLACE VIEW user_engagement_summary AS
SELECT 
    ui.user_id,
    COUNT(*) as total_interactions,
    COUNT(DISTINCT ui.post_id) as unique_posts_interacted,
    COUNT(DISTINCT DATE(ui.timestamp)) as active_days,
    AVG(
        CASE ui.action_type
            WHEN 'view' THEN 1
            WHEN 'like' THEN 3
            WHEN 'comment' THEN 5
            WHEN 'share' THEN 4
            WHEN 'click' THEN 2
            ELSE 1
        END
    ) as avg_engagement_score,
    MAX(ui.timestamp) as last_activity,
    MIN(ui.timestamp) as first_activity
FROM public.user_interactions ui
WHERE ui.timestamp > (now() - interval '30 days')
GROUP BY ui.user_id;

-- Grant permissions
GRANT SELECT ON user_engagement_summary TO authenticated;
GRANT EXECUTE ON FUNCTION analyze_user_interests(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_feed_recommendations(uuid, integer) TO authenticated;

-- Add comments for documentation
COMMENT ON TABLE public.user_interactions IS 'Tracks user interactions with feed posts for interest learning and personalization';
COMMENT ON FUNCTION analyze_user_interests(uuid) IS 'Analyzes user interests based on interaction patterns over the last 30 days';
COMMENT ON FUNCTION get_feed_recommendations(uuid, integer) IS 'Generates personalized feed recommendations based on user interaction history';
COMMENT ON VIEW user_engagement_summary IS 'Provides summary statistics of user engagement for analytics';

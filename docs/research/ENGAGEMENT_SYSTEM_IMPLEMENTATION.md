# Engagement System Implementation Specification

This document provides concrete implementation details for Nuke's engagement and recommendation system.

---

## 1. Database Schema

### 1.1 Core Tracking Tables

```sql
-- ============================================
-- CONTENT IMPRESSIONS: Track every view in feed
-- ============================================
CREATE TABLE content_impressions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL CHECK (content_type IN (
    'vehicle', 'service_post', 'timeline_event', 'live_stream', 'shop', 'organization'
  )),
  content_id UUID NOT NULL,
  
  -- Source tracking
  impression_source TEXT CHECK (impression_source IN (
    'feed', 'search', 'profile', 'share', 'notification', 'direct'
  )) DEFAULT 'feed',
  position_in_feed INTEGER, -- 1-indexed position when shown
  session_id UUID,
  
  -- Timing signals (critical for algorithm)
  impression_at TIMESTAMPTZ DEFAULT NOW(),
  first_visible_at TIMESTAMPTZ,
  last_visible_at TIMESTAMPTZ,
  dwell_time_ms INTEGER DEFAULT 0,
  scroll_depth_percent INTEGER, -- How far they scrolled on content
  
  -- Engagement outcomes
  clicked BOOLEAN DEFAULT FALSE,
  liked BOOLEAN DEFAULT FALSE,
  saved BOOLEAN DEFAULT FALSE,
  shared BOOLEAN DEFAULT FALSE,
  commented BOOLEAN DEFAULT FALSE,
  inquired BOOLEAN DEFAULT FALSE, -- Sent message/inquiry
  booked BOOLEAN DEFAULT FALSE,   -- Made appointment/booking
  
  -- Context
  device_type TEXT CHECK (device_type IN ('mobile', 'tablet', 'desktop')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for analytics queries
CREATE INDEX idx_impressions_user_time ON content_impressions(user_id, impression_at DESC);
CREATE INDEX idx_impressions_content ON content_impressions(content_type, content_id);
CREATE INDEX idx_impressions_session ON content_impressions(session_id);
CREATE INDEX idx_impressions_source ON content_impressions(impression_source, impression_at DESC);

-- ============================================
-- USER INTEREST VECTORS: Learned preferences
-- ============================================
CREATE TABLE user_interest_vectors (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  
  -- Service type interests (0.0 to 1.0, 0.5 = neutral)
  interest_restoration FLOAT DEFAULT 0.5,
  interest_maintenance FLOAT DEFAULT 0.5,
  interest_performance FLOAT DEFAULT 0.5,
  interest_cosmetic FLOAT DEFAULT 0.5, -- Paint, body, detail
  interest_buying FLOAT DEFAULT 0.5,
  interest_selling FLOAT DEFAULT 0.5,
  interest_builds FLOAT DEFAULT 0.5,   -- DIY project content
  interest_events FLOAT DEFAULT 0.5,
  
  -- Vehicle preferences (learned from behavior)
  preferred_makes JSONB DEFAULT '[]'::JSONB,  -- [{"make": "Porsche", "score": 0.9}, ...]
  preferred_eras JSONB DEFAULT '[]'::JSONB,   -- [{"era": "classic", "score": 0.8}, ...]
  preferred_styles JSONB DEFAULT '[]'::JSONB, -- [{"style": "sports", "score": 0.7}, ...]
  
  -- Price sensitivity
  price_range_interest JSONB DEFAULT '{"low": 0, "high": null}'::JSONB,
  budget_tier TEXT CHECK (budget_tier IN ('budget', 'mid', 'premium', 'ultra')),
  
  -- Geographic preferences
  home_location GEOGRAPHY(POINT, 4326),
  search_radius_miles INTEGER DEFAULT 50,
  willing_to_travel BOOLEAN DEFAULT TRUE,
  
  -- Behavioral patterns
  preferred_content_formats JSONB DEFAULT '[]'::JSONB, -- ['video', 'gallery', 'text']
  avg_session_duration_seconds INTEGER DEFAULT 0,
  avg_items_per_session INTEGER DEFAULT 0,
  active_hours JSONB DEFAULT '[]'::JSONB, -- [9, 10, 19, 20, 21] = morning & evening
  
  -- Learning metadata
  total_impressions INTEGER DEFAULT 0,
  total_engagements INTEGER DEFAULT 0,
  model_version INTEGER DEFAULT 1,
  last_computed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- CONTENT PERFORMANCE: Aggregated metrics
-- ============================================
CREATE TABLE content_performance (
  content_type TEXT NOT NULL,
  content_id UUID NOT NULL,
  
  -- Impression metrics
  total_impressions INTEGER DEFAULT 0,
  unique_viewers INTEGER DEFAULT 0,
  
  -- Engagement counts
  total_clicks INTEGER DEFAULT 0,
  total_likes INTEGER DEFAULT 0,
  total_saves INTEGER DEFAULT 0,
  total_shares INTEGER DEFAULT 0,
  total_comments INTEGER DEFAULT 0,
  total_inquiries INTEGER DEFAULT 0,
  total_bookings INTEGER DEFAULT 0,
  
  -- Computed rates (updated periodically)
  click_rate FLOAT DEFAULT 0,
  like_rate FLOAT DEFAULT 0,
  save_rate FLOAT DEFAULT 0,
  share_rate FLOAT DEFAULT 0,
  inquiry_rate FLOAT DEFAULT 0,
  
  -- Quality signals
  avg_dwell_time_ms INTEGER DEFAULT 0,
  completion_rate FLOAT DEFAULT 0, -- For video/multi-image
  bounce_rate FLOAT DEFAULT 0,     -- Immediate scrolls past
  
  -- Distribution tracking
  distribution_tier INTEGER DEFAULT 1, -- 1=initial, 2=expanded, 3=trending
  tier_updated_at TIMESTAMPTZ,
  
  -- Decay tracking
  engagement_velocity FLOAT DEFAULT 0, -- Engagements per hour (recent)
  is_trending BOOLEAN DEFAULT FALSE,
  trend_score FLOAT DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  PRIMARY KEY (content_type, content_id)
);

-- Index for ranking queries
CREATE INDEX idx_performance_trending ON content_performance(is_trending, trend_score DESC);
CREATE INDEX idx_performance_engagement ON content_performance(click_rate DESC, created_at DESC);

-- ============================================
-- CREATOR PERFORMANCE: Shop/user level metrics
-- ============================================
CREATE TABLE creator_performance (
  creator_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  creator_type TEXT CHECK (creator_type IN ('shop', 'individual', 'brand')),
  
  -- Content metrics
  total_posts INTEGER DEFAULT 0,
  avg_post_engagement_rate FLOAT DEFAULT 0,
  best_performing_post_id UUID,
  
  -- Audience metrics
  total_followers INTEGER DEFAULT 0,
  follower_growth_rate FLOAT DEFAULT 0, -- Weekly change
  unique_viewers_30d INTEGER DEFAULT 0,
  
  -- Business metrics
  total_inquiries_received INTEGER DEFAULT 0,
  inquiry_response_rate FLOAT DEFAULT 0,
  avg_response_time_hours FLOAT DEFAULT 0,
  total_bookings INTEGER DEFAULT 0,
  booking_conversion_rate FLOAT DEFAULT 0,
  
  -- Quality signals
  content_quality_score FLOAT DEFAULT 0.5, -- AI-assessed
  reliability_score FLOAT DEFAULT 0.5,
  review_avg_rating FLOAT DEFAULT 0,
  review_count INTEGER DEFAULT 0,
  
  -- Activity
  last_post_at TIMESTAMPTZ,
  posting_frequency_weekly FLOAT DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- FEED SESSIONS: Track browsing patterns
-- ============================================
CREATE TABLE feed_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  
  -- Engagement summary
  items_viewed INTEGER DEFAULT 0,
  items_engaged INTEGER DEFAULT 0,
  items_saved INTEGER DEFAULT 0,
  inquiries_sent INTEGER DEFAULT 0,
  
  -- Session context
  device_type TEXT,
  feed_type TEXT, -- 'main', 'following', 'search', 'category'
  initial_filters JSONB DEFAULT '{}'::JSONB,
  
  -- Quality signals
  avg_dwell_per_item_ms INTEGER DEFAULT 0,
  scroll_velocity_avg FLOAT DEFAULT 0 -- Fast scroll = low engagement
);

CREATE INDEX idx_sessions_user ON feed_sessions(user_id, started_at DESC);
```

### 1.2 Algorithm Support Functions

```sql
-- ============================================
-- Update content performance (called by trigger)
-- ============================================
CREATE OR REPLACE FUNCTION update_content_performance()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO content_performance (content_type, content_id, total_impressions)
  VALUES (NEW.content_type, NEW.content_id, 1)
  ON CONFLICT (content_type, content_id) DO UPDATE SET
    total_impressions = content_performance.total_impressions + 1,
    unique_viewers = (
      SELECT COUNT(DISTINCT user_id) 
      FROM content_impressions 
      WHERE content_type = NEW.content_type AND content_id = NEW.content_id
    ),
    total_clicks = content_performance.total_clicks + (CASE WHEN NEW.clicked THEN 1 ELSE 0 END),
    total_likes = content_performance.total_likes + (CASE WHEN NEW.liked THEN 1 ELSE 0 END),
    total_saves = content_performance.total_saves + (CASE WHEN NEW.saved THEN 1 ELSE 0 END),
    total_inquiries = content_performance.total_inquiries + (CASE WHEN NEW.inquired THEN 1 ELSE 0 END),
    avg_dwell_time_ms = (
      SELECT AVG(dwell_time_ms)::INTEGER 
      FROM content_impressions 
      WHERE content_type = NEW.content_type 
        AND content_id = NEW.content_id 
        AND dwell_time_ms > 0
    ),
    updated_at = NOW();
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_performance
AFTER INSERT OR UPDATE ON content_impressions
FOR EACH ROW EXECUTE FUNCTION update_content_performance();

-- ============================================
-- Compute engagement rates (run periodically)
-- ============================================
CREATE OR REPLACE FUNCTION compute_engagement_rates()
RETURNS void AS $$
BEGIN
  UPDATE content_performance
  SET 
    click_rate = CASE WHEN total_impressions > 0 
      THEN total_clicks::FLOAT / total_impressions ELSE 0 END,
    like_rate = CASE WHEN total_impressions > 0 
      THEN total_likes::FLOAT / total_impressions ELSE 0 END,
    save_rate = CASE WHEN total_impressions > 0 
      THEN total_saves::FLOAT / total_impressions ELSE 0 END,
    share_rate = CASE WHEN total_impressions > 0 
      THEN total_shares::FLOAT / total_impressions ELSE 0 END,
    inquiry_rate = CASE WHEN total_impressions > 0 
      THEN total_inquiries::FLOAT / total_impressions ELSE 0 END,
    bounce_rate = (
      SELECT COUNT(*)::FLOAT / NULLIF(total_impressions, 0)
      FROM content_impressions ci
      WHERE ci.content_type = content_performance.content_type
        AND ci.content_id = content_performance.content_id
        AND ci.dwell_time_ms < 1000 -- Less than 1 second
        AND ci.clicked = FALSE
    ),
    updated_at = NOW()
  WHERE updated_at < NOW() - INTERVAL '5 minutes';
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Update trending status
-- ============================================
CREATE OR REPLACE FUNCTION update_trending_content()
RETURNS void AS $$
BEGIN
  -- Calculate engagement velocity (last hour vs. previous)
  WITH recent_engagement AS (
    SELECT 
      content_type,
      content_id,
      COUNT(*) FILTER (WHERE impression_at > NOW() - INTERVAL '1 hour') as last_hour,
      COUNT(*) FILTER (WHERE impression_at > NOW() - INTERVAL '2 hours' 
                        AND impression_at <= NOW() - INTERVAL '1 hour') as prev_hour
    FROM content_impressions
    WHERE impression_at > NOW() - INTERVAL '2 hours'
    GROUP BY content_type, content_id
  )
  UPDATE content_performance cp
  SET 
    engagement_velocity = COALESCE(re.last_hour, 0),
    is_trending = COALESCE(re.last_hour, 0) > COALESCE(re.prev_hour, 0) * 1.5 
                  AND COALESCE(re.last_hour, 0) > 10,
    trend_score = CASE 
      WHEN COALESCE(re.prev_hour, 0) > 0 
      THEN (COALESCE(re.last_hour, 0)::FLOAT / re.prev_hour) * LOG(COALESCE(re.last_hour, 1) + 1)
      ELSE LOG(COALESCE(re.last_hour, 1) + 1)
    END,
    updated_at = NOW()
  FROM recent_engagement re
  WHERE cp.content_type = re.content_type 
    AND cp.content_id = re.content_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Get ranked feed for user
-- ============================================
CREATE OR REPLACE FUNCTION get_ranked_feed(
  p_user_id UUID,
  p_limit INTEGER DEFAULT 20,
  p_offset INTEGER DEFAULT 0,
  p_content_types TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  content_type TEXT,
  content_id UUID,
  ranking_score FLOAT,
  reason TEXT
) AS $$
DECLARE
  v_interests user_interest_vectors;
BEGIN
  -- Get user interests (or use defaults)
  SELECT * INTO v_interests 
  FROM user_interest_vectors 
  WHERE user_id = p_user_id;
  
  RETURN QUERY
  WITH candidate_content AS (
    -- Get recent content with performance data
    SELECT 
      cp.content_type,
      cp.content_id,
      cp.click_rate,
      cp.like_rate,
      cp.save_rate,
      cp.inquiry_rate,
      cp.avg_dwell_time_ms,
      cp.is_trending,
      cp.trend_score,
      cp.created_at,
      cp.total_impressions
    FROM content_performance cp
    WHERE (p_content_types IS NULL OR cp.content_type = ANY(p_content_types))
      AND cp.created_at > NOW() - INTERVAL '30 days'
      -- Exclude content user has already seen
      AND NOT EXISTS (
        SELECT 1 FROM content_impressions ci 
        WHERE ci.user_id = p_user_id 
          AND ci.content_type = cp.content_type 
          AND ci.content_id = cp.content_id
          AND ci.clicked = TRUE  -- Only exclude if they actually clicked
      )
  ),
  scored_content AS (
    SELECT 
      cc.*,
      -- Engagement score (weighted combination of rates)
      (cc.click_rate * 0.3 + cc.like_rate * 0.2 + cc.save_rate * 0.3 + cc.inquiry_rate * 0.2) 
        as engagement_score,
      -- Freshness score (decay over 7 days)
      EXP(-EXTRACT(EPOCH FROM (NOW() - cc.created_at)) / (7 * 24 * 3600)) 
        as freshness_score,
      -- Trending boost
      CASE WHEN cc.is_trending THEN 1.5 ELSE 1.0 END 
        as trending_multiplier
    FROM candidate_content cc
  )
  SELECT 
    sc.content_type,
    sc.content_id,
    -- Final ranking score
    (sc.engagement_score * 0.4 + sc.freshness_score * 0.3 + 0.3) 
      * sc.trending_multiplier as ranking_score,
    CASE 
      WHEN sc.is_trending THEN 'trending'
      WHEN sc.freshness_score > 0.8 THEN 'new'
      WHEN sc.engagement_score > 0.1 THEN 'popular'
      ELSE 'discover'
    END as reason
  FROM scored_content sc
  ORDER BY ranking_score DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql;
```

---

## 2. Frontend Implementation

### 2.1 Enhanced Tracking Hook

```typescript
// hooks/useEngagementTracking.ts

import { useCallback, useRef, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface TrackingContext {
  contentType: 'vehicle' | 'service_post' | 'timeline_event' | 'live_stream' | 'shop' | 'organization';
  contentId: string;
  source: 'feed' | 'search' | 'profile' | 'share' | 'notification' | 'direct';
  position?: number;
}

interface VisibilityState {
  firstVisible: number | null;
  lastVisible: number | null;
  totalDwellMs: number;
  isCurrentlyVisible: boolean;
}

export const useEngagementTracking = () => {
  const sessionId = useRef<string>(crypto.randomUUID());
  const visibilityMap = useRef<Map<string, VisibilityState>>(new Map());
  const pendingUpdates = useRef<Map<string, any>>(new Map());
  const flushTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Flush pending updates periodically
  const flushUpdates = useCallback(async () => {
    if (pendingUpdates.current.size === 0) return;
    
    const updates = Array.from(pendingUpdates.current.values());
    pendingUpdates.current.clear();
    
    try {
      await supabase.from('content_impressions').upsert(updates, {
        onConflict: 'id'
      });
    } catch (error) {
      console.error('Failed to flush engagement updates:', error);
    }
  }, []);

  // Schedule flush
  const scheduleFlush = useCallback(() => {
    if (flushTimeoutRef.current) {
      clearTimeout(flushTimeoutRef.current);
    }
    flushTimeoutRef.current = setTimeout(flushUpdates, 2000);
  }, [flushUpdates]);

  // Track when content becomes visible
  const trackImpression = useCallback(async (context: TrackingContext) => {
    const key = `${context.contentType}-${context.contentId}`;
    const now = Date.now();
    
    // Initialize or update visibility state
    const existing = visibilityMap.current.get(key);
    if (!existing) {
      visibilityMap.current.set(key, {
        firstVisible: now,
        lastVisible: now,
        totalDwellMs: 0,
        isCurrentlyVisible: true
      });
      
      // Create initial impression record
      const { data: { user } } = await supabase.auth.getUser();
      
      const impression = {
        id: crypto.randomUUID(),
        user_id: user?.id,
        content_type: context.contentType,
        content_id: context.contentId,
        impression_source: context.source,
        position_in_feed: context.position,
        session_id: sessionId.current,
        impression_at: new Date().toISOString(),
        first_visible_at: new Date().toISOString(),
        device_type: getDeviceType()
      };
      
      pendingUpdates.current.set(key, impression);
      scheduleFlush();
    }
  }, [scheduleFlush]);

  // Track visibility end (scrolled away)
  const trackVisibilityEnd = useCallback((context: TrackingContext) => {
    const key = `${context.contentType}-${context.contentId}`;
    const state = visibilityMap.current.get(key);
    
    if (state && state.isCurrentlyVisible) {
      const now = Date.now();
      const additionalDwell = now - (state.lastVisible || now);
      
      state.totalDwellMs += additionalDwell;
      state.lastVisible = now;
      state.isCurrentlyVisible = false;
      
      // Update the pending record
      const pending = pendingUpdates.current.get(key);
      if (pending) {
        pending.last_visible_at = new Date().toISOString();
        pending.dwell_time_ms = state.totalDwellMs;
        scheduleFlush();
      }
    }
  }, [scheduleFlush]);

  // Track engagement action
  const trackEngagement = useCallback(async (
    context: TrackingContext,
    action: 'clicked' | 'liked' | 'saved' | 'shared' | 'commented' | 'inquired' | 'booked'
  ) => {
    const key = `${context.contentType}-${context.contentId}`;
    const pending = pendingUpdates.current.get(key);
    
    if (pending) {
      pending[action] = true;
      
      // Update dwell time
      const state = visibilityMap.current.get(key);
      if (state) {
        pending.dwell_time_ms = state.totalDwellMs + 
          (state.isCurrentlyVisible ? Date.now() - (state.lastVisible || Date.now()) : 0);
      }
      
      // Immediate flush for engagement actions
      await flushUpdates();
    }
  }, [flushUpdates]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      flushUpdates();
      if (flushTimeoutRef.current) {
        clearTimeout(flushTimeoutRef.current);
      }
    };
  }, [flushUpdates]);

  return {
    trackImpression,
    trackVisibilityEnd,
    trackEngagement,
    sessionId: sessionId.current
  };
};

function getDeviceType(): 'mobile' | 'tablet' | 'desktop' {
  const width = window.innerWidth;
  if (width < 768) return 'mobile';
  if (width < 1024) return 'tablet';
  return 'desktop';
}
```

### 2.2 Visibility Observer Component

```typescript
// components/feed/FeedItemObserver.tsx

import { useEffect, useRef, ReactNode } from 'react';
import { useEngagementTracking } from '../../hooks/useEngagementTracking';

interface FeedItemObserverProps {
  contentType: 'vehicle' | 'service_post' | 'timeline_event' | 'live_stream' | 'shop' | 'organization';
  contentId: string;
  position: number;
  source: 'feed' | 'search' | 'profile' | 'share';
  children: ReactNode;
}

export const FeedItemObserver = ({
  contentType,
  contentId,
  position,
  source,
  children
}: FeedItemObserverProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { trackImpression, trackVisibilityEnd } = useEngagementTracking();
  const hasTrackedImpression = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const context = { contentType, contentId, source, position };
          
          if (entry.isIntersecting) {
            // Minimum 50% visible and in viewport for 500ms
            if (entry.intersectionRatio >= 0.5) {
              if (!hasTrackedImpression.current) {
                hasTrackedImpression.current = true;
                trackImpression(context);
              }
            }
          } else {
            if (hasTrackedImpression.current) {
              trackVisibilityEnd(context);
            }
          }
        });
      },
      {
        threshold: [0, 0.5, 1.0],
        rootMargin: '0px'
      }
    );

    observer.observe(container);

    return () => {
      observer.disconnect();
      if (hasTrackedImpression.current) {
        trackVisibilityEnd({ contentType, contentId, source, position });
      }
    };
  }, [contentType, contentId, position, source, trackImpression, trackVisibilityEnd]);

  return (
    <div ref={containerRef} data-content-id={contentId}>
      {children}
    </div>
  );
};
```

### 2.3 Ranked Feed Service

```typescript
// services/rankedFeedService.ts

import { supabase } from '../lib/supabase';

export interface RankedFeedItem {
  contentType: string;
  contentId: string;
  rankingScore: number;
  reason: 'trending' | 'new' | 'popular' | 'discover' | 'following';
  data: any;
}

export interface FeedOptions {
  limit?: number;
  offset?: number;
  contentTypes?: string[];
  includeFollowing?: boolean;
}

export class RankedFeedService {
  
  static async getFeed(options: FeedOptions = {}): Promise<RankedFeedItem[]> {
    const { limit = 20, offset = 0, contentTypes, includeFollowing = true } = options;
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      // Get ranked content IDs from database function
      const { data: rankedIds, error } = await supabase.rpc('get_ranked_feed', {
        p_user_id: user?.id || null,
        p_limit: limit,
        p_offset: offset,
        p_content_types: contentTypes || null
      });
      
      if (error) {
        console.error('Error fetching ranked feed:', error);
        return this.getFallbackFeed(limit, offset);
      }
      
      if (!rankedIds || rankedIds.length === 0) {
        return this.getFallbackFeed(limit, offset);
      }
      
      // Fetch full content for each ID
      const feedItems = await this.hydrateContent(rankedIds);
      
      // Inject following content if requested
      if (includeFollowing && user) {
        const followingContent = await this.getFollowingContent(user.id, 3);
        feedItems.splice(0, 0, ...followingContent); // Prepend
      }
      
      // Apply diversity rules
      return this.applyDiversity(feedItems);
      
    } catch (error) {
      console.error('Feed service error:', error);
      return this.getFallbackFeed(limit, offset);
    }
  }
  
  private static async hydrateContent(
    rankedIds: Array<{ content_type: string; content_id: string; ranking_score: number; reason: string }>
  ): Promise<RankedFeedItem[]> {
    // Group by content type for efficient queries
    const byType = rankedIds.reduce((acc, item) => {
      if (!acc[item.content_type]) acc[item.content_type] = [];
      acc[item.content_type].push(item.content_id);
      return acc;
    }, {} as Record<string, string[]>);
    
    const results: RankedFeedItem[] = [];
    
    // Fetch vehicles
    if (byType.vehicle?.length) {
      const { data: vehicles } = await supabase
        .from('vehicles')
        .select(`
          id, year, make, model, color, description, sale_price, is_for_sale, created_at,
          vehicle_images(image_url, is_primary)
        `)
        .in('id', byType.vehicle);
      
      vehicles?.forEach(v => {
        const ranked = rankedIds.find(r => r.content_id === v.id);
        if (ranked) {
          results.push({
            contentType: 'vehicle',
            contentId: v.id,
            rankingScore: ranked.ranking_score,
            reason: ranked.reason as any,
            data: v
          });
        }
      });
    }
    
    // Fetch timeline events (service posts)
    if (byType.timeline_event?.length) {
      const { data: events } = await supabase
        .from('vehicle_timeline_events')
        .select(`
          id, title, description, event_type, image_urls, created_at, vehicle_id,
          vehicles(year, make, model)
        `)
        .in('id', byType.timeline_event);
      
      events?.forEach(e => {
        const ranked = rankedIds.find(r => r.content_id === e.id);
        if (ranked) {
          results.push({
            contentType: 'timeline_event',
            contentId: e.id,
            rankingScore: ranked.ranking_score,
            reason: ranked.reason as any,
            data: e
          });
        }
      });
    }
    
    // Sort by ranking score
    results.sort((a, b) => b.rankingScore - a.rankingScore);
    
    return results;
  }
  
  private static async getFollowingContent(userId: string, limit: number): Promise<RankedFeedItem[]> {
    // Get creators the user follows
    const { data: following } = await supabase
      .from('user_follows')
      .select('followed_id')
      .eq('follower_id', userId);
    
    if (!following?.length) return [];
    
    const followedIds = following.map(f => f.followed_id);
    
    // Get recent content from followed creators
    const { data: content } = await supabase
      .from('vehicle_timeline_events')
      .select('id, title, description, event_type, image_urls, created_at, user_id')
      .in('user_id', followedIds)
      .order('created_at', { ascending: false })
      .limit(limit);
    
    return (content || []).map(c => ({
      contentType: 'timeline_event' as const,
      contentId: c.id,
      rankingScore: 1.0, // Following gets top priority
      reason: 'following' as const,
      data: c
    }));
  }
  
  private static applyDiversity(items: RankedFeedItem[]): RankedFeedItem[] {
    const result: RankedFeedItem[] = [];
    const creatorCounts = new Map<string, number>();
    const typeCounts = new Map<string, number>();
    
    for (const item of items) {
      const creatorId = item.data.user_id || item.data.uploaded_by || 'unknown';
      const creatorCount = creatorCounts.get(creatorId) || 0;
      const typeCount = typeCounts.get(item.contentType) || 0;
      
      // Skip if too many from same creator (except for first 20)
      if (creatorCount >= 2 && result.length < 20) continue;
      
      // Skip if too many of same type (except for first 20)
      if (typeCount >= 8 && result.length < 20) continue;
      
      result.push(item);
      creatorCounts.set(creatorId, creatorCount + 1);
      typeCounts.set(item.contentType, typeCount + 1);
    }
    
    return result;
  }
  
  private static async getFallbackFeed(limit: number, offset: number): Promise<RankedFeedItem[]> {
    // Simple chronological fallback
    const { data: vehicles } = await supabase
      .from('vehicles')
      .select(`
        id, year, make, model, color, description, sale_price, is_for_sale, created_at,
        vehicle_images(image_url, is_primary)
      `)
      .neq('status', 'pending')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    
    return (vehicles || []).map((v, i) => ({
      contentType: 'vehicle',
      contentId: v.id,
      rankingScore: 1.0 - (i * 0.01),
      reason: 'new' as const,
      data: v
    }));
  }
  
  // Real-time update subscription
  static subscribeToUpdates(callback: (item: RankedFeedItem) => void) {
    const subscription = supabase
      .channel('feed_updates')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'vehicle_timeline_events'
      }, (payload) => {
        callback({
          contentType: 'timeline_event',
          contentId: payload.new.id,
          rankingScore: 1.0,
          reason: 'new',
          data: payload.new
        });
      })
      .subscribe();
    
    return () => supabase.removeChannel(subscription);
  }
}
```

---

## 3. Algorithm Tuning

### 3.1 A/B Testing Framework

```typescript
// services/experimentService.ts

export interface Experiment {
  id: string;
  name: string;
  variants: ExperimentVariant[];
  trafficAllocation: number; // 0-100%
  startDate: Date;
  endDate: Date | null;
  metrics: string[];
}

export interface ExperimentVariant {
  id: string;
  name: string;
  weight: number;
  config: Record<string, any>;
}

export class ExperimentService {
  private static experiments: Map<string, Experiment> = new Map();
  
  static registerExperiment(experiment: Experiment) {
    this.experiments.set(experiment.id, experiment);
  }
  
  static getVariant(experimentId: string, userId: string): ExperimentVariant | null {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) return null;
    
    // Check if user is in experiment traffic allocation
    const hash = this.hashUserId(userId, experimentId);
    if (hash > experiment.trafficAllocation) return null;
    
    // Deterministic variant assignment
    const variantHash = this.hashUserId(userId, `${experimentId}-variant`);
    let cumulative = 0;
    for (const variant of experiment.variants) {
      cumulative += variant.weight;
      if (variantHash <= cumulative) {
        return variant;
      }
    }
    
    return experiment.variants[0];
  }
  
  private static hashUserId(userId: string, salt: string): number {
    // Simple hash for consistent bucketing (0-100)
    let hash = 0;
    const str = userId + salt;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash % 100);
  }
}

// Usage in feed ranking
ExperimentService.registerExperiment({
  id: 'feed_ranking_v2',
  name: 'New Feed Ranking Algorithm',
  variants: [
    { id: 'control', name: 'Chronological', weight: 50, config: { algorithm: 'chronological' } },
    { id: 'treatment', name: 'Engagement-based', weight: 50, config: { algorithm: 'engagement' } }
  ],
  trafficAllocation: 20, // 20% of users
  startDate: new Date(),
  endDate: null,
  metrics: ['session_duration', 'items_viewed', 'engagement_rate', 'return_rate']
});
```

### 3.2 Ranking Weight Tuning

```typescript
// config/rankingWeights.ts

export const RANKING_WEIGHTS = {
  // Engagement signals
  clickWeight: 0.30,
  likeWeight: 0.15,
  saveWeight: 0.25,
  shareWeight: 0.10,
  inquiryWeight: 0.20,
  
  // Content quality
  dwellTimeWeight: 0.15,
  completionRateWeight: 0.10,
  
  // Freshness decay (exponential)
  freshnessHalfLifeDays: 3,
  freshnessMinScore: 0.1,
  
  // Creator signals
  creatorReputationWeight: 0.10,
  creatorResponseRateWeight: 0.05,
  
  // Relevance signals
  categoryMatchWeight: 0.15,
  locationWeight: 0.10,
  priceMatchWeight: 0.05,
  
  // Trending boost
  trendingMultiplier: 1.5,
  
  // Cold start
  newContentMinImpressions: 100,
  newContentEngagementThreshold: 0.05, // 5% engagement to expand
  
  // Diversity constraints
  maxFromSameCreator: 3,
  maxFromSameCategory: 5,
  minCategoriesInFeed: 2
};

// Environment-specific overrides
export const getWeights = () => {
  const env = import.meta.env.MODE;
  if (env === 'development') {
    return {
      ...RANKING_WEIGHTS,
      // More aggressive testing in dev
      newContentMinImpressions: 10,
      freshnessHalfLifeDays: 1
    };
  }
  return RANKING_WEIGHTS;
};
```

---

## 4. Monitoring & Analytics

### 4.1 Engagement Metrics Dashboard Queries

```sql
-- Daily engagement summary
SELECT 
  DATE(impression_at) as date,
  COUNT(DISTINCT user_id) as unique_users,
  COUNT(*) as total_impressions,
  COUNT(*) FILTER (WHERE clicked) as clicks,
  COUNT(*) FILTER (WHERE liked) as likes,
  COUNT(*) FILTER (WHERE saved) as saves,
  COUNT(*) FILTER (WHERE inquired) as inquiries,
  AVG(dwell_time_ms) FILTER (WHERE dwell_time_ms > 0) as avg_dwell_ms,
  COUNT(*) FILTER (WHERE clicked)::FLOAT / NULLIF(COUNT(*), 0) as click_rate,
  COUNT(*) FILTER (WHERE inquired)::FLOAT / NULLIF(COUNT(*), 0) as inquiry_rate
FROM content_impressions
WHERE impression_at > NOW() - INTERVAL '30 days'
GROUP BY DATE(impression_at)
ORDER BY date DESC;

-- Content performance leaderboard
SELECT 
  cp.content_type,
  cp.content_id,
  cp.total_impressions,
  cp.click_rate,
  cp.like_rate,
  cp.save_rate,
  cp.inquiry_rate,
  cp.avg_dwell_time_ms,
  cp.is_trending,
  v.year || ' ' || v.make || ' ' || v.model as title
FROM content_performance cp
LEFT JOIN vehicles v ON cp.content_type = 'vehicle' AND cp.content_id = v.id
WHERE cp.created_at > NOW() - INTERVAL '7 days'
ORDER BY (cp.click_rate * 0.3 + cp.inquiry_rate * 0.5 + cp.save_rate * 0.2) DESC
LIMIT 20;

-- User engagement funnel
WITH user_journey AS (
  SELECT 
    user_id,
    COUNT(*) as impressions,
    COUNT(*) FILTER (WHERE clicked) as clicks,
    COUNT(*) FILTER (WHERE saved) as saves,
    COUNT(*) FILTER (WHERE inquired) as inquiries
  FROM content_impressions
  WHERE impression_at > NOW() - INTERVAL '7 days'
  GROUP BY user_id
)
SELECT 
  COUNT(DISTINCT user_id) as total_users,
  COUNT(DISTINCT user_id) FILTER (WHERE impressions > 0) as viewed,
  COUNT(DISTINCT user_id) FILTER (WHERE clicks > 0) as clicked,
  COUNT(DISTINCT user_id) FILTER (WHERE saves > 0) as saved,
  COUNT(DISTINCT user_id) FILTER (WHERE inquiries > 0) as inquired
FROM user_journey;

-- Algorithm performance by reason
SELECT 
  reason,
  COUNT(*) as impressions,
  COUNT(*) FILTER (WHERE ci.clicked) as clicks,
  COUNT(*) FILTER (WHERE ci.inquired) as inquiries,
  COUNT(*) FILTER (WHERE ci.clicked)::FLOAT / NULLIF(COUNT(*), 0) as ctr,
  AVG(ci.dwell_time_ms) FILTER (WHERE ci.dwell_time_ms > 0) as avg_dwell
FROM content_impressions ci
-- reason would be stored or joined from session logs
GROUP BY reason;
```

---

## 5. Migration Path

### 5.1 Existing Data Integration

The current system has:
- `user_interactions` table (views, likes, comments)
- `viewer_activity` table
- `viewer_reputation` table

Migration approach:

```sql
-- Backfill content_performance from existing data
INSERT INTO content_performance (content_type, content_id, total_impressions, created_at)
SELECT 
  'vehicle',
  target_id,
  COUNT(*),
  MIN(created_at)
FROM user_interactions
WHERE target_type = 'vehicle' AND interaction_type = 'view'
GROUP BY target_id
ON CONFLICT (content_type, content_id) DO UPDATE SET
  total_impressions = EXCLUDED.total_impressions;

-- Backfill engagement counts
UPDATE content_performance cp
SET 
  total_likes = (
    SELECT COUNT(*) FROM user_interactions 
    WHERE target_id = cp.content_id AND interaction_type = 'like'
  ),
  total_comments = (
    SELECT COUNT(*) FROM user_interactions 
    WHERE target_id = cp.content_id AND interaction_type = 'comment'
  );

-- Compute initial rates
SELECT compute_engagement_rates();
```

### 5.2 Gradual Rollout

```
Week 1: Deploy tracking infrastructure
- Add content_impressions table
- Deploy enhanced tracking hook
- Start collecting data (shadow mode)

Week 2: Build user interest vectors
- Run nightly job to compute vectors
- Validate against known user preferences

Week 3: A/B test ranking algorithm
- 10% of users get ranked feed
- Monitor engagement metrics vs. control

Week 4: Expand based on results
- If engagement up: expand to 50%
- If neutral: iterate on weights
- If down: rollback and analyze
```

---

## Summary

This implementation provides:

1. **Comprehensive tracking** of impressions, dwell time, and engagement
2. **User interest modeling** based on behavior
3. **Content performance metrics** for ranking
4. **Database functions** for efficient feed generation
5. **Frontend hooks** for visibility tracking
6. **A/B testing framework** for iteration
7. **Clear migration path** from existing system

The key insight from TikTok/Instagram is that **behavior-based signals** (watch time, dwell, completion) matter more than explicit signals (likes) for predicting engagement. Our schema captures both.

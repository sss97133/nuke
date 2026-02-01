/**
 * X Engagement Tracker
 *
 * Monitors engagement on posts we've made:
 * 1. Tracks likes, retweets, replies, views over time
 * 2. Identifies which content performs best
 * 3. Alerts on viral moments (sudden engagement spikes)
 * 4. Logs engagement history for analytics
 *
 * This is the FEEDBACK loop - learn what works.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface EngagementSnapshot {
  tweet_id: string;
  likes: number;
  retweets: number;
  replies: number;
  quotes: number;
  views: number;
  timestamp: string;
}

interface EngagementTrend {
  tweet_id: string;
  tweet_text: string;
  tweet_url: string;
  current: EngagementSnapshot;
  previous?: EngagementSnapshot;
  growth: {
    likes_delta: number;
    retweets_delta: number;
    replies_delta: number;
    views_delta: number;
    growth_rate: number;  // % change
  };
  is_viral: boolean;
  posted_at: string;
  age_hours: number;
}

interface TrackerRequest {
  user_id: string;
  mode?: 'all' | 'recent' | 'viral_only';
  hours_back?: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body: TrackerRequest = await req.json();
    const { user_id, mode = 'recent', hours_back = 24 } = body;

    if (!user_id) {
      return new Response(
        JSON.stringify({ error: 'user_id required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get user's X identity and credentials
    const { data: identity } = await supabase
      .from('external_identities')
      .select('id, handle, metadata')
      .eq('platform', 'x')
      .eq('claimed_by_user_id', user_id)
      .maybeSingle();

    if (!identity?.metadata?.access_token) {
      return new Response(
        JSON.stringify({ error: 'X account not connected' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const accessToken = identity.metadata.access_token;

    // Get posts we've made that we need to track
    let postsQuery = supabase
      .from('social_posts')
      .select('*')
      .eq('external_identity_id', identity.id)
      .eq('platform', 'x')
      .order('posted_at', { ascending: false });

    if (mode === 'recent') {
      const cutoff = new Date(Date.now() - hours_back * 60 * 60 * 1000).toISOString();
      postsQuery = postsQuery.gte('posted_at', cutoff);
    }

    const { data: posts, error: postsError } = await postsQuery.limit(50);

    if (postsError) {
      throw new Error(`Failed to get posts: ${postsError.message}`);
    }

    if (!posts || posts.length === 0) {
      return new Response(
        JSON.stringify({
          message: 'No posts to track yet',
          trends: [],
          summary: { total_posts: 0 }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const trends: EngagementTrend[] = [];
    const tweetIds = posts.map(p => p.post_id).filter(Boolean);

    // Fetch current engagement from X API
    if (tweetIds.length > 0) {
      try {
        // X API allows up to 100 tweet IDs per request
        const chunks = [];
        for (let i = 0; i < tweetIds.length; i += 100) {
          chunks.push(tweetIds.slice(i, i + 100));
        }

        for (const chunk of chunks) {
          const tweetsResponse = await fetch(
            `https://api.twitter.com/2/tweets?ids=${chunk.join(',')}&tweet.fields=public_metrics,created_at`,
            { headers: { 'Authorization': `Bearer ${accessToken}` } }
          );

          if (!tweetsResponse.ok) {
            console.log('[x-engagement-tracker] Failed to fetch tweets:', await tweetsResponse.text());
            continue;
          }

          const tweetsData = await tweetsResponse.json();

          for (const tweet of (tweetsData.data || [])) {
            const post = posts.find(p => p.post_id === tweet.id);
            if (!post) continue;

            const metrics = tweet.public_metrics || {};
            const currentSnapshot: EngagementSnapshot = {
              tweet_id: tweet.id,
              likes: metrics.like_count || 0,
              retweets: metrics.retweet_count || 0,
              replies: metrics.reply_count || 0,
              quotes: metrics.quote_count || 0,
              views: metrics.impression_count || 0,
              timestamp: new Date().toISOString()
            };

            // Get previous snapshot from metadata
            const previousMetrics = post.engagement_metrics || {};
            const previousSnapshot: EngagementSnapshot | undefined = previousMetrics.likes !== undefined
              ? {
                  tweet_id: tweet.id,
                  likes: previousMetrics.likes || 0,
                  retweets: previousMetrics.retweets || 0,
                  replies: previousMetrics.replies || 0,
                  quotes: previousMetrics.quotes || 0,
                  views: previousMetrics.views || 0,
                  timestamp: previousMetrics.tracked_at || post.posted_at
                }
              : undefined;

            // Calculate growth
            const likesDelta = currentSnapshot.likes - (previousSnapshot?.likes || 0);
            const retweetsDelta = currentSnapshot.retweets - (previousSnapshot?.retweets || 0);
            const repliesDelta = currentSnapshot.replies - (previousSnapshot?.replies || 0);
            const viewsDelta = currentSnapshot.views - (previousSnapshot?.views || 0);

            const previousTotal = (previousSnapshot?.likes || 0) + (previousSnapshot?.retweets || 0);
            const currentTotal = currentSnapshot.likes + currentSnapshot.retweets;
            const growthRate = previousTotal > 0
              ? ((currentTotal - previousTotal) / previousTotal) * 100
              : currentTotal > 0 ? 100 : 0;

            // Determine if viral (>50% growth or >1000 new engagements)
            const isViral = growthRate > 50 || (likesDelta + retweetsDelta * 2) > 1000;

            const postedAt = new Date(post.posted_at);
            const ageHours = (Date.now() - postedAt.getTime()) / (1000 * 60 * 60);

            trends.push({
              tweet_id: tweet.id,
              tweet_text: post.content,
              tweet_url: post.post_url,
              current: currentSnapshot,
              previous: previousSnapshot,
              growth: {
                likes_delta: likesDelta,
                retweets_delta: retweetsDelta,
                replies_delta: repliesDelta,
                views_delta: viewsDelta,
                growth_rate: Math.round(growthRate * 10) / 10
              },
              is_viral: isViral,
              posted_at: post.posted_at,
              age_hours: Math.round(ageHours * 10) / 10
            });

            // Update the post with current engagement
            await supabase
              .from('social_posts')
              .update({
                engagement_metrics: {
                  likes: currentSnapshot.likes,
                  retweets: currentSnapshot.retweets,
                  replies: currentSnapshot.replies,
                  quotes: currentSnapshot.quotes,
                  views: currentSnapshot.views,
                  tracked_at: currentSnapshot.timestamp
                }
              })
              .eq('id', post.id);
          }

          // Rate limit friendly delay
          await new Promise(r => setTimeout(r, 100));
        }
      } catch (e: any) {
        console.error('[x-engagement-tracker] Error fetching engagement:', e);
      }
    }

    // Filter to viral only if requested
    let filteredTrends = trends;
    if (mode === 'viral_only') {
      filteredTrends = trends.filter(t => t.is_viral);
    }

    // Sort by engagement
    filteredTrends.sort((a, b) => {
      const aScore = a.current.likes + a.current.retweets * 2 + a.growth.growth_rate;
      const bScore = b.current.likes + b.current.retweets * 2 + b.growth.growth_rate;
      return bScore - aScore;
    });

    // Calculate summary
    const summary = {
      total_posts: trends.length,
      viral_posts: trends.filter(t => t.is_viral).length,
      total_likes: trends.reduce((sum, t) => sum + t.current.likes, 0),
      total_retweets: trends.reduce((sum, t) => sum + t.current.retweets, 0),
      total_replies: trends.reduce((sum, t) => sum + t.current.replies, 0),
      total_views: trends.reduce((sum, t) => sum + t.current.views, 0),
      avg_engagement_rate: trends.length > 0
        ? Math.round(trends.reduce((sum, t) => sum + t.growth.growth_rate, 0) / trends.length * 10) / 10
        : 0,
      best_performing: filteredTrends[0]?.tweet_id || null
    };

    // If any posts are viral, store alert (if table exists)
    try {
      for (const trend of filteredTrends.filter(t => t.is_viral)) {
        await supabase.from('social_alerts').upsert({
          user_id,
          platform: 'x',
          alert_type: 'viral_moment',
          tweet_id: trend.tweet_id,
          message: `Your post is going viral! ${trend.growth.likes_delta} new likes, ${trend.growth.growth_rate}% growth`,
          engagement_snapshot: trend.current,
          created_at: new Date().toISOString(),
          read: false
        }, { onConflict: 'user_id,platform,tweet_id,alert_type' });
      }
    } catch (e) {
      console.log('[x-engagement-tracker] Alerts table not available');
    }

    return new Response(
      JSON.stringify({
        trends: filteredTrends,
        summary,
        tracked_at: new Date().toISOString()
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[x-engagement-tracker] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

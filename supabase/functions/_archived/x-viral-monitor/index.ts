/**
 * X Viral Monitor
 *
 * Real-time monitoring system that:
 * 1. Tracks specific high-value accounts for reply opportunities
 * 2. Monitors trending topics relevant to our niche
 * 3. Finds viral content we can ride
 * 4. Stores opportunities for users to act on
 *
 * This is the DISCOVERY engine - finds the waves to ride.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// High-value accounts to monitor for reply opportunities
const WATCH_ACCOUNTS = [
  'elonmusk',
  'MKBHD',
  'JayLeno',
  'TheRock',
  'SnoopDogg',
  'DougDeMuro',
  'VINwiki',
  'maboroshi',
  'mrjimmymac',
  'TheSmokinTire',
  'AutoTrader',
  'Hagerty',
  'babormarket'
];

// Niche keywords to track
const NICHE_KEYWORDS = [
  'squarebody',
  'k5 blazer',
  'ls swap',
  'restomod',
  'project car',
  'classic truck',
  'c10',
  'chevy truck',
  'patina',
  'barn find',
  'auction',
  'bring a trailer',
  'cars and bids'
];

interface ViralOpportunity {
  type: 'reply_opportunity' | 'trending_wave' | 'viral_post' | 'niche_mention';
  source_account?: string;
  tweet_id: string;
  tweet_text: string;
  engagement: {
    likes: number;
    retweets: number;
    replies: number;
    views?: number;
  };
  relevance_score: number;
  suggested_action: string;
  urgency: 'now' | 'soon' | 'when_ready';
  discovered_at: string;
}

interface MonitorRequest {
  user_id: string;
  mode: 'full_scan' | 'watch_accounts' | 'trending' | 'niche_search';
  limit?: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body: MonitorRequest = await req.json();
    const { user_id, mode = 'full_scan', limit = 20 } = body;

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

    // Get user's X credentials
    const { data: identity } = await supabase
      .from('external_identities')
      .select('metadata')
      .eq('platform', 'x')
      .eq('claimed_by_user_id', user_id)
      .maybeSingle();

    const accessToken = identity?.metadata?.access_token;
    if (!accessToken) {
      return new Response(
        JSON.stringify({ error: 'X account not connected' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const opportunities: ViralOpportunity[] = [];

    // 1. Monitor watched accounts for reply opportunities
    if (mode === 'full_scan' || mode === 'watch_accounts') {
      for (const account of WATCH_ACCOUNTS.slice(0, 5)) { // Rate limit friendly
        try {
          // Get user ID first
          const userResponse = await fetch(
            `https://api.twitter.com/2/users/by/username/${account}`,
            { headers: { 'Authorization': `Bearer ${accessToken}` } }
          );

          if (!userResponse.ok) continue;
          const userData = await userResponse.json();
          const accountId = userData.data?.id;
          if (!accountId) continue;

          // Get their recent tweets
          const tweetsResponse = await fetch(
            `https://api.twitter.com/2/users/${accountId}/tweets?max_results=5&tweet.fields=public_metrics,created_at`,
            { headers: { 'Authorization': `Bearer ${accessToken}` } }
          );

          if (!tweetsResponse.ok) continue;
          const tweetsData = await tweetsResponse.json();

          for (const tweet of (tweetsData.data || [])) {
            const metrics = tweet.public_metrics || {};
            const engagement = metrics.like_count + metrics.retweet_count * 2;

            // High engagement = opportunity
            if (engagement > 1000) {
              // Check if tweet mentions anything we can connect to
              const isRelevant = NICHE_KEYWORDS.some(kw =>
                tweet.text.toLowerCase().includes(kw.toLowerCase())
              ) || tweet.text.toLowerCase().includes('car') ||
                 tweet.text.toLowerCase().includes('truck');

              opportunities.push({
                type: 'reply_opportunity',
                source_account: account,
                tweet_id: tweet.id,
                tweet_text: tweet.text,
                engagement: {
                  likes: metrics.like_count || 0,
                  retweets: metrics.retweet_count || 0,
                  replies: metrics.reply_count || 0,
                  views: metrics.impression_count
                },
                relevance_score: isRelevant ? 0.9 : 0.5,
                suggested_action: isRelevant
                  ? 'Direct connection to our niche - reply with relevant content'
                  : 'High visibility account - find clever angle to join conversation',
                urgency: engagement > 10000 ? 'now' : 'soon',
                discovered_at: new Date().toISOString()
              });
            }
          }

          // Small delay between accounts to avoid rate limits
          await new Promise(r => setTimeout(r, 200));
        } catch (e) {
          console.log(`[x-viral-monitor] Error monitoring @${account}:`, e);
        }
      }
    }

    // 2. Search for niche-specific viral content
    if (mode === 'full_scan' || mode === 'niche_search') {
      for (const keyword of NICHE_KEYWORDS.slice(0, 3)) {
        try {
          const searchResponse = await fetch(
            `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(keyword)}&max_results=10&tweet.fields=public_metrics,author_id,created_at`,
            { headers: { 'Authorization': `Bearer ${accessToken}` } }
          );

          if (!searchResponse.ok) continue;
          const searchData = await searchResponse.json();

          for (const tweet of (searchData.data || [])) {
            const metrics = tweet.public_metrics || {};
            const engagement = metrics.like_count + metrics.retweet_count * 2;

            if (engagement > 500) {
              opportunities.push({
                type: 'niche_mention',
                tweet_id: tweet.id,
                tweet_text: tweet.text,
                engagement: {
                  likes: metrics.like_count || 0,
                  retweets: metrics.retweet_count || 0,
                  replies: metrics.reply_count || 0,
                  views: metrics.impression_count
                },
                relevance_score: 0.85,
                suggested_action: `Viral content about "${keyword}" - engage or quote tweet`,
                urgency: engagement > 5000 ? 'now' : 'soon',
                discovered_at: new Date().toISOString()
              });
            }
          }

          await new Promise(r => setTimeout(r, 200));
        } catch (e) {
          console.log(`[x-viral-monitor] Error searching "${keyword}":`, e);
        }
      }
    }

    // 3. Check trending topics
    if (mode === 'full_scan' || mode === 'trending') {
      try {
        // Try trends endpoint (requires elevated access)
        const trendsResponse = await fetch(
          'https://api.twitter.com/1.1/trends/place.json?id=23424977', // US
          { headers: { 'Authorization': `Bearer ${accessToken}` } }
        );

        if (trendsResponse.ok) {
          const trendsData = await trendsResponse.json();
          const trends = trendsData[0]?.trends || [];

          // Find trends that might connect to automotive
          const relevantTrends = trends.filter((t: any) => {
            const name = t.name.toLowerCase();
            return name.includes('car') || name.includes('truck') ||
                   name.includes('drive') || name.includes('road') ||
                   name.includes('fast') || name.includes('engine');
          });

          for (const trend of relevantTrends.slice(0, 3)) {
            opportunities.push({
              type: 'trending_wave',
              tweet_id: '', // No specific tweet
              tweet_text: trend.name,
              engagement: {
                likes: 0,
                retweets: 0,
                replies: 0,
                views: trend.tweet_volume || 0
              },
              relevance_score: 0.7,
              suggested_action: `Trending topic "${trend.name}" - create content that rides this wave`,
              urgency: 'now',
              discovered_at: new Date().toISOString()
            });
          }
        }
      } catch (e) {
        console.log('[x-viral-monitor] Trends not available');
      }
    }

    // Sort by urgency and relevance
    opportunities.sort((a, b) => {
      const urgencyScore = { now: 3, soon: 2, when_ready: 1 };
      const aScore = urgencyScore[a.urgency] + a.relevance_score;
      const bScore = urgencyScore[b.urgency] + b.relevance_score;
      return bScore - aScore;
    });

    // Store opportunities for the user (if table exists)
    try {
      const { error: storeError } = await supabase
        .from('social_opportunities')
        .upsert(
          opportunities.slice(0, limit).map(opp => ({
            user_id,
            platform: 'x',
            opportunity_type: opp.type,
            tweet_id: opp.tweet_id || null,
            content: opp.tweet_text,
            source_account: opp.source_account || null,
            engagement_metrics: opp.engagement,
            relevance_score: opp.relevance_score,
            suggested_action: opp.suggested_action,
            urgency: opp.urgency,
            discovered_at: opp.discovered_at,
            status: 'new'
          })),
          { onConflict: 'user_id,platform,tweet_id', ignoreDuplicates: true }
        );

      if (storeError) {
        console.log('[x-viral-monitor] Note: Could not store opportunities:', storeError.message);
      }
    } catch (e) {
      console.log('[x-viral-monitor] Opportunities table not available');
    }

    return new Response(
      JSON.stringify({
        opportunities: opportunities.slice(0, limit),
        total_found: opportunities.length,
        scan_mode: mode,
        scanned_at: new Date().toISOString()
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[x-viral-monitor] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

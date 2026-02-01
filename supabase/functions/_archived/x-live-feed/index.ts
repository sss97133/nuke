/**
 * X Live Feed
 *
 * Unified endpoint for the Social Workspace that provides:
 * 1. Real-time viral opportunities
 * 2. Engagement tracking on our posts
 * 3. Trending topics
 * 4. Suggested quick replies
 * 5. Content performance insights
 *
 * This powers the WORKSPACE UI with live data.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface FeedRequest {
  user_id: string;
  sections?: ('viral' | 'engagement' | 'trending' | 'queue' | 'alerts')[];
  generate_replies?: boolean;  // Use AI to suggest quick replies
}

interface FeedItem {
  id: string;
  type: 'viral_opportunity' | 'engagement_update' | 'trending_topic' | 'queued_post' | 'alert';
  source_account?: string;
  content: string;
  engagement?: {
    likes: number;
    retweets: number;
    replies: number;
    views?: number;
  };
  url?: string;
  suggested_reply?: string;
  urgency?: 'now' | 'soon' | 'when_ready';
  relevance_score?: number;
  timestamp: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body: FeedRequest = await req.json();
    const {
      user_id,
      sections = ['viral', 'engagement', 'trending', 'alerts'],
      generate_replies = true
    } = body;

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
      .select('id, handle, metadata')
      .eq('platform', 'x')
      .eq('claimed_by_user_id', user_id)
      .maybeSingle();

    const accessToken = identity?.metadata?.access_token;
    const feedItems: FeedItem[] = [];

    // 1. VIRAL OPPORTUNITIES - Fresh from X API
    if (sections.includes('viral') && accessToken) {
      // Monitor some high-value accounts
      const watchAccounts = ['elonmusk', 'DougDeMuro', 'VINwiki', 'Hagerty', 'bringatrailer'];

      for (const account of watchAccounts.slice(0, 3)) {
        try {
          const userResponse = await fetch(
            `https://api.twitter.com/2/users/by/username/${account}`,
            { headers: { 'Authorization': `Bearer ${accessToken}` } }
          );
          if (!userResponse.ok) continue;

          const userData = await userResponse.json();
          const accountId = userData.data?.id;
          if (!accountId) continue;

          const tweetsResponse = await fetch(
            `https://api.twitter.com/2/users/${accountId}/tweets?max_results=5&tweet.fields=public_metrics,created_at`,
            { headers: { 'Authorization': `Bearer ${accessToken}` } }
          );
          if (!tweetsResponse.ok) continue;

          const tweetsData = await tweetsResponse.json();

          for (const tweet of (tweetsData.data || []).slice(0, 2)) {
            const metrics = tweet.public_metrics || {};
            if (metrics.like_count > 500) {
              feedItems.push({
                id: `viral-${tweet.id}`,
                type: 'viral_opportunity',
                source_account: account,
                content: tweet.text,
                engagement: {
                  likes: metrics.like_count || 0,
                  retweets: metrics.retweet_count || 0,
                  replies: metrics.reply_count || 0,
                  views: metrics.impression_count
                },
                url: `https://x.com/${account}/status/${tweet.id}`,
                urgency: metrics.like_count > 5000 ? 'now' : 'soon',
                relevance_score: 0.7,
                timestamp: tweet.created_at || new Date().toISOString()
              });
            }
          }
          await new Promise(r => setTimeout(r, 100));
        } catch (e) {
          console.log(`[x-live-feed] Error monitoring @${account}`);
        }
      }

      // Also search niche keywords
      const nicheKeywords = ['squarebody', 'restomod', 'ls swap'];
      for (const keyword of nicheKeywords.slice(0, 2)) {
        try {
          const searchResponse = await fetch(
            `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(keyword + ' -is:retweet')}&max_results=10&tweet.fields=public_metrics,author_id,created_at&expansions=author_id`,
            { headers: { 'Authorization': `Bearer ${accessToken}` } }
          );
          if (!searchResponse.ok) continue;

          const searchData = await searchResponse.json();
          const users = Object.fromEntries(
            (searchData.includes?.users || []).map((u: any) => [u.id, u.username])
          );

          for (const tweet of (searchData.data || []).slice(0, 3)) {
            const metrics = tweet.public_metrics || {};
            if (metrics.like_count > 100) {
              feedItems.push({
                id: `niche-${tweet.id}`,
                type: 'viral_opportunity',
                source_account: users[tweet.author_id] || 'unknown',
                content: tweet.text,
                engagement: {
                  likes: metrics.like_count || 0,
                  retweets: metrics.retweet_count || 0,
                  replies: metrics.reply_count || 0
                },
                url: `https://x.com/${users[tweet.author_id]}/status/${tweet.id}`,
                urgency: 'soon',
                relevance_score: 0.85,
                timestamp: tweet.created_at || new Date().toISOString()
              });
            }
          }
          await new Promise(r => setTimeout(r, 100));
        } catch (e) {
          console.log(`[x-live-feed] Error searching "${keyword}"`);
        }
      }
    }

    // 2. ENGAGEMENT UPDATES - Our posts' performance
    if (sections.includes('engagement') && identity) {
      const { data: recentPosts } = await supabase
        .from('social_posts')
        .select('*')
        .eq('external_identity_id', identity.id)
        .order('posted_at', { ascending: false })
        .limit(10);

      for (const post of (recentPosts || [])) {
        // Fetch fresh engagement if we have a post_id
        if (post.post_id && accessToken) {
          try {
            const tweetResponse = await fetch(
              `https://api.twitter.com/2/tweets/${post.post_id}?tweet.fields=public_metrics`,
              { headers: { 'Authorization': `Bearer ${accessToken}` } }
            );
            if (tweetResponse.ok) {
              const tweetData = await tweetResponse.json();
              const metrics = tweetData.data?.public_metrics || {};

              feedItems.push({
                id: `engagement-${post.id}`,
                type: 'engagement_update',
                content: post.content,
                engagement: {
                  likes: metrics.like_count || 0,
                  retweets: metrics.retweet_count || 0,
                  replies: metrics.reply_count || 0,
                  views: metrics.impression_count
                },
                url: post.post_url,
                timestamp: post.posted_at
              });
            }
          } catch (e) {
            // Use cached engagement
            feedItems.push({
              id: `engagement-${post.id}`,
              type: 'engagement_update',
              content: post.content,
              engagement: post.engagement_metrics || { likes: 0, retweets: 0, replies: 0 },
              url: post.post_url,
              timestamp: post.posted_at
            });
          }
        }
      }
    }

    // 3. TRENDING TOPICS
    if (sections.includes('trending') && accessToken) {
      try {
        const trendsResponse = await fetch(
          'https://api.twitter.com/1.1/trends/place.json?id=23424977',
          { headers: { 'Authorization': `Bearer ${accessToken}` } }
        );
        if (trendsResponse.ok) {
          const trendsData = await trendsResponse.json();
          for (const trend of (trendsData[0]?.trends || []).slice(0, 10)) {
            feedItems.push({
              id: `trend-${trend.name.replace(/[^a-zA-Z0-9]/g, '')}`,
              type: 'trending_topic',
              content: trend.name,
              engagement: { likes: 0, retweets: 0, replies: 0, views: trend.tweet_volume || 0 },
              url: trend.url,
              timestamp: new Date().toISOString()
            });
          }
        }
      } catch (e) {
        // Fallback trending topics
        const fallback = ['#SquareBody', '#ClassicCars', '#Restomod', '#ProjectCar', '#CarTwitter'];
        for (const topic of fallback) {
          feedItems.push({
            id: `trend-${topic}`,
            type: 'trending_topic',
            content: topic,
            timestamp: new Date().toISOString()
          });
        }
      }
    }

    // 4. ALERTS
    if (sections.includes('alerts')) {
      try {
        const { data: alerts } = await supabase
          .from('social_alerts')
          .select('*')
          .eq('user_id', user_id)
          .eq('read', false)
          .order('created_at', { ascending: false })
          .limit(5);

        for (const alert of (alerts || [])) {
          feedItems.push({
            id: `alert-${alert.id}`,
            type: 'alert',
            content: alert.message,
            engagement: alert.engagement_snapshot,
            timestamp: alert.created_at
          });
        }
      } catch (e) {
        // social_alerts table may not exist yet
        console.log('[x-live-feed] Alerts table not available');
      }
    }

    // 5. GENERATE AI QUICK REPLIES for top viral opportunities
    if (generate_replies && feedItems.filter(f => f.type === 'viral_opportunity').length > 0) {
      const anthropic = new Anthropic();
      const viralItems = feedItems
        .filter(f => f.type === 'viral_opportunity')
        .slice(0, 5);

      const replyPrompt = `Generate quick, witty reply suggestions for these viral tweets. Keep replies SHORT (under 100 chars), punchy, and relevant to automotive/car culture if possible.

Tweets:
${viralItems.map((v, i) => `${i + 1}. @${v.source_account}: "${v.content.substring(0, 200)}"`).join('\n')}

Return JSON array of replies, one per tweet:
[{"index": 0, "reply": "your reply"}, ...]

Make them clever, not try-hard. Quick quips work best.`;

      try {
        const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          messages: [{ role: 'user', content: replyPrompt }]
        });

        const responseText = response.content
          .filter((block): block is Anthropic.TextBlock => block.type === 'text')
          .map(block => block.text)
          .join('');

        const jsonMatch = responseText.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const replies = JSON.parse(jsonMatch[0]);
          for (const reply of replies) {
            if (viralItems[reply.index]) {
              viralItems[reply.index].suggested_reply = reply.reply;
            }
          }
        }
      } catch (e) {
        console.log('[x-live-feed] Could not generate replies:', e);
      }
    }

    // Sort feed: urgency first, then by engagement
    feedItems.sort((a, b) => {
      const urgencyScore: Record<string, number> = { now: 3, soon: 2, when_ready: 1 };
      const aUrgency = a.urgency ? urgencyScore[a.urgency] || 0 : 0;
      const bUrgency = b.urgency ? urgencyScore[b.urgency] || 0 : 0;
      if (aUrgency !== bUrgency) return bUrgency - aUrgency;

      const aEng = (a.engagement?.likes || 0) + (a.engagement?.retweets || 0) * 2;
      const bEng = (b.engagement?.likes || 0) + (b.engagement?.retweets || 0) * 2;
      return bEng - aEng;
    });

    // Build summary stats
    const summary = {
      total_items: feedItems.length,
      viral_opportunities: feedItems.filter(f => f.type === 'viral_opportunity').length,
      urgent_now: feedItems.filter(f => f.urgency === 'now').length,
      unread_alerts: feedItems.filter(f => f.type === 'alert').length,
      connected_account: identity?.handle || null
    };

    return new Response(
      JSON.stringify({
        feed: feedItems,
        summary,
        generated_at: new Date().toISOString()
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[x-live-feed] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

/**
 * X Engagement Agent
 *
 * Automated engagement strategy following proven patterns:
 * 1. Monitor viral accounts (Elon, top car influencers) for patterns
 * 2. Find relevant posts to reply to
 * 3. Generate engaging replies
 * 4. Track what works
 *
 * This is the active engagement loop for building following.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const X_API_BASE = 'https://api.twitter.com/2';
const XAI_API_BASE = 'https://api.x.ai/v1';

// Accounts to learn from (viral patterns)
const VIRAL_ACCOUNTS = [
  'elonmusk',
  'TheRealAutopia',
  'BrianScotto',
  'savagegeese',
  'DougDeMuro',
  'MrRanOutTheGate',
];

// Topics to engage with
const ENGAGEMENT_TOPICS = [
  'LS swap',
  'K5 Blazer',
  'Squarebody',
  '70s trucks',
  'restomod',
  'project car',
  'barn find',
  'classic chevy',
];

interface EngagementRequest {
  user_id: string;
  mode: 'learn' | 'find_posts' | 'generate_reply' | 'auto_engage';
  topic?: string;
  tweet_id?: string;
  tweet_text?: string;
  max_replies?: number;
}

interface ViralPattern {
  format: string;
  example: string;
  engagement_type: string;
  success_rate: string;
}

const PROVEN_PATTERNS: ViralPattern[] = [
  {
    format: 'Short agreement + add value',
    example: 'This. Also [relevant insight]',
    engagement_type: 'reply',
    success_rate: 'high'
  },
  {
    format: 'Question that sparks discussion',
    example: 'Have you tried [alternative]?',
    engagement_type: 'reply',
    success_rate: 'high'
  },
  {
    format: 'Personal experience tie-in',
    example: 'Same thing happened with my [vehicle]. Ended up [outcome]',
    engagement_type: 'reply',
    success_rate: 'very high'
  },
  {
    format: 'Contrarian but respectful',
    example: 'Interesting take. I found [opposite experience] because [reason]',
    engagement_type: 'reply',
    success_rate: 'medium-high'
  },
  {
    format: 'Appreciation + question',
    example: 'Beautiful build. What made you choose [specific detail]?',
    engagement_type: 'reply',
    success_rate: 'very high'
  },
  {
    format: 'Quick flex connection',
    example: '[Year] gang. LS swap life.',
    engagement_type: 'reply',
    success_rate: 'high'
  },
  {
    format: 'Helpful resource',
    example: 'If you need [part/advice], check out [resource]',
    engagement_type: 'reply',
    success_rate: 'high'
  }
];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body: EngagementRequest = await req.json();
    const { user_id, mode, topic, tweet_id, tweet_text, max_replies = 5 } = body;

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

    if (!identity?.metadata?.access_token) {
      return new Response(
        JSON.stringify({ error: 'X account not connected' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const accessToken = identity.metadata.access_token;
    const XAI_API_KEY = Deno.env.get('XAI_API_KEY');

    switch (mode) {
      case 'learn': {
        // Analyze viral accounts for patterns
        const patterns: any[] = [];

        for (const username of VIRAL_ACCOUNTS.slice(0, 3)) {
          try {
            // Get user ID
            const userResponse = await fetch(
              `${X_API_BASE}/users/by/username/${username}`,
              { headers: { 'Authorization': `Bearer ${accessToken}` } }
            );

            if (!userResponse.ok) continue;
            const userData = await userResponse.json();
            const accountId = userData.data?.id;
            if (!accountId) continue;

            // Get recent tweets
            const tweetsResponse = await fetch(
              `${X_API_BASE}/users/${accountId}/tweets?max_results=10&tweet.fields=public_metrics,created_at`,
              { headers: { 'Authorization': `Bearer ${accessToken}` } }
            );

            if (!tweetsResponse.ok) continue;
            const tweetsData = await tweetsResponse.json();

            for (const tweet of (tweetsData.data || []).slice(0, 3)) {
              const metrics = tweet.public_metrics || {};
              patterns.push({
                account: username,
                text: tweet.text.substring(0, 100),
                likes: metrics.like_count || 0,
                retweets: metrics.retweet_count || 0,
                replies: metrics.reply_count || 0,
                engagement_score: (metrics.like_count || 0) + (metrics.retweet_count || 0) * 2
              });
            }

            await new Promise(r => setTimeout(r, 200));
          } catch (e) {
            console.log(`[x-engagement-agent] Failed to analyze ${username}`);
          }
        }

        // Sort by engagement
        patterns.sort((a, b) => b.engagement_score - a.engagement_score);

        return new Response(
          JSON.stringify({
            patterns: patterns.slice(0, 10),
            proven_formats: PROVEN_PATTERNS,
            recommendation: 'Use short, punchy replies that add value or ask questions'
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'find_posts': {
        // Search for posts to engage with
        const searchTopic = topic || ENGAGEMENT_TOPICS[Math.floor(Math.random() * ENGAGEMENT_TOPICS.length)];

        const searchResponse = await fetch(
          `${X_API_BASE}/tweets/search/recent?query=${encodeURIComponent(searchTopic)}&max_results=20&tweet.fields=public_metrics,author_id,created_at`,
          { headers: { 'Authorization': `Bearer ${accessToken}` } }
        );

        if (!searchResponse.ok) {
          const errorText = await searchResponse.text();
          throw new Error(`Search failed: ${errorText}`);
        }

        const searchData = await searchResponse.json();
        const posts = (searchData.data || [])
          .filter((t: any) => {
            const metrics = t.public_metrics || {};
            // Filter for posts worth engaging with (some engagement but not too big)
            return metrics.like_count >= 5 && metrics.like_count < 10000;
          })
          .slice(0, max_replies)
          .map((t: any) => ({
            id: t.id,
            text: t.text,
            likes: t.public_metrics?.like_count || 0,
            retweets: t.public_metrics?.retweet_count || 0,
            author_id: t.author_id,
            created_at: t.created_at
          }));

        return new Response(
          JSON.stringify({
            topic: searchTopic,
            posts,
            suggestion: 'Reply to posts with 5-1000 likes for best visibility'
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'generate_reply': {
        if (!tweet_text) {
          return new Response(
            JSON.stringify({ error: 'tweet_text required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (!XAI_API_KEY) {
          return new Response(
            JSON.stringify({ error: 'XAI_API_KEY not configured' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Get user's vehicle context
        const { data: vehicles } = await supabase
          .from('vehicles')
          .select('year, make, model, engine')
          .eq('owner_id', user_id)
          .limit(1);

        const vehicleContext = vehicles?.[0]
          ? `${vehicles[0].year} ${vehicles[0].make} ${vehicles[0].model}${vehicles[0].engine ? ` (${vehicles[0].engine})` : ''}`
          : 'classic car enthusiast';

        const prompt = `Generate 3 engaging reply options for this tweet.

Original tweet: "${tweet_text}"

Your context: You own a ${vehicleContext}. You're a car enthusiast who knows your stuff.

Reply patterns that work:
${PROVEN_PATTERNS.map(p => `- ${p.format}: "${p.example}"`).join('\n')}

Requirements:
- Each reply MUST be under 200 characters
- Be authentic, not salesy
- Add value or spark conversation
- Connect to car culture when relevant
- No hashtags in replies

Return JSON only:
{
  "replies": [
    {"text": "reply text", "pattern": "which pattern used", "confidence": 1-10}
  ]
}`;

        const response = await fetch(`${XAI_API_BASE}/chat/completions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${XAI_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'grok-4',
            messages: [
              { role: 'system', content: 'You generate engaging Twitter replies. Keep them short, authentic, and valuable. Return only valid JSON.' },
              { role: 'user', content: prompt }
            ],
            temperature: 0.8
          })
        });

        if (!response.ok) {
          throw new Error(`Grok API error: ${await response.text()}`);
        }

        const data = await response.json();
        const responseText = data.choices?.[0]?.message?.content || '';

        let result;
        try {
          const jsonMatch = responseText.match(/\{[\s\S]*\}/);
          result = jsonMatch ? JSON.parse(jsonMatch[0]) : { replies: [] };
        } catch {
          result = {
            replies: [
              { text: 'Nice build! What year?', pattern: 'Appreciation + question', confidence: 7 },
              { text: 'This. LS swap everything.', pattern: 'Short agreement', confidence: 6 }
            ]
          };
        }

        return new Response(
          JSON.stringify({
            original_tweet: tweet_text,
            replies: result.replies,
            tweet_id
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'auto_engage': {
        // Full auto mode: find posts, generate replies, post them
        const results: any[] = [];
        const searchTopic = topic || ENGAGEMENT_TOPICS[Math.floor(Math.random() * ENGAGEMENT_TOPICS.length)];

        // Find posts
        const searchResponse = await fetch(
          `${X_API_BASE}/tweets/search/recent?query=${encodeURIComponent(searchTopic)}&max_results=10&tweet.fields=public_metrics`,
          { headers: { 'Authorization': `Bearer ${accessToken}` } }
        );

        if (!searchResponse.ok) {
          throw new Error('Failed to search posts');
        }

        const searchData = await searchResponse.json();
        const posts = (searchData.data || [])
          .filter((t: any) => {
            const metrics = t.public_metrics || {};
            return metrics.like_count >= 5 && metrics.like_count < 5000;
          })
          .slice(0, max_replies);

        for (const post of posts) {
          try {
            // Generate reply using Grok
            if (!XAI_API_KEY) continue;

            const replyResponse = await fetch(`${XAI_API_BASE}/chat/completions`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${XAI_API_KEY}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                model: 'grok-4',
                messages: [
                  { role: 'system', content: 'Generate a short, engaging reply (under 150 chars). Be authentic. Return only the reply text, no JSON.' },
                  { role: 'user', content: `Reply to: "${post.text.substring(0, 200)}"` }
                ],
                temperature: 0.9
              })
            });

            if (!replyResponse.ok) continue;
            const replyData = await replyResponse.json();
            const replyText = replyData.choices?.[0]?.message?.content?.trim();

            if (!replyText || replyText.length > 280) continue;

            // Post the reply
            const postResponse = await fetch(`${X_API_BASE}/tweets`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                text: replyText,
                reply: { in_reply_to_tweet_id: post.id }
              })
            });

            if (postResponse.ok) {
              const postData = await postResponse.json();
              results.push({
                original_tweet: post.text.substring(0, 100),
                reply: replyText,
                reply_id: postData.data?.id,
                success: true
              });

              // Log to social_posts
              await supabase.from('social_posts').insert({
                platform: 'x',
                external_identity_id: identity.id,
                post_id: postData.data?.id,
                content: replyText,
                post_url: `https://x.com/${identity.handle}/status/${postData.data?.id}`,
                posted_at: new Date().toISOString(),
                metadata: { type: 'reply', in_reply_to: post.id }
              });
            }

            // Rate limit protection
            await new Promise(r => setTimeout(r, 2000));
          } catch (e: any) {
            console.log(`[x-engagement-agent] Failed to reply: ${e.message}`);
          }
        }

        return new Response(
          JSON.stringify({
            topic: searchTopic,
            engaged: results.length,
            results
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ error: 'Invalid mode', valid_modes: ['learn', 'find_posts', 'generate_reply', 'auto_engage'] }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

  } catch (error: any) {
    console.error('[x-engagement-agent] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

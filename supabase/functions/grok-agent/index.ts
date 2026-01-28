/**
 * Grok Agent
 *
 * Conversational AI agent for social media strategy.
 * - Chat about memes, trends, content strategy
 * - Analyze X links you share
 * - Tell you what's going viral right now
 * - Suggest how to respond to specific posts
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const XAI_API_BASE = 'https://api.x.ai/v1';
const X_API_BASE = 'https://api.twitter.com/2';

interface GrokRequest {
  user_id: string;
  message: string;
  conversation_history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

// Extract tweet ID from various X URL formats
function extractTweetId(text: string): string | null {
  const patterns = [
    /x\.com\/\w+\/status\/(\d+)/,
    /twitter\.com\/\w+\/status\/(\d+)/,
    /\/status\/(\d+)/
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const XAI_API_KEY = Deno.env.get('XAI_API_KEY');
    if (!XAI_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'XAI_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body: GrokRequest = await req.json();
    const { user_id, message, conversation_history = [] } = body;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get user's X credentials for API calls
    const { data: identity } = await supabase
      .from('external_identities')
      .select('handle, metadata')
      .eq('platform', 'x')
      .eq('claimed_by_user_id', user_id)
      .maybeSingle();

    const accessToken = identity?.metadata?.access_token;
    const userHandle = identity?.handle || 'user';

    // Get user's full profile context
    const { data: vehicles } = await supabase
      .from('vehicles')
      .select('id, year, make, model, engine_type, transmission, color, mileage, notes, description')
      .eq('owner_id', user_id);

    const { data: recentPosts } = await supabase
      .from('social_posts')
      .select('content, post_url, posted_at, engagement_metrics')
      .eq('platform', 'x')
      .order('posted_at', { ascending: false })
      .limit(5);

    // Get vehicle images
    let vehicleImages: any[] = [];
    if (vehicles && vehicles.length > 0) {
      const { data: images } = await supabase
        .from('vehicle_images')
        .select('image_url, vehicle_id, category, angle')
        .in('vehicle_id', vehicles.map(v => v.id))
        .order('created_at', { ascending: false })
        .limit(20);
      vehicleImages = images || [];
    }

    // Build rich vehicle context
    const vehicleContext = vehicles && vehicles.length > 0
      ? vehicles.map(v => {
          const make = v.make || '';
          const model = v.model || '';
          const details = [
            `${v.year} ${make} ${model}`.trim(),
            v.engine_type ? `Engine: ${v.engine_type}` : null,
            v.transmission ? `Trans: ${v.transmission}` : null,
            v.color ? `Color: ${v.color}` : null,
            v.mileage ? `${v.mileage.toLocaleString()} miles` : null,
          ].filter(Boolean).join(' | ');
          return `• ${details}`;
        }).join('\n')
      : null;

    const postsContext = recentPosts && recentPosts.length > 0
      ? recentPosts.map(p => {
          const metrics = p.engagement_metrics as any;
          const engagement = metrics ? `(${metrics.likes || 0} likes, ${metrics.retweets || 0} RTs)` : '';
          return `"${p.content}" ${engagement}`;
        }).join('\n')
      : null;

    const imageCount = vehicleImages.length;

    // Check if user shared an X link
    const tweetId = extractTweetId(message);
    let tweetContext = '';

    if (tweetId && accessToken) {
      try {
        const tweetResponse = await fetch(
          `${X_API_BASE}/tweets/${tweetId}?tweet.fields=public_metrics,author_id,created_at&expansions=author_id`,
          { headers: { 'Authorization': `Bearer ${accessToken}` } }
        );

        if (tweetResponse.ok) {
          const tweetData = await tweetResponse.json();
          const tweet = tweetData.data;
          const author = tweetData.includes?.users?.[0];
          const metrics = tweet?.public_metrics || {};

          tweetContext = `

[User shared this tweet]
Author: @${author?.username || 'unknown'}
Text: "${tweet?.text || ''}"
Engagement: ${metrics.like_count || 0} likes, ${metrics.retweet_count || 0} RTs, ${metrics.reply_count || 0} replies
`;
        }
      } catch (e) {
        console.log('[grok-agent] Failed to fetch tweet:', e);
      }
    }

    // Build system prompt with full context
    const systemPrompt = `You are a social media strategist who helps @${userHandle} dominate X.

Your vibe: Direct, tactical, no bullshit. You understand meme culture, car culture, and what actually goes viral.

=== USER PROFILE ===
X Handle: @${userHandle}

${vehicleContext ? `VEHICLES/BUILDS:
${vehicleContext}` : 'No vehicles registered yet.'}

${imageCount > 0 ? `PHOTOS: ${imageCount} images in gallery. Categories: ${[...new Set(vehicleImages.map(i => i.category).filter(Boolean))].join(', ') || 'various'}` : ''}

${postsContext ? `RECENT POSTS:
${postsContext}` : 'No posts yet.'}

WHAT YOU HELP WITH:

1. ANALYZING POSTS
When they share a link, break down:
- Why it works (hook, format, timing)
- Engagement patterns
- How to replicate the success
- What to respond with

2. CONTENT STRATEGY
- Long-form posts and threads (not just 280 char captions)
- Story arcs that build following
- Educational content that positions as authority
- Hot takes that spark engagement
- Thread structures for builds/projects

3. WHAT'S WORKING NOW
- Current viral formats and trends
- What's getting engagement in car culture
- Meme structures worth studying
- Accounts to watch and learn from

4. DRAFTING CONTENT
- Write full threads (multiple tweets)
- Long-form posts with substance
- Replies that get noticed
- Quote tweets that add value

STYLE:
- Be conversational, not corporate
- Give specific examples
- Be opinionated - what works, what doesn't
- Format responses for readability (use line breaks)
- When drafting content, write the actual post - don't just describe it

DON'T:
- Suggest cringe meme formats (POV:, Nobody:, etc.)
- Be generic
- Give vague advice
- Worry about character limits unless asked`;

    // Build messages
    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversation_history.slice(-10), // Keep last 10 messages for context
      { role: 'user', content: message + tweetContext }
    ];

    // Call Grok
    const response = await fetch(`${XAI_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${XAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'grok-4.1',
        messages,
        temperature: 0.8
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Grok API error: ${errorText}`);
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || 'No response';

    return new Response(
      JSON.stringify({
        reply,
        tweet_analyzed: tweetId ? true : false,
        user_handle: userHandle
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[grok-agent] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

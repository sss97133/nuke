/**
 * X Trend Hijack
 *
 * Fetches current trending topics on X and generates content
 * that cleverly injects your brand/content into the conversation.
 *
 * Strategy: Ride the wave of what people are already talking about.
 * Don't fight the algorithm - use it.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TrendHijackRequest {
  user_id: string;
  content_context: {
    type: 'vehicle' | 'brand' | 'topic';
    vehicle?: {
      year: number;
      make: string;
      model: string;
      details?: string;
    };
    brand?: string;
    topic?: string;
    images?: string[];
  };
  location?: string;  // For geo-targeted trends (default: US)
  categories?: string[];  // Filter: 'automotive', 'sports', 'entertainment', etc.
  count?: number;  // Number of post options to generate
}

interface TrendData {
  name: string;
  tweet_count?: number;
  category?: string;
}

interface HijackResult {
  trends_found: TrendData[];
  generated_posts: Array<{
    trend: string;
    text: string;
    angle: string;
    connection_strength: 'strong' | 'medium' | 'stretch';
    timing: string;
    virality_potential: number;
  }>;
  image_suggestions: Array<{
    trend: string;
    prompt: string;
    rationale: string;
  }>;
  strategy_notes: string;
}

const HIJACK_SYSTEM_PROMPT = `You are an expert at trend-jacking - the art of inserting your content into trending conversations in a way that feels natural, clever, and engaging.

## THE ART OF TREND-JACKING

### What Makes Good Trend-Jacking
1. **Relevance**: The connection should make sense (even if it's a stretch, it should be clever)
2. **Speed**: First to connect a trend to your niche wins
3. **Authenticity**: Don't force it - if it doesn't fit, skip it
4. **Value Add**: Your post should add something to the conversation
5. **Humor**: Unexpected connections that make people smile get shared

### Connection Types
- **Direct**: Trend is already related to your content (easy win)
- **Wordplay**: Name/term can be twisted to fit (Sydney Sweeney + Blazer)
- **Visual**: Your content can be styled to match trend aesthetic
- **Contrast**: Your content is the opposite of the trend (attention-grabbing)
- **Commentary**: Your niche perspective on a general trend

### What NOT to Do
- Don't hijack tragedies or sensitive topics
- Don't force connections that make no sense
- Don't be cringe or try-hard
- Don't ignore the context of why something is trending

### Format Rules
- Lead with the trend hook (people are already primed for it)
- Make the pivot to your content smooth
- End with your value/flex
- Keep it punchy - trending content moves fast

## OUTPUT FORMAT

Return JSON with posts that genuinely connect trends to the user's content.
Rate connection_strength honestly - sometimes a 'stretch' that's clever works better than a forced 'strong' connection.`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body: TrendHijackRequest = await req.json();
    const {
      user_id,
      content_context,
      location = 'US',
      categories = [],
      count = 5
    } = body;

    if (!user_id || !content_context) {
      return new Response(
        JSON.stringify({ error: 'user_id and content_context required' }),
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

    // Fetch trending topics
    let trends: TrendData[] = [];

    // Method 1: Try X API trends endpoint (requires elevated access)
    if (accessToken) {
      try {
        // US WOEID is 23424977
        const woeid = location === 'US' ? '23424977' : '1'; // 1 = worldwide
        const trendsResponse = await fetch(
          `https://api.twitter.com/1.1/trends/place.json?id=${woeid}`,
          {
            headers: { 'Authorization': `Bearer ${accessToken}` }
          }
        );

        if (trendsResponse.ok) {
          const trendsData = await trendsResponse.json();
          if (trendsData[0]?.trends) {
            trends = trendsData[0].trends.map((t: any) => ({
              name: t.name,
              tweet_count: t.tweet_volume,
              category: 'general'
            }));
          }
        }
      } catch (e) {
        console.log('[x-trend-hijack] Trends API not available, using search fallback');
      }
    }

    // Method 2: Search for high-engagement recent content in relevant niches
    if (trends.length === 0 && accessToken) {
      const searchQueries = [
        'viral cars',
        'trending automotive',
        'car twitter',
        'squarebody',
        'restomod',
        'ls swap'
      ];

      for (const query of searchQueries.slice(0, 3)) {
        try {
          const searchResponse = await fetch(
            `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=10&tweet.fields=public_metrics`,
            {
              headers: { 'Authorization': `Bearer ${accessToken}` }
            }
          );

          if (searchResponse.ok) {
            const searchData = await searchResponse.json();
            if (searchData.data) {
              // Extract trending topics from high-engagement tweets
              const highEngagement = searchData.data
                .filter((t: any) => t.public_metrics?.like_count > 100)
                .slice(0, 3);

              for (const tweet of highEngagement) {
                // Extract hashtags or key phrases
                const hashtags = tweet.text.match(/#\w+/g) || [];
                hashtags.forEach((tag: string) => {
                  if (!trends.find(t => t.name === tag)) {
                    trends.push({ name: tag, category: 'automotive' });
                  }
                });
              }
            }
          }
        } catch (e) {
          console.log(`[x-trend-hijack] Search failed for ${query}`);
        }
      }
    }

    // Method 3: Use known current events/trends (fallback)
    if (trends.length < 5) {
      const fallbackTrends = [
        { name: '#SquareBody', category: 'automotive' },
        { name: '#LSSwap', category: 'automotive' },
        { name: '#Restomod', category: 'automotive' },
        { name: '#ClassicCars', category: 'automotive' },
        { name: '#ProjectCar', category: 'automotive' },
        { name: '#CarTwitter', category: 'automotive' },
        { name: '#TruckTuesday', category: 'automotive' },
        { name: '#FlexFriday', category: 'lifestyle' },
        { name: '#Motivation', category: 'lifestyle' },
        { name: '#GlowUp', category: 'lifestyle' }
      ];

      for (const ft of fallbackTrends) {
        if (!trends.find(t => t.name === ft.name)) {
          trends.push(ft);
        }
      }
    }

    // Filter by categories if specified
    if (categories.length > 0) {
      trends = trends.filter(t => !t.category || categories.includes(t.category));
    }

    // Now use AI to generate trend-hijacking content
    const anthropic = new Anthropic();

    let contextDescription = '';
    if (content_context.type === 'vehicle' && content_context.vehicle) {
      const v = content_context.vehicle;
      contextDescription = `${v.year} ${v.make} ${v.model}${v.details ? ` - ${v.details}` : ''}`;
    } else if (content_context.brand) {
      contextDescription = `Brand: ${content_context.brand}`;
    } else if (content_context.topic) {
      contextDescription = content_context.topic;
    }

    const prompt = `Current trending topics on X:
${trends.slice(0, 15).map((t, i) => `${i + 1}. ${t.name}${t.tweet_count ? ` (${t.tweet_count.toLocaleString()} tweets)` : ''}`).join('\n')}

Content to promote:
${contextDescription}
${content_context.images?.length ? `Available images: ${content_context.images.length} photos` : ''}

Generate ${count} posts that cleverly hijack these trends to promote the content.
For each post:
1. Pick a trend that can be connected (even if it's a creative stretch)
2. Write a post that leads with the trend hook, then pivots to the content
3. Make it feel natural, not forced
4. Rate how strong the connection is honestly

Also suggest 2 AI image prompts that could make the content fit trending aesthetics.

Return ONLY valid JSON matching this structure:
{
  "trends_found": [...],
  "generated_posts": [
    {
      "trend": "trend name",
      "text": "the post",
      "angle": "how it connects",
      "connection_strength": "strong|medium|stretch",
      "timing": "when to post",
      "virality_potential": 8.5
    }
  ],
  "image_suggestions": [
    {
      "trend": "trend name",
      "prompt": "AI image prompt",
      "rationale": "why this works"
    }
  ],
  "strategy_notes": "overall strategy advice"
}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: HIJACK_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }]
    });

    const responseText = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map(block => block.text)
      .join('');

    let result: HijackResult;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found');
      }
    } catch {
      throw new Error('Failed to parse trend hijack content');
    }

    // Add the trends we found
    result.trends_found = trends.slice(0, 15);

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[x-trend-hijack] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

/**
 * Capture Insight
 *
 * Captures valuable insights during coding/work sessions.
 * Can auto-post to connected platforms or queue for review.
 *
 * This is the bridge between LIVING and DISTRIBUTION.
 * Human creates by working. System observes. System distributes.
 *
 * Usage:
 *   POST /capture-insight
 *   {
 *     "user_id": "uuid",
 *     "insight": "The actual insight text",
 *     "context": "What was happening when this emerged",
 *     "source": "vibe_coding" | "conversation" | "manual",
 *     "auto_post": true | false,
 *     "platforms": ["x", "threads"]  // Which platforms to post to
 *   }
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface InsightRequest {
  user_id: string;
  insight: string;
  context?: string;
  source?: 'vibe_coding' | 'conversation' | 'manual' | 'auto_detected';
  auto_post?: boolean;
  platforms?: string[];
  tags?: string[];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body: InsightRequest = await req.json();
    const {
      user_id,
      insight,
      context,
      source = 'manual',
      auto_post = false,
      platforms = ['x'],
      tags = []
    } = body;

    if (!user_id || !insight) {
      return new Response(
        JSON.stringify({ error: 'user_id and insight are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Store the insight as an observation
    const { data: insightRecord, error: insertError } = await supabase
      .from('insights')
      .insert({
        user_id,
        content: insight,
        context,
        source,
        tags,
        auto_post_requested: auto_post,
        platforms_requested: platforms,
        status: auto_post ? 'pending_post' : 'captured'
      })
      .select('id')
      .single();

    if (insertError) {
      // Table might not exist, create a simpler record
      console.warn('insights table not found, storing as observation');

      await supabase.from('observations').insert({
        entity_type: 'insight',
        entity_fingerprint: `user:${user_id}:${Date.now()}`,
        field_name: 'content',
        field_value: { text: insight, context, source, tags },
        observed_at: new Date().toISOString()
      }).catch(e => console.warn('observations insert failed:', e.message));
    }

    const postResults: any[] = [];

    // Auto-post if requested
    if (auto_post && platforms.length > 0) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

      for (const platform of platforms) {
        if (platform === 'x') {
          // Format for X (280 char limit)
          const tweetText = formatForX(insight, tags);

          try {
            const postResponse = await fetch(`${supabaseUrl}/functions/v1/x-post`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${serviceKey}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                user_id,
                text: tweetText
              })
            });

            const postData = await postResponse.json();

            if (postData.success) {
              postResults.push({
                platform: 'x',
                success: true,
                url: postData.url,
                tweet_id: postData.tweet_id
              });
            } else {
              postResults.push({
                platform: 'x',
                success: false,
                error: postData.error
              });
            }
          } catch (e: any) {
            postResults.push({
              platform: 'x',
              success: false,
              error: e.message
            });
          }
        }

        // Add other platforms here (threads, linkedin, etc.)
      }

      // Update insight status
      if (insightRecord?.id) {
        await supabase
          .from('insights')
          .update({
            status: 'posted',
            post_results: postResults,
            posted_at: new Date().toISOString()
          })
          .eq('id', insightRecord.id)
          .catch(() => {});
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        insight_id: insightRecord?.id,
        auto_posted: auto_post,
        post_results: postResults.length > 0 ? postResults : undefined,
        message: auto_post
          ? `Insight captured and posted to ${platforms.join(', ')}`
          : 'Insight captured'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[capture-insight] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

/**
 * Format insight for X (Twitter)
 * - Max 280 characters
 * - Add relevant hashtags if space
 * - Truncate intelligently if needed
 */
function formatForX(insight: string, tags: string[] = []): string {
  const MAX_LENGTH = 280;

  // Clean up the insight
  let text = insight.trim();

  // Add hashtags if we have room
  const hashtags = tags
    .map(t => `#${t.replace(/\s+/g, '').replace(/^#/, '')}`)
    .join(' ');

  if (hashtags && text.length + hashtags.length + 2 <= MAX_LENGTH) {
    text = `${text}\n\n${hashtags}`;
  }

  // Truncate if still too long
  if (text.length > MAX_LENGTH) {
    // Try to break at a sentence
    const truncated = text.substring(0, MAX_LENGTH - 3);
    const lastSentence = truncated.lastIndexOf('. ');
    const lastNewline = truncated.lastIndexOf('\n');
    const breakPoint = Math.max(lastSentence, lastNewline);

    if (breakPoint > MAX_LENGTH * 0.6) {
      text = truncated.substring(0, breakPoint + 1);
    } else {
      // Break at word boundary
      const lastSpace = truncated.lastIndexOf(' ');
      text = truncated.substring(0, lastSpace) + '...';
    }
  }

  return text;
}

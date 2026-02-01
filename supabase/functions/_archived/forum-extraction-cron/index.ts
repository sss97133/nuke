/**
 * FORUM-EXTRACTION-CRON
 *
 * Scheduled function for continuous forum extraction.
 * Run via pg_cron or external scheduler every 15 minutes.
 *
 * Actions:
 * 1. Extract posts from discovered threads
 * 2. Flow completed posts to vehicle_observations
 * 3. Re-discover threads from active forums periodically
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const BATCH_SIZE = 15;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const startTime = Date.now();
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const results = {
    threads_extracted: 0,
    posts_created: 0,
    observations_created: 0,
    duration_ms: 0,
    errors: [] as string[],
  };

  async function callFunction(name: string, payload: any): Promise<any> {
    try {
      const resp = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(55000),
      });
      return await resp.json();
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }

  try {
    // =========================================================================
    // PHASE 1: Extract posts from queued threads
    // =========================================================================
    const { data: threads } = await supabase
      .from('build_threads')
      .select('id, thread_url, thread_title')
      .in('extraction_status', ['discovered', 'queued'])
      .order('created_at', { ascending: true })
      .limit(BATCH_SIZE);

    console.log(`[cron] Found ${threads?.length || 0} threads to extract`);

    for (const thread of threads || []) {
      const result = await callFunction('extract-build-posts', {
        thread_id: thread.id,
        max_pages: 10,
      });

      if (result.success) {
        results.threads_extracted++;
        results.posts_created += result.posts_count || 0;
        console.log(`[cron] Extracted ${result.posts_count || 0} posts from: ${thread.thread_title?.slice(0, 40)}`);
      } else {
        results.errors.push(`${thread.id}: ${result.error || 'unknown'}`);
      }

      // Small delay between extractions
      await new Promise(r => setTimeout(r, 1000));
    }

    // =========================================================================
    // PHASE 2: Flow posts to observations
    // =========================================================================
    const { data: unmappedPosts } = await supabase
      .from('build_posts')
      .select(`
        id, content_text, posted_at, images, post_number, image_count,
        build_thread_id
      `)
      .is('observation_id', null)
      .not('content_text', 'is', null)
      .limit(100);

    console.log(`[cron] Found ${unmappedPosts?.length || 0} posts to map to observations`);

    for (const post of unmappedPosts || []) {
      // Get thread info
      const { data: thread } = await supabase
        .from('build_threads')
        .select('thread_url, vehicle_id, vehicle_hints, forum_source_id')
        .eq('id', post.build_thread_id)
        .single();

      if (!thread) continue;

      // Get forum info
      const { data: forum } = await supabase
        .from('forum_sources')
        .select('slug, name')
        .eq('id', thread.forum_source_id)
        .single();

      // Insert observation
      const { data: obs, error: obsError } = await supabase
        .from('vehicle_observations')
        .insert({
          source_slug: forum?.slug || 'forum-unknown',
          kind: 'forum_post',
          observed_at: post.posted_at || new Date().toISOString(),
          source_url: thread.thread_url,
          source_identifier: `post-${post.post_number}`,
          content_text: post.content_text?.slice(0, 10000),
          structured_data: {
            post_number: post.post_number,
            is_original_post: post.post_number === 1,
            image_count: post.image_count || post.images?.length || 0,
          },
          vehicle_id: thread.vehicle_id || null,
          vehicle_hints: thread.vehicle_hints || null,
        })
        .select('id')
        .single();

      if (obs?.id) {
        // Link back to build_post
        await supabase
          .from('build_posts')
          .update({ observation_id: obs.id })
          .eq('id', post.id);

        results.observations_created++;
      }
    }

    results.duration_ms = Date.now() - startTime;

    console.log(`[cron] Complete: ${results.threads_extracted} threads, ${results.posts_created} posts, ${results.observations_created} observations in ${results.duration_ms}ms`);

    return new Response(JSON.stringify({
      success: true,
      ...results,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[cron] Fatal error:', error);
    results.duration_ms = Date.now() - startTime;

    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      ...results,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  console.log('Mapping posts to observations...');
  let mapped = 0;
  
  // Get posts from threads that have vehicle_id (using inner join)
  const { data: posts } = await supabase
    .from('build_posts')
    .select(`
      id, content_text, posted_at, post_number, image_count, build_thread_id,
      thread:build_threads!inner(thread_url, vehicle_id, vehicle_hints, forum_source_id)
    `)
    .is('observation_id', null)
    .not('content_text', 'is', null)
    .not('build_threads.vehicle_id', 'is', null)
    .limit(500);

  console.log('Processing', posts?.length || 0, 'posts with matched vehicles...');

  for (const post of posts || []) {
    const thread = post.thread;
    if (!thread || !thread.vehicle_id) continue;
    
    const { data: forum } = await supabase
      .from('forum_sources')
      .select('slug')
      .eq('id', thread.forum_source_id)
      .single();
    
    // Get or create observation source for this forum
    let sourceId = null;
    const { data: existingSource } = await supabase
      .from('observation_sources')
      .select('id')
      .eq('slug', forum?.slug || 'forum-unknown')
      .single();

    if (existingSource) {
      sourceId = existingSource.id;
    } else if (forum?.slug) {
      const { data: newSource } = await supabase
        .from('observation_sources')
        .insert({ slug: forum.slug, display_name: forum.slug, category: 'forum' })
        .select('id')
        .single();
      sourceId = newSource?.id;
    }

    const { data: obs, error } = await supabase
      .from('vehicle_observations')
      .insert({
        source_id: sourceId,
        kind: 'comment',  // Using 'comment' from observation_kind enum
        observed_at: post.posted_at || new Date().toISOString(),
        source_url: thread.thread_url,
        source_identifier: 'post-' + post.post_number,
        content_text: post.content_text?.slice(0, 5000),
        structured_data: { post_number: post.post_number, image_count: post.image_count || 0 },
        vehicle_id: thread.vehicle_id,
      })
      .select('id')
      .single();

    if (error) {
      if (mapped === 0) console.log('Insert error:', error.message, error.details);
    } else if (obs?.id) {
      await supabase.from('build_posts').update({ observation_id: obs.id }).eq('id', post.id);
      mapped++;
      if (mapped % 100 === 0) console.log('  Mapped', mapped);
    }
  }
  
  console.log('Done. Mapped', mapped, 'posts to observations');
}

main().catch(console.error);

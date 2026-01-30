#!/usr/bin/env node
/**
 * Link forum posts to external identities
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function main() {
  // Get unlinked posts
  const { data: posts } = await supabase
    .from('build_posts')
    .select('id, author_handle, author_profile_url, build_thread_id')
    .is('external_identity_id', null)
    .limit(10000);

  console.log('Posts to link:', posts?.length || 0);

  if (!posts || posts.length === 0) {
    console.log('No posts to link');
    return;
  }

  // Group by author
  const byAuthor = {};
  for (const p of posts) {
    if (!p.author_handle) continue;
    byAuthor[p.author_handle] = byAuthor[p.author_handle] || {
      profile_url: p.author_profile_url,
      post_ids: []
    };
    byAuthor[p.author_handle].post_ids.push(p.id);
  }

  console.log('Unique authors:', Object.keys(byAuthor).length);

  // For each author, check if identity exists
  let linked = 0;
  let created = 0;

  for (const [handle, data] of Object.entries(byAuthor)) {
    // Get platform from URL
    let platform = 'forum';
    if (data.profile_url) {
      const match = data.profile_url.match(/https?:\/\/(?:www\.)?([^./]+)/);
      if (match) {
        platform = match[1];
      }
    }

    // Check for existing identity
    const { data: existing } = await supabase
      .from('external_identities')
      .select('id')
      .eq('platform', platform)
      .eq('handle', handle)
      .maybeSingle();

    let identityId = existing?.id;

    if (!identityId) {
      // Try to insert directly (may fail if trigger exists)
      const { data: inserted, error } = await supabase
        .from('external_identities')
        .insert({
          platform,
          handle,
          profile_url: data.profile_url,
          first_seen_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (error) {
        // Try with 'bat' platform as workaround (hack but works)
        console.log(`Could not create identity for ${handle}: ${error.message}`);
        continue;
      }

      identityId = inserted?.id;
      created++;
    }

    if (identityId) {
      // Link posts
      const { error: updateErr } = await supabase
        .from('build_posts')
        .update({ external_identity_id: identityId })
        .in('id', data.post_ids);

      if (!updateErr) {
        linked += data.post_ids.length;
      }
    }
  }

  console.log('Identities created:', created);
  console.log('Posts linked:', linked);
}

main();

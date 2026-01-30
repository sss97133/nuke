#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const slug = process.argv[2] || 'rennlist';

async function main() {
  // Get forum
  const { data: forum } = await supabase
    .from('forum_sources')
    .select('id, slug, dom_map')
    .eq('slug', slug)
    .single();

  if (!forum) {
    console.log('Forum not found:', slug);
    return;
  }

  console.log('Forum:', forum.slug);
  console.log('Build sections:', forum.dom_map?.build_sections?.length || 0);

  if (forum.dom_map?.build_sections) {
    for (const section of forum.dom_map.build_sections) {
      console.log('  -', section.name, ':', section.url);
    }
  }

  // Call discover
  console.log('\nCalling discover-build-threads...');
  const response = await fetch(`${SUPABASE_URL}/functions/v1/discover-build-threads`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ forum_id: forum.id, max_pages: 2 }),
  });

  const result = await response.json();
  console.log('Result:', JSON.stringify(result, null, 2));
}

main();

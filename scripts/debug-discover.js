#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import { DOMParser } from 'linkedom';
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

  const section = forum.dom_map?.build_sections?.[0];
  if (!section) {
    console.log('No build sections');
    return;
  }

  console.log('Testing section:', section.url);
  console.log('Selectors:', JSON.stringify(forum.dom_map.thread_list_selectors, null, 2));

  // Fetch the page
  const response = await fetch(section.url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    },
  });

  const html = await response.text();
  console.log('\nHTML length:', html.length);

  // Parse with linkedom (same as the function uses)
  const { document } = new DOMParser().parseFromString(html, 'text/html');

  const selectors = forum.dom_map.thread_list_selectors;

  // Try container
  console.log('\n--- Testing selectors ---');
  const containers = selectors.container.split(',').map(s => s.trim());
  for (const sel of containers) {
    const el = document.querySelector(sel);
    console.log(`Container "${sel}": ${el ? 'FOUND' : 'not found'}`);
  }

  // Try thread rows
  const rows = selectors.thread_row.split(',').map(s => s.trim());
  for (const sel of rows) {
    const els = document.querySelectorAll(sel);
    console.log(`Row "${sel}": ${els.length} found`);
  }

  // Try thread links
  const links = selectors.thread_link.split(',').map(s => s.trim());
  for (const sel of links) {
    const els = document.querySelectorAll(sel);
    console.log(`Link "${sel}": ${els.length} found`);
    if (els.length > 0 && els.length < 5) {
      for (const el of els) {
        console.log(`  - ${el.textContent?.slice(0, 50)} -> ${el.getAttribute('href')}`);
      }
    }
  }

  // Try what we know works from the HTML
  console.log('\n--- Direct tests ---');
  const threadslist = document.querySelector('#threadslist');
  console.log('#threadslist:', threadslist ? 'FOUND' : 'not found');

  const threadbits = document.querySelectorAll('.threadbit');
  console.log('.threadbit:', threadbits.length, 'found');

  const threadTitles = document.querySelectorAll('a[id^="thread_title_"]');
  console.log('a[id^="thread_title_"]:', threadTitles.length, 'found');

  if (threadTitles.length > 0) {
    console.log('\nSample threads:');
    for (let i = 0; i < Math.min(5, threadTitles.length); i++) {
      const t = threadTitles[i];
      console.log(`  ${t.textContent?.slice(0, 60)} -> ${t.getAttribute('href')}`);
    }
  }
}

main();

#!/usr/bin/env node
/**
 * BATCH-STRUCTURE-THREADS (Ollama version)
 *
 * Uses local Ollama instead of OpenAI to extract structured vehicle data.
 *
 * Usage:
 *   node scripts/batch-structure-threads-ollama.js
 *   node scripts/batch-structure-threads-ollama.js --limit=10
 *   node scripts/batch-structure-threads-ollama.js --dry-run
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIMIT = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '50');
const MODEL = args.find(a => a.startsWith('--model='))?.split('=')[1] || 'llama3.1:8b';
const OLLAMA_URL = 'http://localhost:11434/api/chat';
const DELAY_MS = 1000;

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function callOllama(prompt, systemPrompt) {
  const response = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      stream: false,
      options: {
        temperature: 0.3,
        num_predict: 2000,
      }
    }),
  });

  const data = await response.json();
  return data.message?.content || '';
}

function parseJSON(content) {
  // Clean markdown formatting
  let cleaned = content
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();

  // Find JSON object boundaries
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end !== -1) {
    cleaned = cleaned.slice(start, end + 1);
  }

  return JSON.parse(cleaned);
}

async function main() {
  console.log('═'.repeat(60));
  console.log('BATCH STRUCTURE BUILD THREADS (Ollama)');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'} | Limit: ${LIMIT} | Model: ${MODEL}`);
  console.log('═'.repeat(60));

  // Get threads that need processing
  const { data: threads, error } = await supabase
    .from('build_threads')
    .select(`
      id, thread_title, thread_url, vehicle_id, post_count, posts_extracted,
      author_handle, forum_source_id,
      forum:forum_sources(name, slug)
    `)
    .eq('extraction_status', 'complete')
    .is('vehicle_id', null)
    .gt('posts_extracted', 5)
    .order('posts_extracted', { ascending: false })
    .limit(LIMIT);

  if (error) {
    console.error('Error fetching threads:', error.message);
    return;
  }

  console.log(`\nFound ${threads?.length || 0} threads to process\n`);

  let processed = 0;
  let vehiclesCreated = 0;
  let errors = 0;

  for (const thread of threads || []) {
    console.log('─'.repeat(60));
    console.log(`Processing: ${thread.thread_title?.slice(0, 50)}...`);
    console.log(`  Forum: ${thread.forum?.name || 'Unknown'}`);
    console.log(`  Posts: ${thread.post_count || '?'}`);
    console.log(`  URL: ${thread.thread_url}`);

    if (DRY_RUN) {
      console.log('  [DRY RUN - would process]');
      processed++;
      continue;
    }

    try {
      // Get posts
      const { data: posts } = await supabase
        .from('build_posts')
        .select('content_text, posted_at, post_number, author_handle')
        .eq('build_thread_id', thread.id)
        .order('post_number', { ascending: true })
        .limit(40);

      if (!posts?.length) {
        console.log('  ✗ No posts found');
        errors++;
        continue;
      }

      // Combine posts
      const postText = posts.map(p =>
        `[${p.posted_at?.split('T')[0] || '?'}] @${p.author_handle || 'anon'}: ${p.content_text?.slice(0, 300) || ''}`
      ).join('\n\n');

      const systemPrompt = `You extract structured vehicle build data from forum threads. Return ONLY valid JSON, no other text.`;

      const prompt = `Analyze this build thread and extract structured data.

FORUM: ${thread.forum?.name || 'Unknown'}
THREAD TITLE: ${thread.thread_title}
AUTHOR: ${thread.author_handle || 'Unknown'}

POSTS:
${postText.slice(0, 8000)}

Return JSON with these fields:
{
  "vehicle": {
    "year": number or "YYYY-YYYY" range,
    "make": "string",
    "model": "string",
    "submodel": "string or null",
    "body_style": "string or null",
    "color": "string or null"
  },
  "build_type": "restoration" | "restomod" | "pro-touring" | "custom" | "maintenance" | "unknown",
  "timeline": [{"date": "YYYY-MM-DD", "event": "description"}],
  "parts_installed": [{"category": "engine|trans|suspension|brakes|interior|exterior|electrical", "name": "part", "brand": "brand or null"}],
  "confidence": 0.0-1.0
}

Return ONLY the JSON object.`;

      const content = await callOllama(prompt, systemPrompt);
      const structured = parseJSON(content);

      // Create vehicle
      const v = structured.vehicle;
      if (!v?.make || !v?.model) {
        console.log('  ✗ Could not identify vehicle');
        errors++;
        continue;
      }

      const yearVal = typeof v.year === 'string' && v.year.includes('-')
        ? parseInt(v.year.split('-')[0])
        : (typeof v.year === 'number' ? v.year : null);

      const { data: newVehicle, error: createError } = await supabase
        .from('vehicles')
        .insert({
          year: yearVal,
          make: v.make,
          model: v.model,
          trim: v.submodel,
          body_style: v.body_style,
          color: v.color,
          status: 'discovered',
          discovery_source: 'forum_build_extraction',
          notes: `Extracted from: ${thread.thread_url}`,
        })
        .select('id')
        .single();

      if (createError) {
        console.log(`  ✗ DB error: ${createError.message}`);
        errors++;
        continue;
      }

      // Link thread to vehicle
      await supabase
        .from('build_threads')
        .update({
          vehicle_id: newVehicle.id,
          vehicle_hints: structured.vehicle,
          extraction_status: 'structured',
        })
        .eq('id', thread.id);

      // Store observation
      await supabase
        .from('vehicle_observations')
        .insert({
          vehicle_id: newVehicle.id,
          kind: 'comment',
          source_url: thread.thread_url,
          content_text: `Build thread: ${thread.thread_title}`,
          structured_data: structured,
          observed_at: posts[0]?.posted_at || new Date().toISOString(),
        });

      processed++;
      vehiclesCreated++;

      console.log(`  ✓ Created vehicle: ${yearVal || '?'} ${v.make} ${v.model}`);
      if (structured.timeline?.length) console.log(`  Timeline: ${structured.timeline.length} events`);
      if (structured.parts_installed?.length) console.log(`  Parts: ${structured.parts_installed.length} items`);
      if (structured.build_type) console.log(`  Build type: ${structured.build_type}`);

    } catch (e) {
      errors++;
      console.log(`  ✗ Error: ${e.message}`);
    }

    await sleep(DELAY_MS);
  }

  console.log('\n' + '═'.repeat(60));
  console.log('RESULTS');
  console.log('═'.repeat(60));
  console.log(`Threads processed:  ${processed}`);
  console.log(`Vehicles created:   ${vehiclesCreated}`);
  console.log(`Errors:             ${errors}`);
}

main().catch(console.error);

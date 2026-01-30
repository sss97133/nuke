#!/usr/bin/env node
/**
 * STRUCTURE-BUILD-TIMELINE
 *
 * Takes a build thread and extracts structured timeline events.
 * Creates vehicle profile if needed.
 *
 * Usage:
 *   node scripts/structure-build-timeline.js --thread="Project Frankensquare"
 */

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY || process.env.NUKE_CLAUDE_API
});

const args = process.argv.slice(2);
const threadTitle = args.find(a => a.startsWith('--thread='))?.split('=')[1];

async function main() {
  if (!threadTitle) {
    console.log('Usage: node scripts/structure-build-timeline.js --thread="Thread Title"');
    return;
  }

  console.log(`\nProcessing: "${threadTitle}"\n`);

  // Get thread
  const { data: thread } = await supabase
    .from('build_threads')
    .select('id, thread_title, thread_url, vehicle_id, vehicle_hints')
    .ilike('thread_title', `%${threadTitle}%`)
    .single();

  if (!thread) {
    console.log('Thread not found');
    return;
  }

  console.log(`Found thread: ${thread.thread_title}`);
  console.log(`URL: ${thread.thread_url}`);
  console.log(`Current vehicle_id: ${thread.vehicle_id || 'none'}\n`);

  // Get posts
  const { data: posts } = await supabase
    .from('build_posts')
    .select('content_text, posted_at, post_number')
    .eq('build_thread_id', thread.id)
    .order('post_number', { ascending: true })
    .limit(50);

  console.log(`Loaded ${posts?.length || 0} posts\n`);

  // Combine posts for AI analysis
  const postText = posts?.map(p =>
    `[${p.posted_at?.split('T')[0] || 'unknown date'}] ${p.content_text?.slice(0, 500) || ''}`
  ).join('\n\n---\n\n');

  // Use Claude to extract structured data
  console.log('Analyzing with AI...\n');

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `Analyze this forum build thread and extract structured data.

THREAD TITLE: ${thread.thread_title}

POSTS:
${postText}

Extract and return JSON with:
1. vehicle: {year, make, model, submodel, body_style} - best guess from context
2. timeline: array of {date, event, parts_mentioned, cost_mentioned}
3. parts_used: array of {name, source, cost}
4. donors: array of {year, make, model, parts_taken}
5. problems_encountered: array of strings
6. vendors_mentioned: array of strings

Be specific. If year is unknown, estimate range like "1973-1987" for squarebody.
Return ONLY valid JSON, no markdown.`
    }]
  });

  const jsonText = response.content[0].text;
  let structured;
  try {
    structured = JSON.parse(jsonText);
  } catch (e) {
    console.log('AI response:', jsonText);
    console.log('\nFailed to parse JSON');
    return;
  }

  console.log('═'.repeat(60));
  console.log('EXTRACTED VEHICLE DATA');
  console.log('═'.repeat(60));
  console.log(JSON.stringify(structured.vehicle, null, 2));

  console.log('\n═'.repeat(60));
  console.log('TIMELINE');
  console.log('═'.repeat(60));
  for (const event of structured.timeline || []) {
    console.log(`${event.date}: ${event.event}`);
    if (event.parts_mentioned?.length) console.log(`  Parts: ${event.parts_mentioned.join(', ')}`);
    if (event.cost_mentioned) console.log(`  Cost: ${event.cost_mentioned}`);
  }

  console.log('\n═'.repeat(60));
  console.log('PARTS USED');
  console.log('═'.repeat(60));
  for (const part of structured.parts_used || []) {
    console.log(`- ${part.name}${part.source ? ` (from ${part.source})` : ''}${part.cost ? ` - ${part.cost}` : ''}`);
  }

  console.log('\n═'.repeat(60));
  console.log('DONOR VEHICLES');
  console.log('═'.repeat(60));
  for (const donor of structured.donors || []) {
    console.log(`- ${donor.year} ${donor.make} ${donor.model}: ${donor.parts_taken}`);
  }

  console.log('\n═'.repeat(60));
  console.log('VENDORS MENTIONED');
  console.log('═'.repeat(60));
  console.log((structured.vendors_mentioned || []).join(', ') || 'None identified');

  // Create vehicle profile if none exists
  if (!thread.vehicle_id && structured.vehicle) {
    console.log('\n═'.repeat(60));
    console.log('CREATING VEHICLE PROFILE');
    console.log('═'.repeat(60));

    const v = structured.vehicle;
    const yearVal = typeof v.year === 'string' && v.year.includes('-')
      ? parseInt(v.year.split('-')[0])
      : v.year;

    const { data: newVehicle, error } = await supabase
      .from('vehicles')
      .insert({
        year: yearVal || null,
        make: v.make || 'Unknown',
        model: v.model || 'Unknown',
        trim: v.submodel || null,
        body_style: v.body_style || null,
        status: 'discovered',
        discovery_source: 'forum_ai_extraction',
        notes: `Extracted from forum thread: ${thread.thread_url}`,
      })
      .select('id, year, make, model')
      .single();

    if (newVehicle) {
      console.log(`Created: ${newVehicle.year || '?'} ${newVehicle.make} ${newVehicle.model}`);
      console.log(`ID: ${newVehicle.id}`);

      // Link thread to vehicle
      await supabase
        .from('build_threads')
        .update({
          vehicle_id: newVehicle.id,
          vehicle_hints: structured.vehicle
        })
        .eq('id', thread.id);

      console.log('Linked thread to vehicle');

      // Store structured data as observation
      await supabase
        .from('vehicle_observations')
        .insert({
          vehicle_id: newVehicle.id,
          kind: 'build_timeline',
          source_url: thread.thread_url,
          content_text: JSON.stringify(structured, null, 2),
          structured_data: structured,
          observed_at: posts?.[0]?.posted_at || new Date().toISOString(),
        });

      console.log('Stored structured timeline as observation');
    } else {
      console.log('Error creating vehicle:', error?.message);
    }
  }
}

main().catch(console.error);

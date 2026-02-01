#!/usr/bin/env npx tsx
/**
 * Forensics Matcher
 *
 * Takes local forensics results and matches them to database records.
 * Updates auction_events with video timestamps.
 *
 * Usage:
 *   npx tsx scripts/forensics-match.ts <results-json> <video-url>
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface LocalResult {
  lot_number: string;
  vehicle: string;
  outcome: string;
  final_price: number;
  start_time: number;
  end_time: number;
}

interface MatchResult {
  local: LocalResult;
  matched: {
    id: string;
    lot_number: string;
    vehicle_id: string;
    winning_bid: number | null;
  } | null;
  confidence: 'high' | 'medium' | 'low' | 'none';
}

function parseVehicle(desc: string): { year: number | null; make: string | null; model: string | null } {
  // Parse "1963 Corvette Split Window Coupe" -> { year: 1963, make: "Chevrolet", model: "Corvette" }
  const yearMatch = desc.match(/\b(19[0-9]{2}|20[0-2][0-9])\b/);
  const year = yearMatch ? parseInt(yearMatch[1]) : null;

  // Common mappings
  const makePatterns: Record<string, string> = {
    'corvette': 'Chevrolet',
    'camaro': 'Chevrolet',
    'mustang': 'Ford',
    'gt500': 'Ford',
    'gt350': 'Ford',
    'riviera': 'Buick',
    'continental': 'Lincoln',
    'trans am': 'Pontiac',
    'firebird': 'Pontiac',
    'ferrari': 'Ferrari',
    'porsche': 'Porsche',
  };

  let make: string | null = null;
  let model: string | null = null;

  const lowerDesc = desc.toLowerCase();
  for (const [pattern, makeName] of Object.entries(makePatterns)) {
    if (lowerDesc.includes(pattern)) {
      make = makeName;
      model = pattern.charAt(0).toUpperCase() + pattern.slice(1);
      break;
    }
  }

  return { year, make, model };
}

async function findMatches(results: LocalResult[], auctionDate?: string): Promise<MatchResult[]> {
  const matches: MatchResult[] = [];

  for (const result of results) {
    const { year, make, model } = parseVehicle(result.vehicle);

    let matchResult: MatchResult = {
      local: result,
      matched: null,
      confidence: 'none',
    };

    if (!year || !make) {
      matches.push(matchResult);
      continue;
    }

    // Try to find by year + make + price match
    const priceMin = result.final_price * 0.95;
    const priceMax = result.final_price * 1.05;

    const query = supabase
      .from('auction_events')
      .select(`
        id, lot_number, vehicle_id, winning_bid,
        vehicles!inner(year, make, model)
      `)
      .eq('vehicles.year', year)
      .ilike('vehicles.make', `%${make}%`)
      .gte('winning_bid', priceMin)
      .lte('winning_bid', priceMax);

    if (auctionDate) {
      query.eq('auction_start_date', auctionDate);
    }

    const { data: rows } = await query.limit(5);

    if (rows && rows.length > 0) {
      // Find best match
      const exactPrice = rows.find(r => r.winning_bid === result.final_price);
      const bestMatch = exactPrice || rows[0];

      matchResult = {
        local: result,
        matched: {
          id: bestMatch.id,
          lot_number: bestMatch.lot_number,
          vehicle_id: bestMatch.vehicle_id,
          winning_bid: bestMatch.winning_bid,
        },
        confidence: exactPrice ? 'high' : (rows.length === 1 ? 'medium' : 'low'),
      };
    }

    matches.push(matchResult);
  }

  return matches;
}

async function updateTimestamps(matches: MatchResult[], videoUrl: string) {
  let updated = 0;

  for (const match of matches) {
    if (!match.matched || match.confidence === 'none') continue;

    // Only update high/medium confidence matches
    if (match.confidence === 'low') {
      console.log(`⚠️ Skipping low confidence: ${match.local.vehicle}`);
      continue;
    }

    const { error } = await supabase
      .from('auction_events')
      .update({
        broadcast_video_url: videoUrl,
        broadcast_timestamp_start: match.local.start_time,
        broadcast_timestamp_end: match.local.end_time,
      })
      .eq('id', match.matched.id);

    if (!error) {
      updated++;
      console.log(`✅ Updated ${match.matched.lot_number}: ${match.local.vehicle}`);
      console.log(`   → ${videoUrl}?t=${match.local.start_time}s`);
    } else {
      console.log(`❌ Failed to update: ${error.message}`);
    }
  }

  return updated;
}

async function main() {
  const resultsPath = process.argv[2];
  const videoUrl = process.argv[3];

  if (!resultsPath || !videoUrl) {
    console.log('\nForensics Matcher\n');
    console.log('Usage: npx tsx scripts/forensics-match.ts <results.json> <video-url>\n');
    console.log('Example:');
    console.log('  npx tsx scripts/forensics-match.ts /tmp/forensics-local/video_lots.json "https://youtube.com/watch?v=xxx"\n');
    process.exit(0);
  }

  // Load results
  const results: LocalResult[] = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'));

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  FORENSICS MATCHER');
  console.log('═══════════════════════════════════════════════════════════════\n');
  console.log(`Video: ${videoUrl}`);
  console.log(`Results: ${results.length} lots\n`);

  // Find matches
  console.log('🔍 Finding database matches...\n');
  const matches = await findMatches(results);

  // Show results
  const highConf = matches.filter(m => m.confidence === 'high');
  const medConf = matches.filter(m => m.confidence === 'medium');
  const lowConf = matches.filter(m => m.confidence === 'low');
  const noMatch = matches.filter(m => m.confidence === 'none');

  console.log(`Match Results:`);
  console.log(`  High confidence: ${highConf.length}`);
  console.log(`  Medium confidence: ${medConf.length}`);
  console.log(`  Low confidence: ${lowConf.length}`);
  console.log(`  No match: ${noMatch.length}\n`);

  for (const match of matches) {
    const icon = {
      high: '✅',
      medium: '🟡',
      low: '⚠️',
      none: '❌',
    }[match.confidence];

    console.log(`${icon} ${match.local.vehicle} - $${match.local.final_price.toLocaleString()}`);
    if (match.matched) {
      console.log(`   → Lot ${match.matched.lot_number} (DB: $${match.matched.winning_bid?.toLocaleString()})`);
    } else {
      console.log(`   → No match found`);
    }
  }

  // Update database
  if (highConf.length + medConf.length > 0) {
    console.log('\n───────────────────────────────────────────────────────────────');
    console.log('Updating database with video timestamps...\n');
    const updated = await updateTimestamps(matches, videoUrl);
    console.log(`\n✅ Updated ${updated} records`);
  }

  console.log('\n───────────────────────────────────────────────────────────────\n');
}

main();

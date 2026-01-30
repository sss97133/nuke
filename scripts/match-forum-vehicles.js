#!/usr/bin/env node
/**
 * MATCH-FORUM-VEHICLES
 *
 * Matches build_threads to vehicles table using vehicle_hints.
 * Two strategies:
 * 1. Exact match: year + make + model
 * 2. Create new: If no match, create vehicle from hints
 *
 * Usage:
 *   node scripts/match-forum-vehicles.js
 *   node scripts/match-forum-vehicles.js --create-missing
 *   node scripts/match-forum-vehicles.js --dry-run
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
const CREATE_MISSING = args.includes('--create-missing');

// Make normalization for matching
function normalizeMake(make) {
  if (!make) return null;
  const m = make.toLowerCase().trim();
  const aliases = {
    'chevy': 'chevrolet',
    'vw': 'volkswagen',
    'merc': 'mercedes-benz',
    'mercedes': 'mercedes-benz',
    'olds': 'oldsmobile',
  };
  return aliases[m] || m;
}

// Model normalization
function normalizeModel(model) {
  if (!model) return null;
  return model.toLowerCase().trim()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ');
}

// Infer make from forum categories or thread title
function inferMake(thread, forum) {
  // Check forum vehicle_makes
  if (forum?.vehicle_makes?.length === 1) {
    return forum.vehicle_makes[0];
  }

  // Check title for common makes
  const title = thread.thread_title?.toLowerCase() || '';
  const makes = [
    'chevrolet', 'chevy', 'ford', 'dodge', 'plymouth', 'pontiac',
    'buick', 'oldsmobile', 'cadillac', 'gmc', 'amc', 'jeep',
    'porsche', 'bmw', 'mercedes', 'audi', 'volkswagen', 'vw',
    'ferrari', 'lamborghini', 'lotus', 'jaguar', 'triumph', 'mg',
    'toyota', 'datsun', 'nissan', 'honda', 'mazda', 'subaru'
  ];

  for (const make of makes) {
    if (title.includes(make)) {
      return make.charAt(0).toUpperCase() + make.slice(1);
    }
  }

  return null;
}

// Infer model from title
function inferModel(title) {
  if (!title) return null;
  const t = title.toLowerCase();

  const models = [
    'camaro', 'corvette', 'chevelle', 'nova', 'impala', 'c10', 'k10', 'blazer',
    'mustang', 'bronco', 'f100', 'f150', 'falcon', 'fairlane',
    'challenger', 'charger', 'cuda', 'barracuda', 'dart', 'duster',
    'firebird', 'trans am', 'gto', 'lemans',
    '911', '912', '914', '356', 'boxster', 'cayman',
    '240z', '260z', '280z', 'rx7', 'rx-7', 'miata', 'mx5', 'mx-5',
    's2000', 'nsx', 'integra', 'civic', 'crx'
  ];

  for (const model of models) {
    if (t.includes(model)) {
      return model.toUpperCase();
    }
  }

  return null;
}

async function main() {
  console.log('='.repeat(60));
  console.log('VEHICLE MATCHING');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'} | Create missing: ${CREATE_MISSING}`);
  console.log('='.repeat(60));

  // Get unmatched threads with hints
  const { data: threads } = await supabase
    .from('build_threads')
    .select(`
      id, thread_title, vehicle_hints, forum_source_id,
      forum:forum_sources(slug, vehicle_makes)
    `)
    .is('vehicle_id', null)
    .not('vehicle_hints', 'eq', '{}')
    .limit(500);

  console.log(`\nFound ${threads?.length || 0} threads to match\n`);

  let matched = 0, created = 0, failed = 0;

  for (const thread of threads || []) {
    const hints = thread.vehicle_hints || {};
    const forum = thread.forum;

    // Build search criteria
    let year = hints.year;
    let make = hints.make || inferMake(thread, forum);
    let model = hints.model || inferModel(thread.thread_title);

    if (!year) {
      failed++;
      continue; // Need at least year
    }

    // Normalize
    const normMake = normalizeMake(make);
    const normModel = normalizeModel(model);

    // Try to find matching vehicle
    let query = supabase
      .from('vehicles')
      .select('id, year, make, model')
      .eq('year', year);

    if (normMake) {
      query = query.ilike('make', `%${normMake}%`);
    }
    if (normModel) {
      query = query.ilike('model', `%${normModel}%`);
    }

    const { data: matches } = await query.limit(5);

    if (matches?.length > 0) {
      // Use first match
      const vehicle = matches[0];

      if (!DRY_RUN) {
        const { error: updateError } = await supabase
          .from('build_threads')
          .update({ vehicle_id: vehicle.id })
          .eq('id', thread.id);
        if (updateError) {
          console.log(`  Update error for thread ${thread.id}: ${updateError.message}`);
        }
      }

      matched++;
      if (matched <= 10 || matched % 50 === 0) {
        console.log(`✓ Matched: "${thread.thread_title?.slice(0, 40)}..." → ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
      }
    } else if (CREATE_MISSING && make && model) {
      // Create new vehicle
      if (!DRY_RUN) {
        const { data: newVehicle, error } = await supabase
          .from('vehicles')
          .insert({
            year: year,
            make: make,
            model: model,
            status: 'pending',
            source: 'forum_extraction',
          })
          .select('id')
          .single();

        if (newVehicle?.id) {
          await supabase
            .from('build_threads')
            .update({ vehicle_id: newVehicle.id })
            .eq('id', thread.id);
          created++;
        }
      } else {
        created++;
      }

      if (created <= 5) {
        console.log(`+ Would create: ${year} ${make} ${model}`);
      }
    } else {
      failed++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('RESULTS');
  console.log('='.repeat(60));
  console.log(`Matched to existing: ${matched}`);
  console.log(`Created new:         ${created}`);
  console.log(`Failed (no data):    ${failed}`);
  console.log(`Total processed:     ${matched + created + failed}`);

  if (DRY_RUN) {
    console.log('\n[DRY RUN - no changes made]');
  }
}

main().catch(console.error);

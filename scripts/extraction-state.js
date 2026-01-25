#!/usr/bin/env node
/**
 * Extraction State Manager
 *
 * Provides persistent state for zero-context agents.
 * Writes state to a JSON file and optionally to scraping_health.
 *
 * Usage:
 *   node extraction-state.js write <source> <processed> <errors> [message]
 *   node extraction-state.js read
 *   node extraction-state.js summary
 */

import { writeFileSync, readFileSync, existsSync } from 'fs';

const STATE_FILE = '/Users/skylar/nuke/.extraction-state.json';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function loadState() {
  if (existsSync(STATE_FILE)) {
    try {
      return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    } catch (e) {
      return { sources: {}, last_updated: null };
    }
  }
  return { sources: {}, last_updated: null };
}

function saveState(state) {
  state.last_updated = new Date().toISOString();
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function getDbCounts(source) {
  const pending = await fetch(
    `${SUPABASE_URL}/rest/v1/vehicles?discovery_source=eq.${source}&status=eq.pending&select=id&limit=1`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Prefer': 'count=exact' } }
  );
  const active = await fetch(
    `${SUPABASE_URL}/rest/v1/vehicles?discovery_source=eq.${source}&status=eq.active&select=id&limit=1`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Prefer': 'count=exact' } }
  );
  const events = await fetch(
    `${SUPABASE_URL}/rest/v1/auction_events?source=eq.${source}&select=id&limit=1`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Prefer': 'count=exact' } }
  );

  return {
    pending: parseInt(pending.headers.get('content-range')?.split('/')[1] || '0'),
    active: parseInt(active.headers.get('content-range')?.split('/')[1] || '0'),
    events: parseInt(events.headers.get('content-range')?.split('/')[1] || '0'),
  };
}

async function writeState(source, processed, errors, message) {
  const state = loadState();

  if (!state.sources[source]) {
    state.sources[source] = {
      total_processed: 0,
      total_errors: 0,
      sessions: [],
    };
  }

  const s = state.sources[source];
  s.total_processed += processed;
  s.total_errors += errors;
  s.last_run = new Date().toISOString();
  s.last_message = message;

  // Get current DB counts
  const counts = await getDbCounts(source);
  s.db_pending = counts.pending;
  s.db_active = counts.active;
  s.db_events = counts.events;

  // Keep last 10 session logs
  s.sessions.unshift({
    timestamp: new Date().toISOString(),
    processed,
    errors,
    message,
    db: counts,
  });
  s.sessions = s.sessions.slice(0, 10);

  saveState(state);
  console.log(`State updated for ${source}: +${processed} processed, +${errors} errors`);
}

async function readState() {
  const state = loadState();
  console.log(JSON.stringify(state, null, 2));
}

async function summary() {
  const state = loadState();
  const sources = ['bat', 'carsandbids', 'mecum', 'hagerty', 'pcarmarket', 'hemmings'];

  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  EXTRACTION STATE (Persistent)                             ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  if (state.last_updated) {
    console.log(`Last updated: ${state.last_updated}\n`);
  }

  for (const source of sources) {
    const s = state.sources[source];
    const counts = await getDbCounts(source);

    console.log(`${source.toUpperCase()}`);
    if (s) {
      console.log(`  Total processed: ${s.total_processed}`);
      console.log(`  Total errors:    ${s.total_errors}`);
      console.log(`  Last run:        ${s.last_run || 'never'}`);
    } else {
      console.log(`  No extraction history`);
    }
    console.log(`  DB pending:      ${counts.pending}`);
    console.log(`  DB active:       ${counts.active}`);
    console.log(`  DB events:       ${counts.events}`);
    console.log('');
  }

  console.log('AGENT PICKUP POINTS:');
  console.log('═'.repeat(50));
  for (const source of sources) {
    const counts = await getDbCounts(source);
    if (counts.pending > 0) {
      console.log(`  ${source}: ${counts.pending} pending - run extraction`);
    }
  }
}

// CLI
const [,, command, ...args] = process.argv;

switch (command) {
  case 'write':
    const [source, processed, errors, ...msgParts] = args;
    writeState(source, parseInt(processed) || 0, parseInt(errors) || 0, msgParts.join(' ')).catch(console.error);
    break;
  case 'read':
    readState();
    break;
  case 'summary':
  default:
    summary().catch(console.error);
    break;
}

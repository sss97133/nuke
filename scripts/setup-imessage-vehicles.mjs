#!/usr/bin/env node
/**
 * setup-imessage-vehicles.mjs — WS-7 (overnight build 2026-05-03)
 *
 * Generates ~/.nuke-imessage-vehicles.json from existing data.
 *
 * Strategy:
 *   1. Pull known contractor phone numbers from `discovered_persons`
 *      (Joey Patchett, Ernie Wilder/Hotchkiss, Tommy Taylor, Jenny Mannerheim).
 *   2. Open ~/Library/Messages/chat.db read-only.
 *   3. For each contractor's chat_identifier, scan message text + attributedBody
 *      and tally vehicle-keyword hits (K5/Blazer, Mustang, Suburban, K10, K2500…).
 *   4. Map the contact to the vehicle whose keyword set scored highest.
 *      If nothing scored, attribute the contact across Skylar's "all builds" set
 *      with confidence noted in the config (low_confidence flag, picks K5 as
 *      the safest default since it's the heaviest active build).
 *   5. Merge with any existing entries (e.g. Granholm) without clobbering them.
 *   6. Write to ~/.nuke-imessage-vehicles.json with mode 0600.
 *
 * Usage:
 *   dotenvx run -- node scripts/setup-imessage-vehicles.mjs            # write
 *   dotenvx run -- node scripts/setup-imessage-vehicles.mjs --dry-run  # preview
 *
 * Constraints (per workstream WS-7):
 *   - DO NOT modify chat.db (readonly opens only)
 *   - DO NOT post to iMessage
 *   - DO NOT direct-insert vehicle_observations (that's the sync script's job, via ingest-observation)
 *   - Local-only file — never committed
 */

import Database from 'better-sqlite3';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'fs';
import { join } from 'path';
import os from 'os';
import dns from 'dns';

// ── DNS fix (matches imessage-vehicle-sync.mjs) ─────────────────────────────
const resolver = new dns.Resolver();
resolver.setServers(['8.8.8.8', '1.1.1.1']);
const origLookup = dns.lookup.bind(dns);
dns.lookup = function (hostname, options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  resolver.resolve4(hostname, (err, addresses) => {
    if (err || !addresses || addresses.length === 0) return origLookup(hostname, options, callback);
    if (options && options.all) callback(null, addresses.map((a) => ({ address: a, family: 4 })));
    else callback(null, addresses[0], 4);
  });
};
const nodeFetch = (await import('node-fetch')).default;

// ── Args ───────────────────────────────────────────────────────────────────
const DRY_RUN = process.argv.includes('--dry-run');
const VERBOSE = process.argv.includes('--verbose');

// ── Constants ──────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CHAT_DB = join(os.homedir(), 'Library/Messages/chat.db');
const CONFIG_FILE = join(os.homedir(), '.nuke-imessage-vehicles.json');

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (use dotenvx run --).');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { global: { fetch: nodeFetch } });

// Skylar's known build vehicles (resolved from DB during recon).
// K5 is the heaviest active build; Mustang `d24f87d1...` is the highest-observation Mustang.
// These IDs are stable per `vehicles` table on 2026-05-02.
const SKYLAR_VEHICLES = {
  k5: {
    vehicle_id: '93119305-2a50-4886-b471-50e5aa3943a0',
    name: '1977 Chevrolet K5 Blazer Cheyenne Chalet',
    keywords: ['k5', 'blazer', 'chalet', 'cheyenne'],
  },
  mustang: {
    vehicle_id: 'd24f87d1-febd-430a-b865-c5ad87d0ee30',
    name: '1965 Ford Mustang',
    keywords: ['mustang', 'pony', '289', '302', 'fastback'],
  },
  k10: {
    vehicle_id: '0e13a04e-1014-4bb6-a8a8-e52e435c1a40',
    name: '1986 Chevrolet K10 Pickup',
    keywords: ['k10', 'square body', 'squarebody', '86 chevy'],
  },
  suburban: {
    vehicle_id: '1db5daca-526e-42c6-99ae-7faee79b5bad',
    name: '1995 Chevrolet Suburban 2500',
    keywords: ['suburban', '95 sub', 'k1500', 'k2500 sub'],
  },
  granholm_k2500: {
    vehicle_id: 'a90c008a-3379-41d8-9eb2-b4eda365d74c',
    name: '1983 GMC K2500 Sierra Classic',
    keywords: ['k2500', 'sierra', 'granholm'],
  },
};

const FALLBACK_VEHICLE = SKYLAR_VEHICLES.k5; // safest default — heaviest active build

// Apple epoch: nanoseconds since 2001-01-01
const APPLE_EPOCH_OFFSET = 978307200;

// ── Lookup contractor phone numbers ────────────────────────────────────────
async function fetchContractors() {
  const namePatterns = [
    { key: 'joey', label: 'Joey', pattern: '%joey%' },
    { key: 'ernie', label: 'Ernie', pattern: '%ernie%' },
    { key: 'tommy', label: 'Tommy', pattern: '%tommy%' },
    { key: 'jenny', label: 'Jenny Mannerheim', pattern: '%mannerheim%' },
  ];

  const result = [];
  for (const { key, label, pattern } of namePatterns) {
    const { data, error } = await supabase
      .from('discovered_persons')
      .select('id,full_name,phone,primary_role')
      .ilike('full_name', pattern)
      .not('phone', 'is', null);
    if (error) {
      console.warn(`  ! discovered_persons query for ${label} failed: ${error.message}`);
      continue;
    }
    // De-dupe by phone, prefer entries whose name matches our person more strongly.
    const byPhone = new Map();
    for (const row of data || []) {
      // Filter out non-US numbers for Joey/Ernie/Tommy (local contractors)
      // Jenny is dual-country — keep US-only.
      if (key !== 'jenny' && !row.phone.startsWith('+1')) continue;
      if (key === 'jenny' && !row.phone.startsWith('+1')) continue;
      if (!byPhone.has(row.phone)) byPhone.set(row.phone, row);
    }
    for (const row of byPhone.values()) {
      result.push({ key, label, full_name: row.full_name, phone: row.phone });
    }
  }
  return result;
}

// ── Text extraction (mirror of imessage-vehicle-sync.mjs) ──────────────────
function extractTextFromAttributedBody(buf) {
  if (!buf || buf.length < 20) return null;
  const nsIdx = buf.indexOf(Buffer.from('NSString'));
  if (nsIdx === -1) return null;
  const afterNs = buf.slice(nsIdx + 8);
  const str = afterNs.toString('utf-8');
  const classNames = /^(?:NS[A-Z]|__kIM|NSValue|NSDictionary|NSObject|NSNumber|NSMutableString)/;
  const segments = str.split(/[\x00-\x1f\x7f-\x8f]/);
  for (const seg of segments) {
    const trimmed = seg.replace(/^[\x90-\x9f\ufffd+,*]+/, '').replace(/[\x90-\x9f\ufffd]+$/, '').trim();
    if (trimmed.length >= 3 && !classNames.test(trimmed) && trimmed !== '\ufffc') {
      const cleaned = trimmed.replace(/\ufffc/g, '').trim();
      if (cleaned.length >= 3) return cleaned;
    }
  }
  return null;
}

// ── Score chat thread by vehicle keyword hits ──────────────────────────────
function scoreThread(db, chatIdentifier) {
  const stmt = db.prepare(`
    SELECT m.text, m.attributedBody, m.cache_has_attachments, m.is_from_me, m.date
    FROM message m
    INNER JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
    INNER JOIN chat c ON c.ROWID = cmj.chat_id
    WHERE c.chat_identifier = ?
      AND m.associated_message_type = 0
    ORDER BY m.ROWID ASC
  `);
  const rows = stmt.all(chatIdentifier);

  const scores = {};
  for (const k of Object.keys(SKYLAR_VEHICLES)) scores[k] = 0;

  let textHits = 0;
  let total = 0;
  let attachments = 0;

  for (const r of rows) {
    total++;
    if (r.cache_has_attachments) attachments++;
    const text = (r.text || extractTextFromAttributedBody(r.attributedBody) || '').toLowerCase();
    if (!text) continue;
    textHits++;
    for (const [k, v] of Object.entries(SKYLAR_VEHICLES)) {
      for (const kw of v.keywords) {
        // Word-boundary match for short keywords; substring for longer
        const re = kw.length <= 3
          ? new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
          : new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        if (re.test(text)) scores[k] += 1;
      }
    }
  }

  return { scores, total, textHits, attachments };
}

// ── Load existing config (preserve entries we don't manage) ────────────────
function loadExistingConfig() {
  if (!existsSync(CONFIG_FILE)) return [];
  try { return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')); } catch { return []; }
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== setup-imessage-vehicles ===');
  console.log(`  Mode: ${DRY_RUN ? 'DRY RUN' : 'WRITE'}`);
  console.log(`  Config: ${CONFIG_FILE}`);

  // 1. Fetch contractor phone numbers
  console.log('\n[1] Fetching contractor phone numbers from discovered_persons...');
  const contractors = await fetchContractors();
  console.log(`    Found ${contractors.length} contractor entries:`);
  for (const c of contractors) console.log(`      ${c.label.padEnd(18)} ${c.phone.padEnd(15)} ${c.full_name}`);

  if (contractors.length === 0) {
    console.error('  ! No contractors found. Aborting.');
    process.exit(1);
  }

  // 2. Open chat.db
  console.log('\n[2] Opening chat.db (read-only)...');
  let db;
  try {
    db = new Database(CHAT_DB, { readonly: true, fileMustExist: true });
  } catch (e) {
    console.error(`  ! Cannot open ${CHAT_DB}: ${e.message}`);
    console.error('  ! Terminal needs Full Disk Access. System Settings > Privacy > Full Disk Access.');
    process.exit(2);
  }

  // 3. For each contractor, score their thread
  console.log('\n[3] Scoring threads against vehicle keywords...');
  const newEntries = [];
  const skipped = [];

  for (const c of contractors) {
    const { scores, total, textHits, attachments } = scoreThread(db, c.phone);
    const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const [topKey, topScore] = ranked[0];
    const top = SKYLAR_VEHICLES[topKey];

    console.log(`\n  ${c.label} (${c.phone})`);
    console.log(`    messages=${total}  texts=${textHits}  attachments=${attachments}`);
    console.log(`    keyword scores: ${ranked.map(([k, s]) => `${k}=${s}`).join('  ')}`);

    if (total === 0) {
      console.log(`    -> SKIP (no messages in thread)`);
      skipped.push({ contact: c, reason: 'no messages' });
      continue;
    }

    // Pick top-scored vehicle if there's a clear winner
    let target;
    let confidence;
    if (topScore > 0) {
      target = top;
      confidence = topScore >= 5 ? 'high' : topScore >= 2 ? 'medium' : 'low';
    } else {
      // No keyword hits — broad attribution, low confidence, fall back to K5
      target = FALLBACK_VEHICLE;
      confidence = 'low_no_keywords';
      console.log(`    -> No keyword hits. Falling back to ${target.name} (low confidence).`);
    }

    newEntries.push({
      chat_id: c.phone,
      vehicle_id: target.vehicle_id,
      vehicle_name: target.name,
      contact_name: c.full_name,
      _meta: {
        confidence,
        thread_messages: total,
        attachments_in_thread: attachments,
        keyword_scores: scores,
        attribution_method: topScore > 0 ? 'keyword_match' : 'fallback_default_build',
        generated_by: 'setup-imessage-vehicles.mjs',
        generated_at: new Date().toISOString(),
      },
    });

    console.log(`    -> ${target.name}  [confidence=${confidence}]`);
  }

  db.close();

  // 4. Merge with existing config (preserve entries not in our managed phone set)
  console.log('\n[4] Merging with existing config...');
  const existing = loadExistingConfig();
  const newPhones = new Set(newEntries.map((e) => e.chat_id));
  const preserved = existing.filter((e) => !newPhones.has(e.chat_id));
  console.log(`    Existing entries: ${existing.length}`);
  console.log(`    Preserved (not in our managed set): ${preserved.length}`);
  for (const p of preserved) console.log(`      ${p.chat_id} -> ${p.vehicle_name} (${p.contact_name})`);
  console.log(`    New entries (this run): ${newEntries.length}`);

  const finalConfig = [...preserved, ...newEntries];

  // 5. Write
  console.log('\n[5] Writing config...');
  if (DRY_RUN) {
    console.log('    DRY RUN — would write:');
    console.log(JSON.stringify(finalConfig, null, 2));
  } else {
    writeFileSync(CONFIG_FILE, JSON.stringify(finalConfig, null, 2), { mode: 0o600 });
    chmodSync(CONFIG_FILE, 0o600);
    console.log(`    Wrote ${finalConfig.length} entries to ${CONFIG_FILE} (mode 0600).`);
  }

  // Summary
  console.log('\n=== summary ===');
  console.log(`  contractors found:   ${contractors.length}`);
  console.log(`  threads with msgs:   ${newEntries.length}`);
  console.log(`  skipped:             ${skipped.length}`);
  console.log(`  preserved entries:   ${preserved.length}`);
  console.log(`  total config size:   ${finalConfig.length}`);
  if (skipped.length) {
    console.log('  skipped detail:');
    for (const s of skipped) console.log(`    ${s.contact.label} (${s.contact.phone}) — ${s.reason}`);
  }
}

main().catch((e) => {
  console.error(`Fatal: ${e.stack || e.message}`);
  process.exit(1);
});

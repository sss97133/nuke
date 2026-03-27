#!/usr/bin/env node
/**
 * ingest-thread.mjs — Parse iMessage thread into work order timeline
 *
 * Reads the full conversation with a contact from chat.db, extracts:
 * - Price agreements ("$X sounds fair")
 * - Scope changes ("hold off on" / "instead" / "I ordered")
 * - Status updates ("done" / "installed" / "finished")
 * - Photo evidence moments (message + same-day attachment)
 *
 * Each event → vehicle_observations via Supabase.
 *
 * Usage:
 *   dotenvx run -- node mcp-servers/nuke-context/ingest-thread.mjs "+18453002345"
 *   dotenvx run -- node mcp-servers/nuke-context/ingest-thread.mjs "+18453002345" --dry-run
 *   dotenvx run -- node mcp-servers/nuke-context/ingest-thread.mjs "+18453002345" --vehicle <id>
 */

import Database from 'better-sqlite3';
import { createClient } from '@supabase/supabase-js';
import { execSync } from 'child_process';
import { join } from 'path';

// ─── Load env ─────────────────────────────────────────────────────────────────
try {
  const envOutput = execSync('cd /Users/skylar/nuke && dotenvx run -- env', {
    encoding: 'utf-8', timeout: 10000
  });
  for (const line of envOutput.split('\n')) {
    const eq = line.indexOf('=');
    if (eq > 0) process.env[line.slice(0, eq)] = line.slice(eq + 1);
  }
} catch {}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CHAT_DB = join(process.env.HOME, 'Library/Messages/chat.db');
const APPLE_EPOCH_OFFSET = 978307200;

const args = process.argv.slice(2);
const chatId = args.find(a => !a.startsWith('--'));
const flag = name => args.includes(name);
const arg = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const DRY_RUN = flag('--dry-run');
const VEHICLE_ID = arg('--vehicle') || 'a90c008a-3379-41d8-9eb2-b4eda365d74c';

if (!chatId) {
  console.error('Usage: ingest-thread.mjs "+18453002345" [--dry-run] [--vehicle <id>]');
  process.exit(1);
}

// ─── Decode attributedBody ────────────────────────────────────────────────────
function decodeAttributedBody(buf) {
  if (!buf) return null;
  // Find the longest run of printable UTF-8 text — that's the message body
  let runs = [];
  let current = '';
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if ((b >= 0x20 && b < 0x7f) || b === 0x0a || b === 0x0d) {
      current += String.fromCharCode(b);
    } else if (b >= 0xc0 && b < 0xe0 && i + 1 < buf.length) {
      try { current += buf.slice(i, i + 2).toString('utf-8'); i += 1; } catch { current += ' '; }
    } else if (b >= 0xe0 && b < 0xf0 && i + 2 < buf.length) {
      try { current += buf.slice(i, i + 3).toString('utf-8'); i += 2; } catch { current += ' '; }
    } else {
      if (current.length > 3) runs.push(current.trim());
      current = '';
    }
  }
  if (current.length > 3) runs.push(current.trim());

  // The message body is the longest run that doesn't look like NSArchiver internals
  const filtered = runs.filter(r =>
    r.length > 5 &&
    !r.startsWith('$%&') &&
    !r.startsWith('X$version') &&
    !r.includes('NSKeyedArchiver') &&
    !r.startsWith('__kIM')
  );
  filtered.sort((a, b) => b.length - a.length);
  let result = filtered[0] || null;
  // Clean up NSAttributedString prefix artifacts (+X, +XX at start)
  if (result) {
    result = result.replace(/^\+[a-zA-Z0-9]{0,3}(?:\uFFFC)?/, '').trim();
    // Also strip embedded object replacement character
    result = result.replace(/\uFFFC/g, '').trim();
  }
  return result;
}

// ─── Read all messages from thread ────────────────────────────────────────────
function readThread(chatIdentifier) {
  const db = new Database(CHAT_DB, { readonly: true });

  const rows = db.prepare(`
    SELECT m.ROWID, m.date, m.is_from_me, m.text, m.attributedBody,
           m.cache_has_attachments, m.associated_message_type
    FROM message m
    JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
    JOIN chat c ON c.ROWID = cmj.chat_id
    WHERE c.chat_identifier = ?
    ORDER BY m.date ASC
  `).all(chatIdentifier);

  db.close();

  const messages = [];
  for (const row of rows) {
    const ts = new Date((row.date / 1e9 + APPLE_EPOCH_OFFSET) * 1000);
    const text = row.text || decodeAttributedBody(row.attributedBody);
    const isTapback = (row.associated_message_type || 0) >= 2000;

    if (isTapback || !text || text.length < 3) continue;

    messages.push({
      rowid: row.ROWID,
      timestamp: ts.toISOString(),
      date: ts.toISOString().slice(0, 10),
      who: row.is_from_me ? 'SELLER' : 'BUYER',
      text,
      hasAttachment: !!row.cache_has_attachments
    });
  }
  return messages;
}

// ─── Classify events ──────────────────────────────────────────────────────────
const PRICE_RE = /\$([\d,]+(?:\.\d{2})?)\s*(?:sounds?\s*(?:fair|good|fine|great|reasonable)|is\s*(?:fair|good|fine|reasonable)|ok|deal|works|agreed|let'?s\s*do)/i;
const PRICE_RE2 = /(?:fair|good|fine|great|deal|ok|works|agreed)\s*(?:for|at)?\s*\$([\d,]+(?:\.\d{2})?)/i;
const SCOPE_CHANGE_RE = /(?:hold off|cancel|instead|changed|swap|don'?t|skip|scratch that|never ?mind|I ordered|I'?ll order|I bought|customer.?supplied)/i;
const SCOPE_ADD_RE = /(?:let'?s add|also (?:need|do|want)|while you'?re at it|add(?:ing)?|throw in|might as well)/i;
const STATUS_RE = /(?:done|installed|finished|complete|all set|good to go|90%|wrapped up|buttoned up|torqued|bolted|welded)/i;
const APPROVAL_RE = /(?:go ahead|sounds good|do it|yes|yeah|yep|approved|let'?s go|pull the trigger|green light)/i;

function classifyMessage(msg) {
  const t = msg.text;
  const events = [];

  // Price agreement
  let priceMatch = t.match(PRICE_RE) || t.match(PRICE_RE2);
  if (priceMatch) {
    events.push({
      type: 'price_agreement',
      amount: parseFloat(priceMatch[1].replace(/,/g, '')),
      who: msg.who
    });
  }

  // Scope change (cancellation / substitution)
  if (SCOPE_CHANGE_RE.test(t) && t.length > 15) {
    events.push({ type: 'scope_change', who: msg.who });
  }

  // Scope addition
  if (SCOPE_ADD_RE.test(t) && t.length > 15) {
    events.push({ type: 'scope_addition', who: msg.who });
  }

  // Status update
  if (STATUS_RE.test(t) && msg.who === 'SELLER') {
    events.push({ type: 'status_update', who: msg.who });
  }

  // Approval (buyer says yes to something)
  if (APPROVAL_RE.test(t) && msg.who === 'BUYER' && t.length < 100) {
    events.push({ type: 'buyer_approval', who: msg.who });
  }

  // Photo evidence
  if (msg.hasAttachment) {
    events.push({ type: 'photo_evidence', who: msg.who });
  }

  return events;
}

// ─── Write to vehicle_observations ────────────────────────────────────────────
// Map event types to valid observation_kind enum values
const KIND_MAP = {
  price_agreement: 'work_record',
  scope_change: 'work_record',
  scope_addition: 'work_record',
  status_update: 'work_record',
};

async function writeObservation(supabase, msg, event) {
  const kind = KIND_MAP[event.type] || 'work_record';

  // Dedup by content_hash
  const contentHash = `imsg:${chatId}:${msg.rowid}:${event.type}`;

  const record = {
    vehicle_id: VEHICLE_ID,
    kind,
    observed_at: msg.timestamp,
    content_text: msg.text.slice(0, 2000),
    content_hash: contentHash,
    structured_data: {
      event_type: event.type,
      who: event.who,
      amount: event.amount || null,
      chat_identifier: chatId,
      message_rowid: msg.rowid,
      has_attachment: msg.hasAttachment,
      source: 'ingest-thread.mjs'
    },
    confidence_score: 0.9,
    source_identifier: `imessage:${chatId}`,
    is_processed: true,
    processing_metadata: { processor: 'ingest-thread.mjs', version: '1.0' }
  };

  // Check for duplicate
  const { data: existing } = await supabase
    .from('vehicle_observations')
    .select('id')
    .eq('content_hash', contentHash)
    .limit(1);

  if (existing?.length > 0) return true; // already exists

  const { error } = await supabase
    .from('vehicle_observations')
    .insert(record);

  if (error) {
    // Log first error for debugging
    if (!writeObservation._errorLogged) {
      console.error(`  [error] ${error.message}`);
      writeObservation._errorLogged = true;
    }
    return false;
  }
  return true;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n=== iMessage Thread Parser ===`);
  console.log(`  Chat: ${chatId}`);
  console.log(`  Vehicle: ${VEHICLE_ID}\n`);

  const messages = readThread(chatId);
  console.log(`  Total messages decoded: ${messages.length}`);
  console.log(`  Date range: ${messages[0]?.date} → ${messages[messages.length - 1]?.date}\n`);

  // Classify all messages
  const timeline = [];
  for (const msg of messages) {
    const events = classifyMessage(msg);
    for (const event of events) {
      timeline.push({ ...msg, event });
    }
  }

  // Group by type
  const byType = {};
  for (const item of timeline) {
    const t = item.event.type;
    if (!byType[t]) byType[t] = [];
    byType[t].push(item);
  }

  // ── Report ──
  console.log('── Event Summary ──');
  for (const [type, items] of Object.entries(byType)) {
    console.log(`\n  ${type.toUpperCase()} (${items.length})`);
    for (const item of items.slice(0, 10)) {
      const prefix = `  ${item.date} [${item.event.who}]`;
      const amount = item.event.amount ? ` $${item.event.amount}` : '';
      const att = item.hasAttachment ? ' [PHOTO]' : '';
      console.log(`  ${prefix}${amount}${att} ${item.text.slice(0, 80)}`);
    }
    if (items.length > 10) console.log(`  ... and ${items.length - 10} more`);
  }

  // ── Write to DB ──
  if (!DRY_RUN && SUPABASE_URL && SUPABASE_KEY) {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    // Only write significant events (not photos or approvals — too noisy)
    const significantTypes = ['price_agreement', 'scope_change', 'scope_addition', 'status_update'];
    const significant = timeline.filter(t => significantTypes.includes(t.event.type));

    console.log(`\n── Writing ${significant.length} significant events to vehicle_observations ──`);
    let written = 0;
    for (const item of significant) {
      const ok = await writeObservation(supabase, item, item.event);
      if (ok) written++;
    }
    console.log(`  Written: ${written}/${significant.length}`);
  } else if (DRY_RUN) {
    console.log('\n[DRY RUN] Would write significant events to vehicle_observations');
  }

  // ── Key findings ──
  console.log('\n── Key Findings ──');

  const scopeChanges = byType['scope_change'] || [];
  const priceAgreements = byType['price_agreement'] || [];
  const statusUpdates = byType['status_update'] || [];
  const photos = byType['photo_evidence'] || [];

  console.log(`  Scope changes: ${scopeChanges.length}`);
  console.log(`  Price agreements: ${priceAgreements.length}`);
  console.log(`  Status updates: ${statusUpdates.length}`);
  console.log(`  Photos exchanged: ${photos.length}`);

  // Total money discussed
  const totalAgreed = priceAgreements.reduce((s, p) => s + (p.event.amount || 0), 0);
  if (totalAgreed > 0) {
    console.log(`  Total $ amounts discussed: $${totalAgreed.toFixed(2)}`);
  }
}

main().catch(e => {
  console.error(`Fatal: ${e.message}`);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * iMessage Bridge — reads ~/Library/Messages/chat.db, routes to Nuke,
 * replies via AppleScript. The transport layer for iMessage-as-interface.
 *
 * Usage:
 *   dotenvx run -- node scripts/imessage-bridge.mjs                          # process new messages once
 *   dotenvx run -- node scripts/imessage-bridge.mjs --daemon                 # poll continuously (2s)
 *   dotenvx run -- node scripts/imessage-bridge.mjs --dry-run                # log without replying
 *   dotenvx run -- node scripts/imessage-bridge.mjs --status                 # show bridge state
 *   dotenvx run -- node scripts/imessage-bridge.mjs --chat "+17029304818"    # specify chat to watch
 *   dotenvx run -- node scripts/imessage-bridge.mjs --reset                  # reset cursor to latest
 *
 * Requires: better-sqlite3, @supabase/supabase-js, dotenvx, node-fetch
 *           Full Disk Access for Terminal.app (to read chat.db)
 *
 * See docs/imessage-bridge-architecture.md for the full design.
 */

import Database from 'better-sqlite3';
import { createClient } from '@supabase/supabase-js';
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, copyFileSync } from 'fs';
import { join, basename, dirname } from 'path';
import os from 'os';
import dns from 'dns';

// ─── DNS fix: bypass broken macOS system resolver ──────────────────────────
const resolver = new dns.Resolver();
resolver.setServers(['8.8.8.8', '1.1.1.1']);
const origLookup = dns.lookup.bind(dns);
dns.lookup = function(hostname, options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  resolver.resolve4(hostname, (err, addresses) => {
    if (err || !addresses || addresses.length === 0) {
      return origLookup(hostname, options, callback);
    }
    if (options && options.all) {
      callback(null, addresses.map(a => ({ address: a, family: 4 })));
    } else {
      callback(null, addresses[0], 4);
    }
  });
};
const nodeFetch = (await import('node-fetch')).default;

// ─── Config ────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  console.error('Run with: dotenvx run -- node scripts/imessage-bridge.mjs');
  process.exit(1);
}

const CHAT_DB_PATH = join(os.homedir(), 'Library/Messages/chat.db');
const ATTACHMENTS_BASE = join(os.homedir(), 'Library/Messages/Attachments');
const CURSOR_FILE = join(os.homedir(), '.nuke-imessage-cursor');
const POLL_INTERVAL_MS = 2000;
const BUCKET = 'vehicle-photos';
const USER_ID = '0b9f107a-d124-49de-9ded-94698f63c1c4';

// Apple epoch: nanoseconds since 2001-01-01
const APPLE_EPOCH_OFFSET = 978307200; // seconds between Unix epoch (1970) and Apple epoch (2001)

function appleToDate(appleNanos) {
  return new Date((appleNanos / 1e9 + APPLE_EPOCH_OFFSET) * 1000);
}

// ─── CLI args ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const arg = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : null; };

const DRY_RUN = flag('--dry-run');
const DAEMON = flag('--daemon');
const STATUS = flag('--status');
const RESET = flag('--reset');
const CHAT_ID = arg('--chat') || process.env.IMESSAGE_CHAT_ID;

// ─── Supabase client ───────────────────────────────────────────────────────

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  global: { fetch: nodeFetch }
});

// ─── SQLite ────────────────────────────────────────────────────────────────

function openChatDb() {
  try {
    return new Database(CHAT_DB_PATH, { readonly: true, fileMustExist: true });
  } catch (e) {
    console.error(`Cannot open chat.db: ${e.message}`);
    console.error('Ensure Terminal has Full Disk Access in System Settings > Privacy.');
    process.exit(1);
  }
}

// ─── Cursor Management ────────────────────────────────────────────────────

async function getCursor(chatIdentifier) {
  // Try DB first
  const { data } = await supabase
    .from('imessage_conversations')
    .select('last_processed_rowid')
    .eq('chat_identifier', chatIdentifier)
    .maybeSingle();

  if (data?.last_processed_rowid > 0) return data.last_processed_rowid;

  // Fall back to local file
  if (existsSync(CURSOR_FILE)) {
    try {
      const cursors = JSON.parse(readFileSync(CURSOR_FILE, 'utf-8'));
      if (cursors[chatIdentifier]) return cursors[chatIdentifier];
    } catch {}
  }

  return 0;
}

async function saveCursor(chatIdentifier, rowid) {
  // Save to DB
  await supabase
    .from('imessage_conversations')
    .upsert({
      chat_identifier: chatIdentifier,
      last_processed_rowid: rowid,
    }, { onConflict: 'chat_identifier' });

  // Also save locally as crash fallback
  let cursors = {};
  if (existsSync(CURSOR_FILE)) {
    try { cursors = JSON.parse(readFileSync(CURSOR_FILE, 'utf-8')); } catch {}
  }
  cursors[chatIdentifier] = rowid;
  writeFileSync(CURSOR_FILE, JSON.stringify(cursors));
}

// ─── Discover Chat ─────────────────────────────────────────────────────────

function discoverChats(db) {
  const stmt = db.prepare(`
    SELECT c.ROWID, c.chat_identifier, c.display_name,
           (SELECT COUNT(*) FROM chat_message_join cmj WHERE cmj.chat_id = c.ROWID) as msg_count,
           (SELECT MAX(m.date) FROM message m
            INNER JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
            WHERE cmj.chat_id = c.ROWID) as last_date
    FROM chat c
    WHERE c.style = 45
    ORDER BY last_date DESC
    LIMIT 20
  `);
  return stmt.all();
}

// ─── Poll for New Messages ─────────────────────────────────────────────────

function getNewMessages(db, chatIdentifier, afterRowid) {
  const stmt = db.prepare(`
    SELECT m.ROWID, m.guid, m.text, m.date, m.is_from_me,
           m.cache_has_attachments, m.associated_message_guid,
           m.associated_message_type, h.id as sender_id
    FROM message m
    LEFT JOIN handle h ON m.handle_id = h.ROWID
    INNER JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
    INNER JOIN chat c ON c.ROWID = cmj.chat_id
    WHERE c.chat_identifier = ?
      AND m.ROWID > ?
      AND m.is_from_me = 0
    ORDER BY m.ROWID ASC
  `);
  return stmt.all(chatIdentifier, afterRowid);
}

function getAttachments(db, messageRowid) {
  const stmt = db.prepare(`
    SELECT a.ROWID, a.filename, a.mime_type, a.transfer_name, a.total_bytes
    FROM attachment a
    INNER JOIN message_attachment_join maj ON maj.attachment_id = a.ROWID
    WHERE maj.message_id = ?
  `);
  return stmt.all(messageRowid);
}

// ─── Attachment Upload ─────────────────────────────────────────────────────

async function uploadAttachment(attachment) {
  let filePath = attachment.filename;
  if (!filePath) return null;

  // Resolve ~ to home directory
  filePath = filePath.replace(/^~/, os.homedir());

  if (!existsSync(filePath)) {
    console.warn(`  Attachment file not found: ${filePath}`);
    return null;
  }

  const fileBuffer = readFileSync(filePath);
  const fileName = basename(filePath);
  const isHeic = /\.heic$/i.test(fileName);

  let uploadBuffer = fileBuffer;
  let uploadName = fileName;
  let mimeType = attachment.mime_type || 'image/jpeg';

  // Convert HEIC to JPEG
  if (isHeic) {
    try {
      const tmpDir = join(os.tmpdir(), 'nuke-imessage');
      mkdirSync(tmpDir, { recursive: true });
      const tmpIn = join(tmpDir, fileName);
      const tmpOut = join(tmpDir, fileName.replace(/\.heic$/i, '.jpg'));
      writeFileSync(tmpIn, fileBuffer);
      execSync(`sips -s format jpeg "${tmpIn}" --out "${tmpOut}" 2>/dev/null`);
      uploadBuffer = readFileSync(tmpOut);
      uploadName = basename(tmpOut);
      mimeType = 'image/jpeg';
    } catch (e) {
      console.warn(`  HEIC conversion failed: ${e.message}, uploading as-is`);
    }
  }

  const storagePath = `imessage/${new Date().toISOString().slice(0, 10)}/${Date.now()}_${uploadName}`;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, uploadBuffer, {
      contentType: mimeType,
      upsert: false,
    });

  if (error) {
    console.error(`  Upload failed: ${error.message}`);
    return null;
  }

  const { data: publicUrl } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
  return {
    url: publicUrl.publicUrl,
    filename: uploadName,
    mime_type: mimeType,
    size: uploadBuffer.length,
  };
}

// ─── Send Reply via AppleScript ────────────────────────────────────────────

function sendReply(chatIdentifier, text) {
  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would reply: ${text.slice(0, 100)}...`);
    return;
  }

  // Escape for AppleScript string
  const escaped = text
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');

  // Determine if identifier is phone or email
  const isPhone = chatIdentifier.startsWith('+');

  const script = isPhone
    ? `tell application "Messages"
        set targetService to 1st service whose service type = iMessage
        set targetBuddy to buddy "${chatIdentifier}" of targetService
        send "${escaped}" to targetBuddy
      end tell`
    : `tell application "Messages"
        set targetService to 1st service whose service type = iMessage
        set targetBuddy to buddy "${chatIdentifier}" of targetService
        send "${escaped}" to targetBuddy
      end tell`;

  try {
    execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 10000 });
    console.log(`  Replied: ${text.slice(0, 80)}${text.length > 80 ? '...' : ''}`);
  } catch (e) {
    console.error(`  AppleScript send failed: ${e.message}`);
    // Try alternate approach via chat guid
    try {
      const db = openChatDb();
      const chat = db.prepare('SELECT guid FROM chat WHERE chat_identifier = ?').get(chatIdentifier);
      db.close();
      if (chat) {
        const altScript = `tell application "Messages"
          set theChat to chat id "${chat.guid}"
          send "${escaped}" to theChat
        end tell`;
        execSync(`osascript -e '${altScript.replace(/'/g, "'\\''")}'`, { timeout: 10000 });
        console.log(`  Replied (via chat guid): ${text.slice(0, 80)}${text.length > 80 ? '...' : ''}`);
      }
    } catch (e2) {
      console.error(`  Alternate send also failed: ${e2.message}`);
    }
  }
}

// ─── Route Message to Nuke ─────────────────────────────────────────────────

async function routeMessage(chatIdentifier, message, attachmentUrls) {
  const isTapback = (message.associated_message_type || 0) >= 2000;

  const payload = {
    chat_identifier: chatIdentifier,
    text: message.text,
    attachments: attachmentUrls,
    message_guid: message.guid,
    timestamp: appleToDate(message.date).toISOString(),
    is_tapback: isTapback,
    tapback_type: isTapback ? message.associated_message_type : null,
    tapback_target_guid: isTapback ? message.associated_message_guid : null,
  };

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would POST:`, JSON.stringify(payload).slice(0, 200));
    return { reply: '[dry run — no response]' };
  }

  const response = await nodeFetch(`${SUPABASE_URL}/functions/v1/imessage-router`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`  Router returned ${response.status}: ${text.slice(0, 200)}`);
    return { reply: null };
  }

  return response.json();
}

// ─── Outbound Queue (Nuke → iMessage) ──────────────────────────────────────

async function processOutbound() {
  const { data: pending } = await supabase
    .from('imessage_outbound')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(10);

  if (!pending || pending.length === 0) return 0;

  for (const msg of pending) {
    console.log(`[${new Date().toISOString().slice(11, 19)}] Outbound from ${msg.source || 'unknown'}: ${msg.message.slice(0, 60)}`);
    sendReply(msg.chat_identifier, msg.message);

    await supabase
      .from('imessage_outbound')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', msg.id);
  }

  return pending.length;
}

// ─── Process One Round ─────────────────────────────────────────────────────

async function processMessages(chatIdentifier) {
  const db = openChatDb();
  const cursor = await getCursor(chatIdentifier);
  const messages = getNewMessages(db, chatIdentifier, cursor);

  if (messages.length === 0) {
    db.close();
    return 0;
  }

  console.log(`[${new Date().toISOString().slice(11, 19)}] ${messages.length} new message(s)`);

  let lastRowid = cursor;

  for (const msg of messages) {
    const timestamp = appleToDate(msg.date);
    const isTapback = (msg.associated_message_type || 0) >= 2000;

    console.log(`  #${msg.ROWID} [${timestamp.toISOString().slice(11, 19)}] ${isTapback ? `tapback(${msg.associated_message_type})` : (msg.text || '[media]').slice(0, 60)}`);

    // Skip messages that match recent outbound (prevent self-reply loops)
    const { data: recentOutbound } = await supabase
      .from('imessage_outbound')
      .select('message')
      .eq('status', 'sent')
      .gte('sent_at', new Date(Date.now() - 30000).toISOString())
      .limit(10);
    if (recentOutbound?.some(o => o.message === msg.text)) {
      console.log(`  Skipped (echo of outbound message)`);
      lastRowid = msg.ROWID;
      await saveCursor(chatIdentifier, lastRowid);
      continue;
    }

    // Upload attachments
    let attachmentUrls = [];
    if (msg.cache_has_attachments) {
      const attachments = getAttachments(db, msg.ROWID);
      for (const att of attachments) {
        const uploaded = await uploadAttachment(att);
        if (uploaded) {
          attachmentUrls.push(uploaded);
          console.log(`  Uploaded: ${uploaded.filename} (${(uploaded.size / 1024).toFixed(0)}KB)`);
        }
      }
    }

    // Route to Nuke
    const result = await routeMessage(chatIdentifier, msg, attachmentUrls);

    // Send reply
    if (result.reply) {
      sendReply(chatIdentifier, result.reply);
    }

    lastRowid = msg.ROWID;
    await saveCursor(chatIdentifier, lastRowid);
  }

  db.close();
  return messages.length;
}

// ─── Status Command ────────────────────────────────────────────────────────

async function showStatus() {
  const db = openChatDb();

  // Show recent chats
  console.log('=== Recent 1:1 chats ===');
  const chats = discoverChats(db);
  for (const c of chats.slice(0, 10)) {
    const lastDate = c.last_date ? appleToDate(c.last_date).toISOString().slice(0, 16) : 'never';
    console.log(`  ${c.chat_identifier.padEnd(25)} ${String(c.msg_count).padStart(5)} msgs  last: ${lastDate}  ${c.display_name || ''}`);
  }

  // Show bridge state from DB
  console.log('\n=== Bridge state ===');
  const { data: convos } = await supabase
    .from('imessage_conversations')
    .select('*');

  if (convos && convos.length > 0) {
    for (const c of convos) {
      console.log(`  Chat: ${c.chat_identifier}`);
      console.log(`    Cursor: ROWID ${c.last_processed_rowid}`);
      console.log(`    Active vehicle: ${c.active_vehicle_name || 'none'}`);
      console.log(`    Messages: ${c.messages_received} in / ${c.messages_sent} out`);
      console.log(`    Photos: ${c.photos_received}`);
      console.log(`    Last: ${c.last_message_at || 'never'}`);
    }
  } else {
    console.log('  No active bridge conversations.');
  }

  // Show cursor file
  if (existsSync(CURSOR_FILE)) {
    const cursors = JSON.parse(readFileSync(CURSOR_FILE, 'utf-8'));
    console.log(`\n=== Local cursor file (${CURSOR_FILE}) ===`);
    for (const [k, v] of Object.entries(cursors)) {
      console.log(`  ${k}: ROWID ${v}`);
    }
  }

  db.close();
}

// ─── Reset Cursor ──────────────────────────────────────────────────────────

async function resetCursor(chatIdentifier) {
  const db = openChatDb();
  const stmt = db.prepare(`
    SELECT MAX(m.ROWID) as max_rowid
    FROM message m
    INNER JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
    INNER JOIN chat c ON c.ROWID = cmj.chat_id
    WHERE c.chat_identifier = ?
  `);
  const result = stmt.get(chatIdentifier);
  const maxRowid = result?.max_rowid || 0;
  db.close();

  await saveCursor(chatIdentifier, maxRowid);
  console.log(`Cursor reset to ROWID ${maxRowid} for ${chatIdentifier}`);
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  if (STATUS) {
    await showStatus();
    return;
  }

  if (!CHAT_ID) {
    console.error('No chat identifier specified.');
    console.error('Use --chat "+17029304818" or set IMESSAGE_CHAT_ID env var.');
    console.error('Run with --status to see available chats.');
    process.exit(1);
  }

  if (RESET) {
    await resetCursor(CHAT_ID);
    return;
  }

  console.log(`iMessage Bridge starting`);
  console.log(`  Chat: ${CHAT_ID}`);
  console.log(`  Mode: ${DAEMON ? 'daemon' : 'single run'}${DRY_RUN ? ' (dry run)' : ''}`);
  console.log(`  Router: ${SUPABASE_URL}/functions/v1/imessage-router`);

  const cursor = await getCursor(CHAT_ID);
  console.log(`  Cursor: ROWID ${cursor}`);

  if (DAEMON) {
    console.log(`  Polling every ${POLL_INTERVAL_MS}ms\n`);

    // Graceful shutdown
    let running = true;
    process.on('SIGTERM', () => { running = false; console.log('\nShutting down...'); });
    process.on('SIGINT', () => { running = false; console.log('\nShutting down...'); });

    while (running) {
      try {
        await processMessages(CHAT_ID);
        await processOutbound();
      } catch (e) {
        console.error(`Poll error: ${e.message}`);
      }
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    console.log('Bridge stopped.');
  } else {
    const count = await processMessages(CHAT_ID);
    console.log(`Processed ${count} message(s).`);
  }
}

main().catch(e => {
  console.error(`Fatal: ${e.message}`);
  process.exit(1);
});

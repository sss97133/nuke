#!/usr/bin/env node
/**
 * iMessage → Vehicle Timeline Auto-Sync
 *
 * Passive sync that captures work documentation from vehicle-related
 * iMessage conversations — including photos the user SENDS (outbound).
 * Groups messages by date and upserts work_sessions + vehicle_images.
 *
 * Usage:
 *   dotenvx run -- node scripts/imessage-vehicle-sync.mjs                          # single run, new since cursor
 *   dotenvx run -- node scripts/imessage-vehicle-sync.mjs --daemon                 # poll every 5 min
 *   dotenvx run -- node scripts/imessage-vehicle-sync.mjs --backfill --since 2026-03-28
 *   dotenvx run -- node scripts/imessage-vehicle-sync.mjs --dry-run                # log without writing
 *   dotenvx run -- node scripts/imessage-vehicle-sync.mjs --status                 # show sync state
 *
 * Requires: better-sqlite3, @supabase/supabase-js, dotenvx, sips (macOS)
 *           Full Disk Access for Terminal.app (to read chat.db)
 *
 * Config: ~/.nuke-imessage-vehicles.json
 *   Maps phone numbers to vehicles. One conversation = one vehicle.
 */

import Database from 'better-sqlite3';
import { createClient } from '@supabase/supabase-js';
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import os from 'os';
import dns from 'dns';

// ─── DNS fix: bypass broken macOS system resolver ──────────────────────────
const resolver = new dns.Resolver();
resolver.setServers(['8.8.8.8', '1.1.1.1']);
const origLookup = dns.lookup.bind(dns);
dns.lookup = function(hostname, options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  resolver.resolve4(hostname, (err, addresses) => {
    if (err || !addresses || addresses.length === 0) return origLookup(hostname, options, callback);
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
  console.error('Run with: dotenvx run -- node scripts/imessage-vehicle-sync.mjs');
  process.exit(1);
}

const CHAT_DB_PATH = join(os.homedir(), 'Library/Messages/chat.db');
const CONFIG_FILE = join(os.homedir(), '.nuke-imessage-vehicles.json');
const CURSOR_FILE = join(os.homedir(), '.nuke-imessage-vehicle-sync.json');
const BUCKET = 'vehicle-photos';
const USER_ID = '0b9f107a-d124-49de-9ded-94698f63c1c4';
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 min

// Apple epoch: nanoseconds since 2001-01-01
const APPLE_EPOCH_OFFSET = 978307200;

function appleToDate(appleNanos) {
  return new Date((appleNanos / 1e9 + APPLE_EPOCH_OFFSET) * 1000);
}

// ─── CLI args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const arg = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : null; };

const DRY_RUN = flag('--dry-run');
const DAEMON = flag('--daemon');
const BACKFILL = flag('--backfill');
const STATUS = flag('--status');
const SINCE = arg('--since');

// ─── Supabase client ───────────────────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  global: { fetch: nodeFetch }
});

// ─── Vehicle config ────────────────────────────────────────────────────────
function loadVehicleConfig() {
  if (!existsSync(CONFIG_FILE)) {
    console.error(`Config file not found: ${CONFIG_FILE}`);
    console.error('Create it with: [{"chat_id": "+1...", "vehicle_id": "uuid", "vehicle_name": "...", "contact_name": "..."}]');
    process.exit(1);
  }
  return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
}

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
function loadCursors() {
  if (existsSync(CURSOR_FILE)) {
    try { return JSON.parse(readFileSync(CURSOR_FILE, 'utf-8')); } catch {}
  }
  return {};
}

function saveCursors(cursors) {
  writeFileSync(CURSOR_FILE, JSON.stringify(cursors, null, 2));
}

// ─── Text extraction from attributedBody ───────────────────────────────────
function extractTextFromAttributedBody(buf) {
  if (!buf || buf.length < 20) return null;

  // NSKeyedArchiver format: text appears after 'NSString' class reference
  const nsIdx = buf.indexOf(Buffer.from('NSString'));
  if (nsIdx === -1) return null;

  // Scan forward from NSString to find the text content
  // Text is preceded by a length-prefix byte sequence: typically 0x01 then a marker byte, then text
  const searchStart = nsIdx + 8;
  const afterNs = buf.slice(searchStart);

  // Strategy: find runs of printable UTF-8 characters, exclude class names
  const str = afterNs.toString('utf-8');
  const classNames = /^(?:NS[A-Z]|__kIM|NSValue|NSDictionary|NSObject|NSNumber|NSMutableString)/;

  // Split on control characters and find the first substantial printable run
  const segments = str.split(/[\x00-\x1f\x7f-\x8f]/);
  for (const seg of segments) {
    const trimmed = seg.replace(/^[\x90-\x9f\ufffd+,*]+/, '').replace(/[\x90-\x9f\ufffd]+$/, '').trim();
    if (trimmed.length >= 3 && !classNames.test(trimmed) && trimmed !== '\ufffc') {
      // \ufffc = object replacement character (attachment placeholder)
      // Strip NSArchive noise (short artifact tokens like 'iI', '+', lone digits)
      const cleaned = trimmed.replace(/\ufffc/g, '').trim();
      if (cleaned.length >= 3) return cleaned;
    }
  }
  return null;
}

// ─── Query messages ────────────────────────────────────────────────────────
function getMessages(db, chatIdentifier, afterRowid) {
  // BOTH directions: is_from_me = 0 AND 1
  const stmt = db.prepare(`
    SELECT m.ROWID, m.guid, m.text, m.date, m.is_from_me,
           m.cache_has_attachments, m.attributedBody,
           h.id as sender_id
    FROM message m
    LEFT JOIN handle h ON m.handle_id = h.ROWID
    INNER JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
    INNER JOIN chat c ON c.ROWID = cmj.chat_id
    WHERE c.chat_identifier = ?
      AND m.ROWID > ?
      AND m.associated_message_type = 0
    ORDER BY m.ROWID ASC
  `);
  return stmt.all(chatIdentifier, afterRowid);
}

function getMessagesSince(db, chatIdentifier, sinceDate) {
  const sinceTs = (new Date(sinceDate).getTime() / 1000 - APPLE_EPOCH_OFFSET) * 1e9;
  const stmt = db.prepare(`
    SELECT m.ROWID, m.guid, m.text, m.date, m.is_from_me,
           m.cache_has_attachments, m.attributedBody,
           h.id as sender_id
    FROM message m
    LEFT JOIN handle h ON m.handle_id = h.ROWID
    INNER JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
    INNER JOIN chat c ON c.ROWID = cmj.chat_id
    WHERE c.chat_identifier = ?
      AND m.date >= ?
      AND m.associated_message_type = 0
    ORDER BY m.ROWID ASC
  `);
  return stmt.all(chatIdentifier, sinceTs);
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

// ─── Photo upload ──────────────────────────────────────────────────────────
async function uploadPhoto(attachment, vehicleId, messageDate) {
  let filePath = attachment.filename;
  if (!filePath) return null;

  filePath = filePath.replace(/^~/, os.homedir());

  if (!existsSync(filePath)) {
    console.warn(`    Attachment not found: ${basename(filePath)}`);
    return null;
  }

  const fileName = basename(filePath);
  const isHeic = /\.heic$/i.test(fileName);
  const isImage = /\.(heic|jpg|jpeg|png|gif|tiff?)$/i.test(fileName);

  if (!isImage) {
    // Skip videos and other non-image attachments
    return null;
  }

  let uploadBuffer, uploadName, mimeType;

  if (isHeic) {
    try {
      const tmpDir = join(os.tmpdir(), 'nuke-imessage-sync');
      mkdirSync(tmpDir, { recursive: true });
      const tmpIn = join(tmpDir, fileName);
      const tmpOut = join(tmpDir, fileName.replace(/\.heic$/i, '.jpg'));
      writeFileSync(tmpIn, readFileSync(filePath));
      execSync(`sips -s format jpeg "${tmpIn}" --out "${tmpOut}" -s formatOptions 85 2>/dev/null`);
      uploadBuffer = readFileSync(tmpOut);
      uploadName = basename(tmpOut);
      mimeType = 'image/jpeg';
    } catch (e) {
      console.warn(`    HEIC conversion failed: ${e.message}`);
      uploadBuffer = readFileSync(filePath);
      uploadName = fileName;
      mimeType = attachment.mime_type || 'image/heic';
    }
  } else {
    uploadBuffer = readFileSync(filePath);
    uploadName = fileName;
    mimeType = attachment.mime_type || 'image/jpeg';
  }

  const dateStr = messageDate.toISOString().slice(0, 10);
  const storagePath = `${vehicleId}/imessage/${dateStr}_${Date.now()}_${uploadName}`;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, uploadBuffer, {
      contentType: mimeType,
      upsert: false,
    });

  if (error) {
    if (error.message?.includes('already exists') || error.message?.includes('Duplicate')) {
      return null; // Already uploaded
    }
    console.error(`    Upload failed: ${error.message}`);
    return null;
  }

  const { data: publicUrl } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
  return {
    url: publicUrl.publicUrl,
    storagePath,
    filename: uploadName,
    mimeType,
    size: uploadBuffer.length,
  };
}

// ─── Group messages by date ────────────────────────────────────────────────
function groupByDate(messages) {
  const groups = new Map(); // dateStr → { messages, photos, texts }
  for (const msg of messages) {
    const date = appleToDate(msg.date);
    const dateStr = date.toISOString().slice(0, 10);
    if (!groups.has(dateStr)) {
      groups.set(dateStr, { messages: [], date: dateStr });
    }
    groups.get(dateStr).messages.push({ ...msg, _date: date });
  }
  return groups;
}

// ─── Process one conversation ──────────────────────────────────────────────
async function processConversation(db, config) {
  const { chat_id, vehicle_id, vehicle_name, contact_name } = config;
  const cursors = loadCursors();

  let messages;
  if (BACKFILL && SINCE) {
    console.log(`  Backfill since ${SINCE}`);
    messages = getMessagesSince(db, chat_id, SINCE);
  } else {
    const cursor = cursors[chat_id] || 0;
    messages = getMessages(db, chat_id, cursor);
  }

  if (messages.length === 0) {
    console.log(`  No new messages`);
    return 0;
  }

  console.log(`  ${messages.length} messages to process`);

  // Group by date
  const dateGroups = groupByDate(messages);
  let totalPhotos = 0;
  let totalSessions = 0;

  for (const [dateStr, group] of dateGroups) {
    const dayMessages = group.messages;
    const texts = [];
    const photoResults = [];

    for (const msg of dayMessages) {
      // Extract text
      const text = msg.text || extractTextFromAttributedBody(msg.attributedBody);
      if (text && text.length > 0) {
        const direction = msg.is_from_me ? '→' : '←';
        texts.push(`${direction} ${text}`);
      }

      // Process photo attachments
      if (msg.cache_has_attachments) {
        const attachments = getAttachments(db, msg.ROWID);
        for (const att of attachments) {
          if (DRY_RUN) {
            const filePath = att.filename?.replace(/^~/, os.homedir());
            const isImage = /\.(heic|jpg|jpeg|png|gif|tiff?)$/i.test(att.filename || '');
            if (isImage && filePath && existsSync(filePath)) {
              photoResults.push({ filename: basename(filePath), dry: true });
              console.log(`    [DRY] Would upload: ${basename(filePath)}`);
            }
            continue;
          }

          const uploaded = await uploadPhoto(att, vehicle_id, msg._date);
          if (uploaded) {
            photoResults.push(uploaded);

            // Create vehicle_images row
            const imgRow = {
              vehicle_id,
              image_url: uploaded.url,
              storage_path: uploaded.storagePath,
              source: 'imessage',
              mime_type: uploaded.mimeType,
              file_name: uploaded.filename,
              file_size: uploaded.size,
              is_external: false,
              ai_processing_status: 'pending',
              documented_by_user_id: USER_ID,
              taken_at: msg._date.toISOString(),
              caption: `iMessage ${msg.is_from_me ? 'sent to' : 'from'} ${contact_name}`,
            };

            const { error: imgErr } = await supabase.from('vehicle_images').insert(imgRow);
            if (imgErr && !imgErr.message?.includes('duplicate') && !imgErr.message?.includes('unique')) {
              console.error(`    Image insert error: ${imgErr.message}`);
            } else if (!imgErr) {
              console.log(`    Uploaded: ${uploaded.filename} (${(uploaded.size / 1024).toFixed(0)}KB)`);
            }
          }
        }
      }
    }

    const photoCount = photoResults.length;
    totalPhotos += photoCount;

    // Build work description from texts
    const workTexts = texts.filter(t => t.length > 3);
    const description = workTexts.length > 0
      ? workTexts.join('\n').slice(0, 2000)
      : (photoCount > 0 ? `${photoCount} photos exchanged via iMessage` : null);

    // Only create/update session if there are photos or work-related text
    if (photoCount === 0 && workTexts.length === 0) continue;

    // Get time range for this day
    const timestamps = dayMessages.map(m => m._date.getTime());
    const startTime = new Date(Math.min(...timestamps));
    const endTime = new Date(Math.max(...timestamps));
    const durationMinutes = Math.max(1, Math.round((endTime - startTime) / 60000));

    if (DRY_RUN) {
      console.log(`  [DRY] ${dateStr}: ${photoCount} photos, ${workTexts.length} texts, ${durationMinutes}min`);
      if (workTexts.length > 0) {
        console.log(`    Text preview: ${workTexts[0].slice(0, 80)}`);
      }
      totalSessions++;
      continue;
    }

    // Upsert work_session: update if exists for this date+vehicle, insert if not
    const { data: existing } = await supabase
      .from('work_sessions')
      .select('id, image_count, work_description')
      .eq('vehicle_id', vehicle_id)
      .eq('session_date', dateStr)
      .eq('session_type', 'imessage_sync')
      .maybeSingle();

    if (existing) {
      // Update existing session
      const newImageCount = (existing.image_count || 0) + photoCount;
      const newDesc = existing.work_description
        ? existing.work_description + '\n---\n' + description
        : description;

      const { error: upErr } = await supabase
        .from('work_sessions')
        .update({
          image_count: newImageCount,
          work_description: newDesc?.slice(0, 4000),
          end_time: endTime.toISOString(),
          duration_minutes: Math.max(existing.duration_minutes || 0, durationMinutes),
          metadata: {
            sources: { imessage: true, photos: newImageCount },
            created_by: 'imessage-vehicle-sync',
            contact: contact_name,
          },
        })
        .eq('id', existing.id);

      if (upErr) {
        console.error(`  Session update error (${dateStr}): ${upErr.message}`);
      } else {
        console.log(`  ${dateStr}: updated session (${newImageCount} photos total)`);
        totalSessions++;
      }
    } else {
      // Insert new session
      const sessionRow = {
        user_id: USER_ID,
        vehicle_id,
        session_date: dateStr,
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        duration_minutes: durationMinutes,
        confidence_score: 0.70,
        image_count: photoCount,
        work_description: description?.slice(0, 4000),
        session_type: 'imessage_sync',
        status: 'completed',
        title: `${vehicle_name} — ${dateStr} (iMessage)`,
        work_type: photoCount > 0 ? 'work' : 'communication',
        metadata: {
          sources: { imessage: true, photos: photoCount },
          created_by: 'imessage-vehicle-sync',
          contact: contact_name,
        },
      };

      const { error: insErr } = await supabase
        .from('work_sessions')
        .insert(sessionRow);

      if (insErr) {
        // Unique constraint on (vehicle_id, start_time) — adjust start_time slightly
        if (insErr.message?.includes('unique') || insErr.message?.includes('duplicate')) {
          sessionRow.start_time = new Date(startTime.getTime() + 1000).toISOString();
          const { error: retryErr } = await supabase.from('work_sessions').insert(sessionRow);
          if (retryErr) {
            console.error(`  Session insert error (${dateStr}): ${retryErr.message}`);
          } else {
            console.log(`  ${dateStr}: new session (${photoCount} photos, ${workTexts.length} texts)`);
            totalSessions++;
          }
        } else {
          console.error(`  Session insert error (${dateStr}): ${insErr.message}`);
        }
      } else {
        console.log(`  ${dateStr}: new session (${photoCount} photos, ${workTexts.length} texts)`);
        totalSessions++;
      }
    }
  }

  // Update cursor to latest ROWID
  if (!DRY_RUN && messages.length > 0) {
    const maxRowid = Math.max(...messages.map(m => m.ROWID));
    cursors[chat_id] = maxRowid;
    saveCursors(cursors);
  }

  return { sessions: totalSessions, photos: totalPhotos };
}

// ─── Status ────────────────────────────────────────────────────────────────
async function showStatus() {
  const configs = loadVehicleConfig();
  const cursors = loadCursors();
  const db = openChatDb();

  console.log('=== iMessage Vehicle Sync Status ===\n');

  for (const config of configs) {
    const { chat_id, vehicle_id, vehicle_name, contact_name } = config;
    const cursor = cursors[chat_id] || 0;

    // Count messages after cursor
    const pending = db.prepare(`
      SELECT COUNT(*) as cnt FROM message m
      INNER JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
      INNER JOIN chat c ON c.ROWID = cmj.chat_id
      WHERE c.chat_identifier = ? AND m.ROWID > ? AND m.associated_message_type = 0
    `).get(chat_id, cursor);

    // Total messages
    const total = db.prepare(`
      SELECT COUNT(*) as cnt,
             SUM(CASE WHEN m.is_from_me = 1 THEN 1 ELSE 0 END) as outbound,
             SUM(CASE WHEN m.cache_has_attachments = 1 THEN 1 ELSE 0 END) as attachments
      FROM message m
      INNER JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
      INNER JOIN chat c ON c.ROWID = cmj.chat_id
      WHERE c.chat_identifier = ?
    `).get(chat_id);

    // Work sessions from this source
    const { data: sessions } = await supabase
      .from('work_sessions')
      .select('session_date, image_count')
      .eq('vehicle_id', vehicle_id)
      .eq('session_type', 'imessage_sync')
      .order('session_date', { ascending: false })
      .limit(5);

    // Images from imessage source
    const { count: imgCount } = await supabase
      .from('vehicle_images')
      .select('*', { count: 'exact', head: true })
      .eq('vehicle_id', vehicle_id)
      .eq('source', 'imessage');

    console.log(`${contact_name} (${chat_id}) → ${vehicle_name}`);
    console.log(`  Vehicle: ${vehicle_id}`);
    console.log(`  Total messages: ${total.cnt} (${total.outbound} outbound, ${total.attachments} with attachments)`);
    console.log(`  Cursor: ROWID ${cursor} (${pending.cnt} pending)`);
    console.log(`  Images uploaded: ${imgCount || 0}`);
    if (sessions?.length) {
      console.log(`  Recent sessions:`);
      for (const s of sessions) {
        console.log(`    ${s.session_date}: ${s.image_count} photos`);
      }
    }
    console.log();
  }

  db.close();
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
  if (STATUS) {
    await showStatus();
    return;
  }

  const configs = loadVehicleConfig();
  console.log(`iMessage Vehicle Sync`);
  console.log(`  Mode: ${DAEMON ? 'daemon (5min)' : BACKFILL ? `backfill since ${SINCE || '?'}` : 'single run'}${DRY_RUN ? ' (dry run)' : ''}`);
  console.log(`  Vehicles: ${configs.map(c => c.vehicle_name).join(', ')}`);

  if (BACKFILL && !SINCE) {
    console.error('--backfill requires --since YYYY-MM-DD');
    process.exit(1);
  }

  async function runOnce() {
    const db = openChatDb();
    let totalSessions = 0;
    let totalPhotos = 0;

    for (const config of configs) {
      console.log(`\n[${new Date().toISOString().slice(11, 19)}] ${config.contact_name} → ${config.vehicle_name}`);
      try {
        const result = await processConversation(db, config);
        if (result) {
          totalSessions += result.sessions;
          totalPhotos += result.photos;
        }
      } catch (e) {
        console.error(`  Error: ${e.message}`);
      }
    }

    db.close();
    return { sessions: totalSessions, photos: totalPhotos };
  }

  if (DAEMON) {
    console.log(`  Polling every ${POLL_INTERVAL_MS / 1000}s\n`);
    let running = true;
    process.on('SIGTERM', () => { running = false; console.log('\nShutting down...'); });
    process.on('SIGINT', () => { running = false; console.log('\nShutting down...'); });

    while (running) {
      try {
        await runOnce();
      } catch (e) {
        console.error(`Poll error: ${e.message}`);
      }
      if (!running) break;
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    console.log('Sync stopped.');
  } else {
    const result = await runOnce();
    console.log(`\nDone: ${result.sessions} sessions, ${result.photos} photos`);
  }
}

main().catch(e => {
  console.error(`Fatal: ${e.message}`);
  process.exit(1);
});

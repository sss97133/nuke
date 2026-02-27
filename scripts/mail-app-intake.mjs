#!/usr/bin/env node
/**
 * mail-app-intake.mjs — Scrape vehicle listing URLs from Mail.app emails
 *
 * Reads the macOS Mail.app SQLite database for toymachine91@gmail.com,
 * finds unread vehicle alert emails (BaT, KSL, etc.), extracts listing
 * URLs from the .emlx files on disk, and queues them to import_queue.
 *
 * Usage:
 *   dotenvx run -- node scripts/mail-app-intake.mjs           # process all unread
 *   dotenvx run -- node scripts/mail-app-intake.mjs --dry-run  # list URLs without queueing
 *   dotenvx run -- node scripts/mail-app-intake.mjs --daemon   # poll every 2 minutes
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const isDryRun = process.argv.includes('--dry-run');
const isDaemon = process.argv.includes('--daemon');
const POLL_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

const MAIL_DB = path.join(
  process.env.HOME,
  'Library/Mail/V10/MailData/Envelope Index'
);
const MAIL_BASE = path.join(
  process.env.HOME,
  'Library/Mail/V10/C16C0129-D412-4384-AC34-77EFABDF8501/[Gmail].mbox/All Mail.mbox'
);

// ─── URL extraction patterns per source ─────────────────────────────────────

const URL_PATTERNS = {
  'bringatrailer.com': /https:\/\/bringatrailer\.com\/listing\/[^\s"'<>=]+\//g,
  'ksl.com': /https:\/\/(?:cars\.)?ksl\.com\/(?:auto\/|listing\/)\d+[^\s"'<>]*/g,
  'hemmings.com': /https:\/\/(?:www\.)?hemmings\.com\/(?:auction|classifieds)\/[^\s"'<>]+/g,
  'carsandbids.com': /https:\/\/carsandbids\.com\/auctions\/[^\s"'<>]+/g,
  'ebay.com': /https:\/\/(?:www\.)?ebay\.com\/itm\/\d+/g,
  'craigslist.org': /https:\/\/[a-z]+\.craigslist\.org\/[a-z]+\/[a-z]+\/d\/[^\s"'<>]+\.html/g,
  'pcarmarket.com': /https:\/\/(?:www\.)?pcarmarket\.com\/listing\/[^\s"'<>]+/g,
  'classiccars.com': /https:\/\/(?:www\.)?classiccars\.com\/listings\/[^\s"'<>]+/g,
  'hagerty.com': /https:\/\/(?:www\.)?hagerty\.com\/marketplace\/[^\s"'<>]+/g,
};

// ─── SQLite query to find vehicle alert emails ──────────────────────────────

function getAlertEmails() {
  const sql = `
    SELECT
      m.ROWID,
      s.subject,
      a.address as sender
    FROM messages m
    JOIN subjects s ON m.subject = s.ROWID
    JOIN addresses a ON m.sender = a.ROWID
    WHERE m.mailbox = 13
      AND m.deleted = 0
      AND m.read = 0
      AND (
        a.address LIKE '%bringatrailer%'
        OR a.address LIKE '%ksl.com'
        OR a.address LIKE '%hemmings%'
        OR a.address LIKE '%carsandbids%'
        OR a.address LIKE '%ebay.com'
        OR a.address LIKE '%craigslist%'
        OR a.address LIKE '%pcarmarket%'
        OR a.address LIKE '%classiccars%'
        OR a.address LIKE '%hagerty%'
      )
    ORDER BY m.date_received DESC;
  `;

  const result = execSync(
    `sqlite3 "${MAIL_DB}" -readonly -separator '|' "${sql.replace(/\n/g, ' ')}"`,
    { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
  );

  return result.trim().split('\n').filter(Boolean).map(line => {
    const [rowid, subject, sender] = line.split('|');
    return { rowid, subject, sender };
  });
}

// ─── Find .emlx file on disk ────────────────────────────────────────────────

// Build a lookup index once instead of running `find` per email
let emlxIndex = null;

function buildEmlxIndex() {
  if (emlxIndex) return emlxIndex;
  console.log('Building .emlx file index (one-time)...');
  try {
    const result = execSync(
      `find "${MAIL_BASE}" -name "*.emlx" 2>/dev/null`,
      { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024, timeout: 60000 }
    );
    emlxIndex = new Map();
    for (const line of result.trim().split('\n')) {
      if (!line) continue;
      const basename = line.split('/').pop().replace('.emlx', '');
      emlxIndex.set(basename, line);
    }
    console.log(`Indexed ${emlxIndex.size} .emlx files`);
    return emlxIndex;
  } catch (err) {
    console.error('Failed to build emlx index:', err.message);
    emlxIndex = new Map();
    return emlxIndex;
  }
}

function findEmlxFile(rowid) {
  const index = buildEmlxIndex();
  return index.get(rowid) || null;
}

// ─── Extract URLs from .emlx file content ───────────────────────────────────

function extractUrls(emlxPath, sender) {
  const content = readFileSync(emlxPath, 'utf-8');
  const urls = new Set();

  // Try source-specific patterns first
  for (const [domain, pattern] of Object.entries(URL_PATTERNS)) {
    if (sender.includes(domain.split('.')[0])) {
      const matches = content.match(pattern) || [];
      for (const url of matches) {
        // Clean up email encoding artifacts
        const cleaned = url.replace(/=\n/g, '').replace(/=3D/g, '=').replace(/[=]$/g, '');
        if (cleaned.length > 20) urls.add(cleaned);
      }
    }
  }

  // Fallback: try all patterns
  if (urls.size === 0) {
    for (const [, pattern] of Object.entries(URL_PATTERNS)) {
      const matches = content.match(pattern) || [];
      for (const url of matches) {
        const cleaned = url.replace(/=\n/g, '').replace(/=3D/g, '=').replace(/[=]$/g, '');
        if (cleaned.length > 20) urls.add(cleaned);
      }
    }
  }

  return [...urls];
}

// ─── Queue URLs to import_queue via Supabase ────────────────────────────────

async function queueUrls(urls, source, subject) {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('Missing SUPABASE_URL or SERVICE_ROLE_KEY');
    return { queued: 0, skipped: 0 };
  }

  let queued = 0, skipped = 0;

  for (const url of urls) {
    try {
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/import_queue`, {
        method: 'POST',
        headers: {
          'apikey': SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=ignore-duplicates',
        },
        body: JSON.stringify({
          listing_url: url,
          listing_title: subject || null,
          status: 'pending',
          priority: 5,
          raw_data: {
            alert_source: source,
            alert_subject: subject,
            ingested_via: 'mail_app_intake',
            ingested_at: new Date().toISOString(),
          },
        }),
      });

      if (resp.ok || resp.status === 409) {
        if (resp.status === 409) {
          skipped++;
        } else {
          queued++;
        }
      } else {
        const text = await resp.text();
        // Duplicate key = already in queue, not an error
        if (text.includes('duplicate') || text.includes('unique')) {
          skipped++;
        } else {
          console.error(`  Failed to queue ${url}: ${resp.status} ${text.slice(0, 100)}`);
        }
      }
    } catch (err) {
      console.error(`  Error queueing ${url}: ${err.message}`);
    }
  }

  return { queued, skipped };
}

// ─── Main processing loop ───────────────────────────────────────────────────

async function processEmails() {
  console.log(`\n[${new Date().toISOString()}] Scanning Mail.app for vehicle alerts...`);

  let emails;
  try {
    emails = getAlertEmails();
  } catch (err) {
    console.error('Failed to query Mail.app database:', err.message);
    return;
  }

  console.log(`Found ${emails.length} unread vehicle alert emails`);

  let totalQueued = 0, totalSkipped = 0, totalUrls = 0;
  const urlsBySource = {};

  for (const email of emails) {
    const emlxPath = findEmlxFile(email.rowid);
    if (!emlxPath) {
      continue; // File not cached locally
    }

    const urls = extractUrls(emlxPath, email.sender);
    if (urls.length === 0) continue;

    totalUrls += urls.length;
    const source = email.sender.split('@')[1]?.split('.')[0] || 'unknown';
    urlsBySource[source] = (urlsBySource[source] || 0) + urls.length;

    if (isDryRun) {
      for (const url of urls) {
        console.log(`  [${source}] ${url}`);
      }
    } else {
      const { queued, skipped } = await queueUrls(urls, source, email.subject);
      totalQueued += queued;
      totalSkipped += skipped;
    }
  }

  console.log(`\nResults:`);
  console.log(`  Emails scanned: ${emails.length}`);
  console.log(`  URLs found: ${totalUrls}`);
  for (const [src, count] of Object.entries(urlsBySource)) {
    console.log(`    ${src}: ${count}`);
  }
  if (!isDryRun) {
    console.log(`  Queued: ${totalQueued}`);
    console.log(`  Already in queue: ${totalSkipped}`);
  }
}

// ─── Entry point ────────────────────────────────────────────────────────────

async function main() {
  if (!existsSync(MAIL_DB)) {
    console.error(`Mail.app database not found at: ${MAIL_DB}`);
    process.exit(1);
  }

  if (isDaemon) {
    console.log('Starting mail-app-intake daemon (polling every 2 minutes)...');
    await processEmails();
    setInterval(processEmails, POLL_INTERVAL_MS);
  } else {
    await processEmails();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

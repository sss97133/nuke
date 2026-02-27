#!/usr/bin/env node
/**
 * gmail-poller.mjs — Gmail Alert Email Poller for Nuke
 *
 * Polls toymachine91@gmail.com for vehicle listing alert emails and pipes
 * them into the process-alert-email edge function, which extracts listing
 * URLs and queues them into the Nuke pipeline.
 *
 * ─── FIRST-TIME SETUP (one-time, takes ~2 minutes) ───────────────────────────
 *
 * 1. Verify your Google Cloud project has Gmail API enabled:
 *    https://console.cloud.google.com/apis/library/gmail.googleapis.com
 *    (Project ID matches your GOOGLE_CLIENT_ID prefix: 930832753018)
 *    If not enabled: click "Enable", takes 30 seconds.
 *
 * 2. In Google Cloud Console → APIs & Credentials → OAuth 2.0 Client IDs,
 *    find the client and add to "Authorized redirect URIs":
 *      http://localhost:9876/oauth/callback
 *    (Only needed if the client doesn't already have it)
 *
 * 3. Run the interactive OAuth setup:
 *    dotenvx run -- node scripts/gmail-poller.mjs --setup
 *    → Opens browser, you log in as toymachine91@gmail.com, paste the code
 *    → Saves GOOGLE_REFRESH_TOKEN to .env automatically
 *
 * 4. Start the daemon (polls every 5 minutes):
 *    dotenvx run -- node scripts/gmail-poller.mjs --daemon
 *    (or: nohup dotenvx run -- node scripts/gmail-poller.mjs --daemon > /tmp/gmail-poller.log 2>&1 &)
 *
 * 5. OPTIONAL: Deploy as Supabase edge function + pg_cron job instead of daemon:
 *    supabase secrets set GOOGLE_REFRESH_TOKEN=<token from step 3>
 *    supabase functions deploy gmail-alert-poller --no-verify-jwt
 *    (then the DB cron job every 5min does it automatically)
 *
 * ─── ENVIRONMENT VARIABLES ───────────────────────────────────────────────────
 *
 * Required (already in .env):
 *   GOOGLE_CLIENT_ID      — OAuth2 client ID
 *   GOOGLE_CLIENT_SECRET  — OAuth2 client secret
 *   VITE_SUPABASE_URL     — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY — Service role key for calling edge functions
 *
 * Added by --setup:
 *   GOOGLE_REFRESH_TOKEN  — Long-lived token, written to .env by --setup
 *
 * ─── USAGE ───────────────────────────────────────────────────────────────────
 *
 *   # One-time OAuth setup
 *   dotenvx run -- node scripts/gmail-poller.mjs --setup
 *
 *   # Run once (process all unread alerts, mark as read)
 *   dotenvx run -- node scripts/gmail-poller.mjs --once
 *
 *   # Run as daemon (polls every 5 minutes forever)
 *   dotenvx run -- node scripts/gmail-poller.mjs --daemon
 *
 *   # Dry run (list matching emails, don't mark as read or queue)
 *   dotenvx run -- node scripts/gmail-poller.mjs --dry-run
 *
 * ─── WHAT IT DOES ────────────────────────────────────────────────────────────
 *
 *   1. Refreshes OAuth2 access token from refresh token
 *   2. Searches Gmail for unread alert emails from vehicle listing sites
 *   3. For each matching email: extracts subject, from, body (text + HTML)
 *   4. POSTs to process-alert-email edge function as JSON
 *   5. Marks email as read so it's not re-processed
 *   6. Logs results
 *
 * ─── SEARCH QUERY ────────────────────────────────────────────────────────────
 *
 * Matches emails from:
 *   bringatrailer.com, craigslist.org, ksl.com, hemmings.com, ebay.com,
 *   hagerty.com, carsandbids.com, cars.com, autotrader.com, cargurus.com,
 *   classiccars.com, pcarmarket.com, facebook.com (marketplace alerts)
 * OR subject contains: "vehicle alert", "listing alert", "saved search",
 *   "new listing", "price drop", "price alert", "search alert"
 */

import { createServer } from 'http';
import { readFileSync, writeFileSync } from 'fs';
import { open } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '..', '.env');

// ─── Config ──────────────────────────────────────────────────────────────────

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const REDIRECT_URI = 'http://localhost:9876/oauth/callback';
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Gmail search query — catches alerts from all major vehicle listing sites
const GMAIL_QUERY = [
  'is:unread',
  '(',
  '  from:bringatrailer.com',
  '  OR from:craigslist.org',
  '  OR from:ksl.com',
  '  OR from:hemmings.com',
  '  OR from:ebay.com',
  '  OR from:hagerty.com',
  '  OR from:carsandbids.com',
  '  OR from:cars.com',
  '  OR from:autotrader.com',
  '  OR from:cargurus.com',
  '  OR from:classiccars.com',
  '  OR from:pcarmarket.com',
  '  OR from:facebookmail.com',
  '  OR subject:"vehicle alert"',
  '  OR subject:"listing alert"',
  '  OR subject:"saved search"',
  '  OR subject:"new listing"',
  '  OR subject:"price drop"',
  '  OR subject:"price alert"',
  '  OR subject:"search alert"',
  '  OR subject:"new result"',
  ')',
].join(' ');

// ─── CLI Args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const isDaemon = args.includes('--daemon');
const isSetup = args.includes('--setup');
const isOnce = args.includes('--once') || (!isDaemon && !isSetup);
const isDryRun = args.includes('--dry-run');

// ─── OAuth2 Token Management ──────────────────────────────────────────────────

async function refreshAccessToken(refreshToken) {
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await resp.json();
  if (!data.access_token) {
    throw new Error(`Failed to refresh token: ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

// ─── Gmail API Helpers ────────────────────────────────────────────────────────

async function gmailRequest(accessToken, path, options = {}) {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me${path}`;
  const resp = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Gmail API ${path} → ${resp.status}: ${text.slice(0, 300)}`);
  }
  return resp.json();
}

async function listMatchingMessages(accessToken) {
  const result = await gmailRequest(
    accessToken,
    `/messages?q=${encodeURIComponent(GMAIL_QUERY)}&maxResults=50`
  );
  return result.messages || [];
}

async function getMessage(accessToken, messageId) {
  return gmailRequest(accessToken, `/messages/${messageId}?format=full`);
}

async function markAsRead(accessToken, messageId) {
  return gmailRequest(accessToken, `/messages/${messageId}/modify`, {
    method: 'POST',
    body: { removeLabelIds: ['UNREAD'] },
  });
}

// ─── Email Parsing ────────────────────────────────────────────────────────────

function decodeBase64Url(encoded) {
  if (!encoded) return '';
  // Gmail uses base64url encoding
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  try {
    return Buffer.from(base64, 'base64').toString('utf-8');
  } catch {
    return '';
  }
}

function getHeader(headers, name) {
  const lower = name.toLowerCase();
  const h = headers.find((h) => h.name.toLowerCase() === lower);
  return h?.value || '';
}

function extractBody(payload) {
  let textPlain = '';
  let textHtml = '';

  function walk(part) {
    if (!part) return;
    const mimeType = part.mimeType || '';

    if (mimeType === 'text/plain' && part.body?.data) {
      textPlain += decodeBase64Url(part.body.data);
    } else if (mimeType === 'text/html' && part.body?.data) {
      textHtml += decodeBase64Url(part.body.data);
    } else if (mimeType.startsWith('multipart/')) {
      for (const subPart of part.parts || []) {
        walk(subPart);
      }
    }
  }

  // Single-part message
  if (payload.body?.data) {
    const decoded = decodeBase64Url(payload.body.data);
    if (payload.mimeType === 'text/plain') textPlain = decoded;
    else textHtml = decoded;
  }

  // Multi-part message
  for (const part of payload.parts || []) {
    walk(part);
  }

  return { text: textPlain, html: textHtml };
}

function parseEmail(message) {
  const headers = message.payload?.headers || [];
  const from = getHeader(headers, 'From');
  const to = getHeader(headers, 'To');
  const subject = getHeader(headers, 'Subject');
  const messageId = getHeader(headers, 'Message-Id');
  const date = getHeader(headers, 'Date');
  const { text, html } = extractBody(message.payload || {});

  return { from, to, subject, messageId, date, text, html };
}

// ─── Process Email → Edge Function ───────────────────────────────────────────

async function processEmail(email) {
  const { from, to, subject, messageId, text, html } = email;

  console.log(`[gmail-poller] Processing: "${subject.slice(0, 80)}"`);
  console.log(`[gmail-poller]   From: ${from.slice(0, 60)}`);

  if (isDryRun) {
    console.log(`[gmail-poller]   DRY RUN — skipping queue`);
    return { queued: 0, urls_found: 0, dry_run: true };
  }

  const payload = {
    from,
    to,
    subject,
    text,
    html,
    messageId,
    // Also include alternate field names for compatibility
    From: from,
    To: to,
    Subject: subject,
    TextBody: text,
    HtmlBody: html,
    MessageID: messageId,
  };

  const resp = await fetch(
    `${SUPABASE_URL}/functions/v1/process-alert-email`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify(payload),
    }
  );

  const result = await resp.json();

  if (result.success) {
    console.log(
      `[gmail-poller]   OK: source=${result.source}, urls_found=${result.urls_found}, queued=${result.queued}`
    );
  } else {
    console.warn(`[gmail-poller]   WARN: ${result.error || JSON.stringify(result)}`);
  }

  return result;
}

// ─── Poll Cycle ───────────────────────────────────────────────────────────────

async function pollOnce() {
  if (!REFRESH_TOKEN) {
    throw new Error(
      'GOOGLE_REFRESH_TOKEN not set. Run: dotenvx run -- node scripts/gmail-poller.mjs --setup'
    );
  }

  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env');
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error('VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  }

  console.log(`[gmail-poller] ${new Date().toISOString()} — polling...`);

  // Refresh access token
  const accessToken = await refreshAccessToken(REFRESH_TOKEN);

  // Find matching unread emails
  const messages = await listMatchingMessages(accessToken);
  console.log(`[gmail-poller] Found ${messages.length} unread alert email(s)`);

  if (messages.length === 0) {
    return { processed: 0, queued: 0, errors: [] };
  }

  let totalQueued = 0;
  let totalUrlsFound = 0;
  const errors = [];

  for (const { id } of messages) {
    try {
      // Fetch full message
      const message = await getMessage(accessToken, id);
      const email = parseEmail(message);

      // Process through edge function
      const result = await processEmail(email);

      totalUrlsFound += result.urls_found || 0;
      totalQueued += result.queued || 0;

      // Mark as read after successful processing
      if (!isDryRun) {
        await markAsRead(accessToken, id);
      }
    } catch (err) {
      console.error(`[gmail-poller] Error processing message ${id}:`, err.message);
      errors.push({ messageId: id, error: err.message });
    }
  }

  const summary = {
    processed: messages.length,
    urls_found: totalUrlsFound,
    queued: totalQueued,
    errors,
  };

  console.log(`[gmail-poller] Done: ${JSON.stringify(summary)}`);
  return summary;
}

// ─── OAuth Setup Flow ─────────────────────────────────────────────────────────

async function runSetup() {
  console.log('\n=== Gmail OAuth2 Setup for Nuke ===\n');

  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('ERROR: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be in .env');
    console.error('They should already be there — run: cat .env | grep GOOGLE');
    process.exit(1);
  }

  // Build authorization URL
  const scopes = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.modify', // needed to mark as read
  ].join(' ');

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', scopes);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent'); // force to get refresh_token
  authUrl.searchParams.set('login_hint', 'toymachine91@gmail.com');

  console.log('Steps:');
  console.log('  1. A browser window will open (or copy the URL below)');
  console.log('  2. Log in as toymachine91@gmail.com if not already');
  console.log('  3. Grant Gmail read/modify access');
  console.log('  4. The setup completes automatically\n');

  console.log('Authorization URL:');
  console.log(authUrl.toString());
  console.log('');

  // Try to open browser
  try {
    const { exec } = await import('child_process');
    exec(`open "${authUrl.toString()}"`);
    console.log('(Browser opened automatically)');
  } catch {
    console.log('(Open the URL above manually)');
  }

  // Start local HTTP server to catch the redirect
  let resolveCode;
  const codePromise = new Promise((resolve) => { resolveCode = resolve; });

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost:9876');
    if (url.pathname === '/oauth/callback') {
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`<h2>Error: ${error}</h2><p>Close this window and try again.</p>`);
        resolveCode(null);
        return;
      }

      if (code) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <h2 style="color:green;font-family:sans-serif">Auth successful!</h2>
          <p style="font-family:sans-serif">Close this window. The refresh token has been saved to .env</p>
        `);
        resolveCode(code);
        return;
      }
    }

    res.writeHead(404);
    res.end('Not found');
  });

  await new Promise((resolve) => server.listen(9876, resolve));
  console.log('\nWaiting for OAuth callback on http://localhost:9876 ...');

  const code = await codePromise;
  server.close();

  if (!code) {
    console.error('\nAuth failed or was denied. Try again.');
    process.exit(1);
  }

  // Exchange code for tokens
  console.log('\nExchanging authorization code for tokens...');
  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      code,
      grant_type: 'authorization_code',
    }),
  });

  const tokens = await tokenResp.json();

  if (!tokens.refresh_token) {
    console.error('ERROR: No refresh_token in response:', JSON.stringify(tokens));
    console.error('This usually means consent was not shown. Try revoking access at:');
    console.error('  https://myaccount.google.com/permissions');
    console.error('Then run --setup again.');
    process.exit(1);
  }

  const refreshToken = tokens.refresh_token;
  console.log(`\nRefresh token obtained: ${refreshToken.slice(0, 20)}...`);

  // Append to .env (dotenvx-compatible format)
  try {
    const envContent = readFileSync(ENV_PATH, 'utf-8');

    if (envContent.includes('GOOGLE_REFRESH_TOKEN=')) {
      // Replace existing (handles empty or old value)
      const updated = envContent.replace(
        /^GOOGLE_REFRESH_TOKEN=.*$/m,
        `GOOGLE_REFRESH_TOKEN=${refreshToken}`
      );
      writeFileSync(ENV_PATH, updated);
      console.log('Updated GOOGLE_REFRESH_TOKEN in .env');
    } else {
      // Append after the GOOGLE_CLIENT_SECRET line
      const updated = envContent.replace(
        /^(GOOGLE_CLIENT_SECRET=.*)$/m,
        `$1\nGOOGLE_REFRESH_TOKEN=${refreshToken}`
      );
      writeFileSync(ENV_PATH, updated);
      console.log('Added GOOGLE_REFRESH_TOKEN to .env');
    }
  } catch (err) {
    console.warn(`Could not write to .env: ${err.message}`);
    console.log(`\nManually add to .env:\nGOOGLE_REFRESH_TOKEN=${refreshToken}`);
  }

  console.log('\n=== Setup complete! ===\n');
  console.log('Next steps:');
  console.log('');
  console.log('  Option A — Run as local daemon (polls every 5 min):');
  console.log('    dotenvx run -- node scripts/gmail-poller.mjs --daemon');
  console.log('    (or background: nohup dotenvx run -- node scripts/gmail-poller.mjs --daemon > /tmp/gmail-poller.log 2>&1 &)');
  console.log('');
  console.log('  Option B — Deploy as Supabase edge function (runs automatically via cron):');
  console.log(`    supabase secrets set GOOGLE_REFRESH_TOKEN=${refreshToken}`);
  console.log('    supabase functions deploy gmail-alert-poller --no-verify-jwt');
  console.log('    # Then add the pg_cron job (see migration file)');
  console.log('');
  console.log('  Test it now:');
  console.log('    dotenvx run -- node scripts/gmail-poller.mjs --once');
  console.log('');

  process.exit(0);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (isSetup) {
    await runSetup();
    return;
  }

  if (isDaemon) {
    console.log(`[gmail-poller] Starting daemon (interval: ${POLL_INTERVAL_MS / 1000}s)`);
    console.log(`[gmail-poller] Ctrl+C to stop`);

    // Poll immediately then on interval
    await pollOnce().catch((err) => console.error('[gmail-poller] Poll error:', err.message));

    setInterval(async () => {
      await pollOnce().catch((err) => console.error('[gmail-poller] Poll error:', err.message));
    }, POLL_INTERVAL_MS);

    // Keep alive
    process.stdin.resume();
    return;
  }

  // Default: --once
  const result = await pollOnce();
  console.log('[gmail-poller] Result:', JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error('[gmail-poller] Fatal:', err.message);
  process.exit(1);
});

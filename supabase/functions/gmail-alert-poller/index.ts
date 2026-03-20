/**
 * gmail-alert-poller — Supabase Edge Function
 *
 * Polls Gmail for vehicle listing alert emails and pipes them into the
 * process-alert-email edge function. Designed to be called on a pg_cron
 * schedule every 5 minutes.
 *
 * SETUP:
 * 1. Get refresh token:
 *    dotenvx run -- node scripts/gmail-poller.mjs --setup
 * 2. Set Supabase secret:
 *    supabase secrets set GOOGLE_REFRESH_TOKEN=<token>
 * 3. Deploy:
 *    supabase functions deploy gmail-alert-poller --no-verify-jwt
 * 4. Add pg_cron job (see migration):
 *    supabase db push (or apply migration manually)
 *
 * The pg_cron job calls this function every 5 minutes (see migration file).
 *
 * ENVIRONMENT VARIABLES (set via `supabase secrets set`):
 *   GOOGLE_CLIENT_ID       — OAuth2 client ID
 *   GOOGLE_CLIENT_SECRET   — OAuth2 client secret
 *   GOOGLE_REFRESH_TOKEN   — Long-lived refresh token (from --setup)
 *   SUPABASE_URL           — Auto-set by Supabase runtime
 *   SUPABASE_SERVICE_ROLE_KEY — Auto-set by Supabase runtime
 */


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Gmail search query ────────────────────────────────────────────────────────

const GMAIL_QUERY = [
  "is:unread",
  "(",
  "from:bringatrailer.com",
  "OR from:craigslist.org",
  "OR from:ksl.com",
  "OR from:hemmings.com",
  "OR from:ebay.com",
  "OR from:hagerty.com",
  "OR from:carsandbids.com",
  "OR from:cars.com",
  "OR from:autotrader.com",
  "OR from:cargurus.com",
  "OR from:classiccars.com",
  "OR from:pcarmarket.com",
  "OR from:facebookmail.com",
  "OR subject:\"vehicle alert\"",
  "OR subject:\"listing alert\"",
  "OR subject:\"saved search\"",
  "OR subject:\"new listing\"",
  "OR subject:\"price drop\"",
  "OR subject:\"price alert\"",
  "OR subject:\"search alert\"",
  "OR subject:\"new result\"",
  ")",
].join(" ");

// ─── OAuth2 ────────────────────────────────────────────────────────────────────

async function refreshAccessToken(): Promise<string> {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  const refreshToken = Deno.env.get("GOOGLE_REFRESH_TOKEN");

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Missing Google OAuth credentials. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN via `supabase secrets set`"
    );
  }

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const data = await resp.json();
  if (!data.access_token) {
    throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

// ─── Gmail API ─────────────────────────────────────────────────────────────────

async function gmailGet(accessToken: string, path: string): Promise<any> {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me${path}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Gmail GET ${path} → ${resp.status}: ${text.slice(0, 200)}`);
  }
  return resp.json();
}

async function gmailPost(accessToken: string, path: string, body: unknown): Promise<any> {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me${path}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Gmail POST ${path} → ${resp.status}: ${text.slice(0, 200)}`);
  }
  return resp.json();
}

// ─── Email parsing ─────────────────────────────────────────────────────────────

function decodeBase64Url(encoded: string): string {
  if (!encoded) return "";
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  try {
    // Deno/edge runtime — use atob
    return atob(base64);
  } catch {
    return "";
  }
}

function getHeader(headers: Array<{ name: string; value: string }>, name: string): string {
  const lower = name.toLowerCase();
  return headers.find((h) => h.name.toLowerCase() === lower)?.value || "";
}

function extractBody(payload: any): { text: string; html: string } {
  let text = "";
  let html = "";

  function walk(part: any) {
    if (!part) return;
    const mime = part.mimeType || "";
    if (mime === "text/plain" && part.body?.data) {
      text += decodeBase64Url(part.body.data);
    } else if (mime === "text/html" && part.body?.data) {
      html += decodeBase64Url(part.body.data);
    } else if (mime.startsWith("multipart/")) {
      for (const sub of part.parts || []) walk(sub);
    }
  }

  if (payload.body?.data) {
    const decoded = decodeBase64Url(payload.body.data);
    if (payload.mimeType === "text/plain") text = decoded;
    else html = decoded;
  }
  for (const part of payload.parts || []) walk(part);

  return { text, html };
}

function parseMessage(message: any): {
  from: string;
  to: string;
  subject: string;
  messageId: string;
  text: string;
  html: string;
} {
  const headers = message.payload?.headers || [];
  const { text, html } = extractBody(message.payload || {});
  return {
    from: getHeader(headers, "From"),
    to: getHeader(headers, "To"),
    subject: getHeader(headers, "Subject"),
    messageId: getHeader(headers, "Message-Id"),
    text,
    html,
  };
}

// ─── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    console.log("[gmail-poller] Starting poll cycle");

    // Refresh access token
    let accessToken: string;
    try {
      accessToken = await refreshAccessToken();
    } catch (err: any) {
      console.error("[gmail-poller] Token refresh failed:", err.message);
      return new Response(
        JSON.stringify({
          success: false,
          error: `OAuth token refresh failed: ${err.message}`,
          setup_required: err.message.includes("Missing Google OAuth"),
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // List matching unread messages
    const listResult = await gmailGet(
      accessToken,
      `/messages?q=${encodeURIComponent(GMAIL_QUERY)}&maxResults=50`
    );
    const messages: Array<{ id: string }> = listResult.messages || [];

    console.log(`[gmail-poller] Found ${messages.length} unread alert email(s)`);

    if (messages.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          processed: 0,
          queued: 0,
          urls_found: 0,
          errors: [],
          duration_ms: Date.now() - startTime,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const processAlertUrl = `${supabaseUrl}/functions/v1/process-alert-email`;

    let totalQueued = 0;
    let totalUrlsFound = 0;
    const errors: Array<{ messageId: string; error: string }> = [];

    for (const { id } of messages) {
      try {
        // Fetch full message
        const message = await gmailGet(accessToken, `/messages/${id}?format=full`);
        const email = parseMessage(message);

        console.log(`[gmail-poller] Processing: "${email.subject.slice(0, 80)}"`);

        // POST to process-alert-email (JSON format)
        const alertResp = await fetch(processAlertUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({
            from: email.from,
            to: email.to,
            subject: email.subject,
            text: email.text,
            html: email.html,
            messageId: email.messageId,
            // Alternate field names for compatibility
            From: email.from,
            To: email.to,
            Subject: email.subject,
            TextBody: email.text,
            HtmlBody: email.html,
            MessageID: email.messageId,
          }),
        });

        const result = await alertResp.json();
        totalUrlsFound += result.urls_found || 0;
        totalQueued += result.queued || 0;

        if (result.success) {
          console.log(
            `[gmail-poller] OK: source=${result.source}, urls_found=${result.urls_found}, queued=${result.queued}`
          );
        } else {
          console.warn(`[gmail-poller] process-alert-email error: ${result.error}`);
        }

        // Mark as read
        await gmailPost(accessToken, `/messages/${id}/modify`, {
          removeLabelIds: ["UNREAD"],
        });
      } catch (err: any) {
        console.error(`[gmail-poller] Error on message ${id}:`, err.message);
        errors.push({ messageId: id, error: err.message });
      }
    }

    const summary = {
      success: true,
      processed: messages.length,
      urls_found: totalUrlsFound,
      queued: totalQueued,
      errors,
      duration_ms: Date.now() - startTime,
    };

    console.log("[gmail-poller] Summary:", JSON.stringify(summary));

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[gmail-poller] Fatal error:", err.message);
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

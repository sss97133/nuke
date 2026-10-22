/**
 * NUKE OAuth 2.0 Server — Claude.ai (mobile + web) MCP connector compatible.
 *
 * Implements RFC 6749 (OAuth 2.0), RFC 7636 (PKCE), RFC 7591 (DCR), RFC 8414 (metadata),
 * and the MCP authorization spec (2025-03-26).
 *
 * One edge function, path-dispatched. Vercel rewrites point /.well-known/* and
 * /oauth/* at this function.
 *
 * Issued access tokens are opaque, revocable credentials backed by existing api_keys.
 * The browser confirms the actual user; account membership remains the resource authority.
 * Legacy self-minted JWTs are never accepted as these credentials.
 *
 * Authentication is via Supabase magic link. /oauth/authorize renders a minimal
 * email-input page; submitting it generates a Supabase magic link whose redirect
 * lands on /oauth/callback, which then redirects the user back to the OAuth
 * client's redirect_uri with an authorization code.
 *
 * @owner external-agent-write-api
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { projectSecretKey } from "../_shared/supabaseKeys.ts";
import { OAUTH_SCOPES, DEFAULT_OAUTH_SCOPE, validOAuthScope, validOAuthLogin, validCodeVerifier, validRedirectUri } from "./oauthPolicy.ts";

// ── Constants ────────────────────────────────────────────────────────────────

const ISSUER = "https://nuke.ag";
const AUTHORIZATION_ENDPOINT = `${ISSUER}/oauth/authorize`;
const TOKEN_ENDPOINT = `${ISSUER}/oauth/token`;
const REGISTRATION_ENDPOINT = `${ISSUER}/oauth/register`;
const REVOCATION_ENDPOINT = `${ISSUER}/oauth/revoke`;
const RESOURCE_METADATA_ENDPOINT = `${ISSUER}/.well-known/oauth-protected-resource`;
const LOGIN_ENDPOINT = `${ISSUER}/oauth/login`;
const CALLBACK_ENDPOINT = `${ISSUER}/oauth/callback`;
const CALLBACK_FINISH_ENDPOINT = `${ISSUER}/oauth/callback-finish`;
const MCP_RESOURCE = `${ISSUER}/mcp`;

const SCOPES_SUPPORTED = OAUTH_SCOPES;
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;          // 1 hour
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const CODE_TTL_SECONDS = 60 * 10;                  // 10 minutes
const LOGIN_SESSION_TTL_SECONDS = 60 * 15;         // 15 minutes

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-api-key, accept",
  "Access-Control-Max-Age": "86400",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function jsonResp(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json", "cache-control": "no-store", ...extra },
  });
}

function htmlResp(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: {
      ...CORS,
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "content-security-policy": "frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
    },
  });
}

function redirectResp(url: string): Response {
  return new Response(null, { status: 302, headers: { ...CORS, location: url } });
}

function randomToken(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function base64UrlSha256(input: string): Promise<string> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)).then((buf) => {
    const bytes = new Uint8Array(buf);
    let str = "";
    for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
    return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  });
}

function getEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

// Structured telemetry. Hard rule: NEVER log secrets in plaintext.
// For secrets (code, access_token, refresh_token, code_verifier) log lengths only via maskLen().
// Tail with: supabase functions logs oauth-server --tail | jq 'select(.event)'
function logEvent(event: string, fields: Record<string, unknown> = {}): void {
  try {
    console.log(JSON.stringify({
      event,
      timestamp: new Date().toISOString(),
      ...fields,
    }));
  } catch {
    console.log(JSON.stringify({ event, timestamp: new Date().toISOString(), log_serialize_error: true }));
  }
}

function maskLen(v: string | null | undefined): number {
  return typeof v === "string" ? v.length : 0;
}

function makeServiceClient() {
  return createClient(getEnv("SUPABASE_URL"), projectSecretKey()!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ── Route: GET /.well-known/oauth-authorization-server ───────────────────────

function handleAuthServerMetadata(): Response {
  logEvent("oauth_authorization_server_metadata");
  return jsonResp({
    issuer: ISSUER,
    authorization_endpoint: AUTHORIZATION_ENDPOINT,
    token_endpoint: TOKEN_ENDPOINT,
    registration_endpoint: REGISTRATION_ENDPOINT,
    revocation_endpoint: REVOCATION_ENDPOINT,
    scopes_supported: SCOPES_SUPPORTED,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    service_documentation: `${ISSUER}/api/docs`,
  });
}

// ── Route: GET /.well-known/oauth-protected-resource ─────────────────────────

function handleResourceMetadata(): Response {
  logEvent("oauth_protected_resource_metadata");
  return jsonResp({
    resource: MCP_RESOURCE,
    authorization_servers: [ISSUER],
    scopes_supported: SCOPES_SUPPORTED,
    bearer_methods_supported: ["header"],
    resource_documentation: `${ISSUER}/api/docs`,
  });
}

// ── Route: POST /oauth/register (RFC 7591 DCR) ───────────────────────────────

interface DcrRequestBody {
  client_name?: string;
  redirect_uris?: string[];
  grant_types?: string[];
  response_types?: string[];
  token_endpoint_auth_method?: string;
  scope?: string;
}

async function handleDcr(req: Request): Promise<Response> {
  let body: DcrRequestBody = {};
  try {
    body = await req.json();
  } catch {
    logEvent("oauth_register", { ok: false, reason: "invalid_json" });
    return jsonResp({ error: "invalid_client_metadata", error_description: "Body must be valid JSON" }, 400);
  }
  logEvent("oauth_register", {
    client_name: body.client_name ?? null,
    redirect_uris_count: Array.isArray(body.redirect_uris) ? body.redirect_uris.length : 0,
    grant_types: body.grant_types ?? null,
    token_endpoint_auth_method: body.token_endpoint_auth_method ?? "none",
    scope: body.scope ?? null,
    user_agent: req.headers.get("user-agent") ?? null,
  });

  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u) => typeof u === "string") : [];
  if (redirectUris.length === 0) {
    return jsonResp({ error: "invalid_redirect_uri", error_description: "At least one redirect_uri is required" }, 400);
  }
  for (const u of redirectUris) {
    if (!validRedirectUri(u)) {
      return jsonResp({ error: "invalid_redirect_uri", error_description: `Invalid redirect_uri: ${u}` }, 400);
    }
  }

  const clientId = "nuke_" + randomToken(16);
  const tokenAuthMethod = body.token_endpoint_auth_method ?? "none";
  if (tokenAuthMethod !== "none" || !validOAuthScope(body.scope ?? DEFAULT_OAUTH_SCOPE)) return jsonResp({error:"invalid_client_metadata"},400);
  let clientSecret: string | undefined;
  let clientSecretHash: string | null = null;
  if (tokenAuthMethod !== "none") {
    clientSecret = randomToken(32);
    clientSecretHash = await sha256Hex(clientSecret);
  }

  const supabase = makeServiceClient();
  const { error } = await supabase.from("oauth_clients").insert({
    client_id: clientId,
    client_secret_hash: clientSecretHash,
    client_name: body.client_name ?? "Unknown Client",
    redirect_uris: redirectUris,
    grant_types: Array.isArray(body.grant_types) && body.grant_types.length > 0
      ? body.grant_types
      : ["authorization_code", "refresh_token"],
    response_types: Array.isArray(body.response_types) && body.response_types.length > 0
      ? body.response_types
      : ["code"],
    token_endpoint_auth_method: tokenAuthMethod,
    scope: body.scope ?? DEFAULT_OAUTH_SCOPE,
  });

  if (error) {
    console.error("[oauth-server] DCR insert error:", error.message);
    return jsonResp({ error: "server_error", error_description: error.message }, 500);
  }

  const resp: Record<string, unknown> = {
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: body.client_name ?? "Unknown Client",
    redirect_uris: redirectUris,
    grant_types: body.grant_types ?? ["authorization_code", "refresh_token"],
    response_types: body.response_types ?? ["code"],
    token_endpoint_auth_method: tokenAuthMethod,
    scope: body.scope ?? DEFAULT_OAUTH_SCOPE,
  };
  if (clientSecret) resp.client_secret = clientSecret;

  return jsonResp(resp, 201);
}

// ── Route: GET /oauth/authorize ──────────────────────────────────────────────

async function handleAuthorize(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const params = url.searchParams;
  const clientId = params.get("client_id") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";
  const responseType = params.get("response_type") ?? "code";
  const scope = params.get("scope") ?? DEFAULT_OAUTH_SCOPE;
  if (!validOAuthScope(scope)) return errorPage("Unsupported OAuth scope");
  const state = params.get("state") ?? "";
  const codeChallenge = params.get("code_challenge") ?? "";
  const codeChallengeMethod = params.get("code_challenge_method") ?? "S256";

  logEvent("oauth_authorize", {
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: responseType,
    scope,
    state_len: maskLen(state),
    code_challenge_len: maskLen(codeChallenge),
    code_challenge_method: codeChallengeMethod,
    user_agent: req.headers.get("user-agent") ?? null,
  });

  if (!clientId) return errorPage("missing client_id");
  if (!redirectUri) return errorPage("missing redirect_uri");
  if (responseType !== "code") return errorPage("Unsupported response type");
  if (!codeChallenge) return errorPage("PKCE required: code_challenge");
  if (codeChallengeMethod !== "S256") return errorPage("code_challenge_method must be S256");

  const supabase = makeServiceClient();
  const { data: client } = await supabase.from("oauth_clients").select("client_id, redirect_uris, client_name, token_endpoint_auth_method").eq("client_id", clientId).maybeSingle();
  if (!client) return errorPage(`unknown client_id: ${clientId}`);

  const allowed = (client.redirect_uris as string[] | null | undefined) ?? [];
  if (!validOAuthLogin({redirect_uri:redirectUri,scope,code_challenge:codeChallenge,code_challenge_method:codeChallengeMethod},client)) return errorPage(`redirect_uri not registered for this client: ${redirectUri}`);

  // Render minimal login page. User enters email; submit POSTs to /oauth/login.
  const escapedClientName = String(client.client_name ?? "the application").replace(/[<>&"']/g, (c) => ({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&#39;"}[c] as string));
  const params2 = encodeURIComponent(JSON.stringify({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod,
  }));

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>NUKE — Authorize</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { margin: 0; padding: 16px; font-family: Arial, sans-serif; background: #f5f5f5; color: #111; }
    .card { max-width: 420px; margin: 40px auto; background: #fff; border: 2px solid #111; padding: 24px 20px; }
    h1 { font-size: 14px; letter-spacing: 2px; text-transform: uppercase; margin: 0 0 12px; }
    p  { font-size: 13px; line-height: 1.5; }
    label { display: block; font-size: 9px; letter-spacing: 1px; text-transform: uppercase; margin: 16px 0 6px; }
    input[type=email] { width: 100%; padding: 10px; border: 2px solid #111; font-family: 'Courier New', monospace; font-size: 16px; }
    button { margin-top: 16px; width: 100%; padding: 12px; background: #111; color: #fff; border: 2px solid #111; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; cursor: pointer; }
    .meta { margin-top: 16px; font-size: 10px; color: #666; }
    .pill { display: inline-block; padding: 2px 6px; border: 1px solid #ccc; font-size: 10px; font-family: 'Courier New', monospace; margin-right: 4px; }
    .scopes { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
    .scopes code { font-size: 11px; padding: 2px 6px; background: #f0f0f0; border: 1px solid #ddd; overflow-wrap: anywhere; }
    .err  { color: #b00020; font-size: 11px; margin-top: 8px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Connect ${escapedClientName} to NUKE</h1>
    <p><strong>${escapedClientName}</strong> requests the permissions listed below for your account. Shared accounting access additionally requires an explicit book-owner grant. Accounting read includes private source evidence; accounting correct permits attributed revisions and preserves history.</p>
    <div class="meta scopes">
      <span class="pill">scope</span> ${scope.split(" ").filter(Boolean).map((s) => `<code>${s.replace(/[<>&"']/g, "")}</code>`).join(" ")}
    </div>
    <form method="post" action="${LOGIN_ENDPOINT}">
      <label for="email">Your NUKE email</label>
      <input id="email" name="email" type="email" required autocomplete="email" placeholder="you@example.com" />
      <input type="hidden" name="oauth_params" value="${params2}" />
      <button type="submit">Send magic link</button>
    </form>
    <p class="meta">We'll send a one-time login link. Click it to complete the connection.</p>
  </div>
</body>
</html>`;
  return htmlResp(html);
}

function errorPage(msg: string): Response {
  return htmlResp(`<!doctype html><meta charset="utf-8"><title>OAuth Error</title>
    <body style="font-family: Arial, sans-serif; max-width: 480px; margin: 80px auto; padding: 24px; border: 2px solid #b00020;">
    <h1 style="font-size: 14px; text-transform: uppercase; letter-spacing: 2px;">OAuth Error</h1>
    <p style="font-size: 13px;">${msg.replace(/[<>&]/g, (c) => ({"<":"&lt;",">":"&gt;","&":"&amp;"}[c] as string))}</p>
    </body>`, 400);
}

function redirectError(redirectUri: string, state: string, error: string, description?: string): Response {
  const u = new URL(redirectUri);
  u.searchParams.set("error", error);
  if (description) u.searchParams.set("error_description", description);
  if (state) u.searchParams.set("state", state);
  return redirectResp(u.toString());
}

// ── Route: POST /oauth/login (initiates magic link) ──────────────────────────

async function handleLogin(req: Request): Promise<Response> {
  logEvent("oauth_login", {
    content_type: req.headers.get("content-type") ?? null,
    user_agent: req.headers.get("user-agent") ?? null,
    referer: req.headers.get("referer") ?? null,
  });
  const ct = req.headers.get("content-type") ?? "";
  let email = "";
  let oauthParamsStr = "";
  if (ct.includes("application/x-www-form-urlencoded")) {
    const form = await req.formData();
    email = String(form.get("email") ?? "").trim().toLowerCase();
    oauthParamsStr = String(form.get("oauth_params") ?? "");
  } else if (ct.includes("application/json")) {
    const body = await req.json();
    email = String(body?.email ?? "").trim().toLowerCase();
    oauthParamsStr = String(body?.oauth_params ?? "");
  } else {
    return errorPage("Unsupported Content-Type for login");
  }

  if (!email || !email.includes("@")) return errorPage("Valid email required");
  let oauthParams: Record<string, string>;
  try {
    oauthParams = JSON.parse(decodeURIComponent(oauthParamsStr));
  } catch {
    return errorPage("Malformed oauth_params");
  }

  const oauthClient = await makeServiceClient().from("oauth_clients").select("redirect_uris,token_endpoint_auth_method").eq("client_id", oauthParams.client_id).maybeSingle();
  oauthParams.scope ??= DEFAULT_OAUTH_SCOPE;
  if (!validOAuthLogin(oauthParams, oauthClient.data)) return errorPage("Invalid OAuth client, redirect, scope, or PKCE challenge");
  const sessionId = randomToken(24);
  logEvent("oauth_login_session_created", {
    session_id: sessionId,
    email_domain: email.split("@")[1] ?? null,
    client_id: oauthParams.client_id ?? null,
    redirect_uri: oauthParams.redirect_uri ?? null,
    code_challenge_len: maskLen(oauthParams.code_challenge),
  });
  const supabase = makeServiceClient();
  const { error: insErr } = await supabase.from("oauth_login_sessions").insert({
    session_id: sessionId,
    client_id: oauthParams.client_id,
    redirect_uri: oauthParams.redirect_uri,
    scope: oauthParams.scope ?? null,
    state: oauthParams.state ?? null,
    code_challenge: oauthParams.code_challenge,
    code_challenge_method: oauthParams.code_challenge_method ?? "S256",
    email,
    expires_at: new Date(Date.now() + LOGIN_SESSION_TTL_SECONDS * 1000).toISOString(),
  });
  if (insErr) {
    console.error("[oauth-server] login_sessions insert:", insErr.message);
    return errorPage("Could not start login session");
  }

  // Send the magic link. signInWithOtp is the call that emails it; redirectTo points to /oauth/callback.
  // shouldCreateUser: false keeps this to registered NUKE accounts (an unknown email is refused, never created).
  // Measured 2026-10-01: the previous admin.generateLink call first minted a token without sending any email, which
  // started Supabase's per-user cooldown, so this send was refused with 429 one second later and the error was
  // swallowed: the page said "Check your email" and no email ever went out.
  const callbackUrl = `${CALLBACK_ENDPOINT}?session=${sessionId}`;
  const { error: otpErr } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: callbackUrl, shouldCreateUser: false },
  });
  if (otpErr) {
    console.error("[oauth-server] signInWithOtp error:", otpErr.status, otpErr.message);
    logEvent("oauth_login_magic_link_failed", { session_id: sessionId, status: otpErr.status ?? null });
    if (otpErr.status === 429) {
      return errorPage("A sign-in link was requested for this email moments ago. Wait one minute, then go back and try again.");
    }
    return errorPage("Could not send the sign-in link. Check that this email is registered with NUKE.");
  }

  logEvent("oauth_login_magic_link_sent", { session_id: sessionId });

  return htmlResp(`<!doctype html><meta charset="utf-8"><title>Check your email</title>
    <body style="font-family: Arial, sans-serif; max-width: 420px; margin: 80px auto; padding: 24px; border: 2px solid #111;">
    <h1 style="font-size: 14px; letter-spacing: 2px; text-transform: uppercase;">Check your email</h1>
    <p style="font-size: 13px;">We sent a magic link to <strong>${email.replace(/[<>&]/g, "")}</strong>. Click it to finish connecting.</p>
    <p style="font-size: 11px; color: #666;">The link is good for 15 minutes. You can close this window once you've clicked through.</p>
    </body>`);
}

// ── Route: GET /oauth/callback ───────────────────────────────────────────────

async function handleCallback(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("session") ?? "";
  logEvent("oauth_callback", {
    session_id: sessionId || null,
    has_access_token: !!url.searchParams.get("access_token"),
    has_token_hash: !!(url.searchParams.get("token_hash") ?? url.searchParams.get("token")),
    has_code: !!url.searchParams.get("code"),
    user_agent: req.headers.get("user-agent") ?? null,
  });
  if (!sessionId) return errorPage("missing session id");

  // Supabase magic link redirect appends #access_token=...&refresh_token=... as URL fragment.
  // But fragments aren't visible server-side. Supabase also supports ?token=...&type=magiclink
  // via verifyOtp. We'll look for either the access_token param OR a token (one-time-token).
  // Fall back to a second flow: PKCE-style code flow where ?code=... is provided.
  let accessToken = url.searchParams.get("access_token");
  const tokenHash = url.searchParams.get("token_hash") ?? url.searchParams.get("token");
  const codeParam = url.searchParams.get("code");

  const supabase = makeServiceClient();
  const { data: sess, error: sessErr } = await supabase.from("oauth_login_sessions")
    .select("*").eq("session_id", sessionId).maybeSingle();
  if (sessErr || !sess) return errorPage("session not found or expired");
  if (sess.completed_at) return errorPage("session already used");
  if (new Date(sess.expires_at) < new Date()) return errorPage("session expired");

  // Resolve user id via one of the supported magic-link return shapes.
  let userId: string | null = null;
  if (accessToken) {
    const { data: u } = await supabase.auth.getUser(accessToken);
    userId = u?.user?.id ?? null;
  }
  if (!userId && tokenHash) {
    const { data: v } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash } as any).catch(() => ({ data: null }));
    userId = (v as any)?.user?.id ?? null;
    accessToken = (v as any)?.session?.access_token ?? accessToken;
  }
  if (!userId && codeParam) {
    const { data: v } = await supabase.auth.exchangeCodeForSession(codeParam).catch(() => ({ data: null }));
    userId = (v as any)?.user?.id ?? null;
    accessToken = (v as any)?.session?.access_token ?? accessToken;
  }

  const { data: client } = await supabase.from('oauth_clients').select('client_name').eq('client_id',sess.client_id).maybeSingle();
  const escape = (value: unknown) => String(value ?? '').replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]!));
  // Authentication never constitutes client consent. Even an unsolicited magic link
  // stops here and shows the stored client, redirect destination and exact permissions.
  return htmlResp(`<!doctype html><meta charset="utf-8"><title>Approve connection</title>
<body style="font-family:Arial;max-width:520px;margin:48px auto;padding:24px;border:2px solid #111">
<h1>Approve this connection</h1><p><strong>${escape(client?.client_name || 'Registered client')}</strong> requests access as your account.</p>
<p>Client: ${escape(sess.client_id)}<br>Returns to: ${escape(sess.redirect_uri)}</p>
<p>Requested permissions: <strong>${escape(sess.scope)}</strong></p>
<p>Accounting read includes private books and original evidence. Accounting correct permits attributed corrections, preserving originals and prior interpretations. Shared books require the owner's explicit application grant. No filing, payment or SQL permission is granted.</p>
<button id="approve" type="button">Approve these permissions</button><p id="status" role="status"></p>
<script>
(() => {
 const frag = new URLSearchParams(location.hash.replace(/^#/,''));
 const access_token = ${JSON.stringify(accessToken).replace(/</g,'\\u003c')} || frag.get('access_token');
 history.replaceState(null,'',location.pathname + '?session=' + encodeURIComponent(${JSON.stringify(sessionId).replace(/</g,'\\u003c')}));
 const button=document.getElementById('approve'), status=document.getElementById('status');
 button.addEventListener('click', async () => {
  button.disabled=true;
  if(!access_token){status.textContent='Sign-in could not be verified. Request a new connection.';return;}
  const params = new URLSearchParams({ session: ${JSON.stringify(sessionId).replace(/</g,'\\u003c')}, access_token, consent: 'approve' });
  try {
   const res=await fetch('${CALLBACK_FINISH_ENDPOINT}',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body: params.toString()});
   const result=await res.json();
   if(res.ok && result.redirect){location.href=result.redirect;return;}
   status.textContent='Connection refused or expired. Request a new connection.';
  } catch {status.textContent='Connection could not finish. Try again.';button.disabled=false;}
 });
})();
</script></body>`);

}

async function handleCallbackFinish(req: Request): Promise<Response> {
  if (!req.headers.get("content-type")?.includes("application/x-www-form-urlencoded")) return jsonResp({error:"invalid_request"},400);
  const form = new URLSearchParams(await req.text());
  if (form.get("consent") !== "approve" || req.headers.get("origin") !== new URL(ISSUER).origin) return jsonResp({error:"explicit_consent_required"},403);
  const sessionId = form.get("session") ?? "";
  const accessToken = form.get("access_token") ?? "";
  logEvent("oauth_callback_finish", {
    session_id: sessionId || null,
    access_token_len: maskLen(accessToken),
  });
  if (!sessionId || !accessToken) return jsonResp({ error: "missing params" }, 400);
  const supabase = makeServiceClient();
  const { data: u } = await supabase.auth.getUser(accessToken);
  const userId = u?.user?.id;
  if (!userId) return jsonResp({ error: "could not resolve user from access_token" }, 400);
  return finishCallback(sessionId, userId, true);
}

async function finishCallback(sessionId: string, userId: string, jsonRedirect = false): Promise<Response> {
  const supabase = makeServiceClient();
  const code = randomToken(32);
  const { data: sess, error } = await supabase.rpc("finish_mcp_oauth_login", {p_session_id:sessionId,p_user_id:userId,p_code:code});
  if (error || !sess) return errorPage("Invalid, expired, or completed login session");

  const redir = new URL(sess.redirect_uri);
  redir.searchParams.set("code", code);
  if (sess.state) redir.searchParams.set("state", sess.state);

  logEvent("oauth_finish_code_issued", {
    session_id: sessionId,
    user_id: userId,
    client_id: sess.client_id,
    code_len: maskLen(code),
    redirect_uri: sess.redirect_uri,
  });

  return jsonRedirect ? jsonResp({redirect:redir.toString()}) : redirectResp(redir.toString());
}

// ── Route: POST /oauth/token ─────────────────────────────────────────────────

async function handleToken(req: Request): Promise<Response> {
  logEvent("oauth_token", {
    content_type: req.headers.get("content-type") ?? null,
    user_agent: req.headers.get("user-agent") ?? null,
  });
  const ct = req.headers.get("content-type") ?? "";
  let body: Record<string, string> = {};
  if (ct.includes("application/x-www-form-urlencoded")) {
    const form = await req.formData();
    for (const [k, v] of form.entries()) body[k] = String(v);
  } else if (ct.includes("application/json")) {
    body = await req.json();
  } else {
    return jsonResp({ error: "invalid_request", error_description: "Unsupported Content-Type" }, 400);
  }

  const grantType = body.grant_type;
  if (grantType === "authorization_code") return handleTokenAuthCode(body);
  if (grantType === "refresh_token") return handleTokenRefresh(body);
  return jsonResp({ error: "unsupported_grant_type" }, 400);
}

async function exchangeCredential(body: Record<string,string>): Promise<Response> {
  const refresh = body.grant_type === "refresh_token";
  if (!body.client_id || (refresh ? !/^nuke_refresh_[a-f0-9]{64}$/.test(body.refresh_token ?? "") : !body.code || !body.redirect_uri || !validCodeVerifier(body.code_verifier))) {
    return jsonResp({error:"invalid_grant"},400);
  }
  const accessToken = "nuke_oauth_" + randomToken(32);
  const refreshToken = ["nuke_refresh_", randomToken(32)].join("");
  const {data,error} = await makeServiceClient().rpc("exchange_mcp_oauth_credential", {
    p_grant_type: body.grant_type,
    p_credential: refresh ? "sha256_" + await sha256Hex(body.refresh_token) : body.code,
    p_client_id: body.client_id, p_redirect_uri: refresh ? null : body.redirect_uri,
    p_challenge: refresh ? null : await base64UrlSha256(body.code_verifier),
    p_access_hash: "sha256_" + await sha256Hex(accessToken),
    p_refresh_hash: "sha256_" + await sha256Hex(refreshToken),
  });
  if(error || !data) return jsonResp({error:"invalid_grant"},400);
  return jsonResp({access_token:accessToken,token_type:"Bearer",expires_in:ACCESS_TOKEN_TTL_SECONDS,refresh_token:refreshToken,scope:data.scopes.join(" ")});
}
async function handleTokenAuthCode(body: Record<string,string>): Promise<Response> { return exchangeCredential({...body,grant_type:"authorization_code"}); }
async function handleTokenRefresh(body: Record<string,string>): Promise<Response> { return exchangeCredential({...body,grant_type:"refresh_token"}); }
async function handleRevoke(req: Request): Promise<Response> {
  const form = new URLSearchParams(await req.text());
  const token = form.get("token") ?? ""; const client = form.get("client_id") ?? "";
  if (!client || !token) return jsonResp({error:"invalid_request"},400);
  const {error} = await makeServiceClient().rpc("revoke_mcp_oauth_credential",{p_token_hash:"sha256_"+await sha256Hex(token),p_client_id:client});
  return error ? jsonResp({error:"server_error"},503) : jsonResp({});
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/oauth-server/, "").replace(/\/$/, "") || "/";

  try {
    // Vercel rewrites land here with the original /.well-known/* and /oauth/* paths
    // OR Supabase edge runtime serves at /functions/v1/oauth-server/<route>.
    // Strip both.
    const route = path
      .replace(/^\/functions\/v1\/oauth-server/, "")
      .replace(/^\/oauth-server/, "")
      .replace(/\/$/, "") || "/";

    if (route === "/.well-known/oauth-authorization-server" && req.method === "GET") return handleAuthServerMetadata();
    if (route === "/.well-known/oauth-protected-resource" && req.method === "GET") return handleResourceMetadata();
    if (route === "/oauth/register" && req.method === "POST") return await handleDcr(req);
    if (route === "/oauth/authorize" && req.method === "GET") return await handleAuthorize(req);
    if (route === "/oauth/login" && req.method === "POST") return await handleLogin(req);
    if (route === "/oauth/callback" && req.method === "GET") return await handleCallback(req);
    if (route === "/oauth/callback-finish" && req.method === "POST") return await handleCallbackFinish(req);
    if (route === "/oauth/token" && req.method === "POST") return await handleToken(req);
    if (route === "/oauth/revoke" && req.method === "POST") return await handleRevoke(req);
    if (route === "/" || route === "") {
      return jsonResp({
        service: "nuke-oauth-server",
        endpoints: {
          metadata: "/.well-known/oauth-authorization-server",
          resource_metadata: "/.well-known/oauth-protected-resource",
          register: "/oauth/register",
          authorize: "/oauth/authorize",
          token: "/oauth/token",
          revoke: "/oauth/revoke",
        },
      });
    }
    return jsonResp({ error: "not_found", path: route }, 404);
  } catch (e) {
    console.error("[oauth-server] handler error:", e);
    logEvent("oauth_handler_error", { path, error_message: e instanceof Error ? e.message : String(e) });
    return jsonResp({ error: "server_error", error_description: e instanceof Error ? e.message : String(e) }, 500);
  }
});

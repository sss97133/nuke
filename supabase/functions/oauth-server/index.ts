/**
 * NUKE OAuth 2.0 Server — Claude.ai (mobile + web) MCP connector compatible.
 *
 * Implements RFC 6749 (OAuth 2.0), RFC 7636 (PKCE), RFC 7591 (DCR), RFC 8414 (metadata),
 * and the MCP authorization spec (2025-03-26).
 *
 * One edge function, path-dispatched. Vercel rewrites point /.well-known/* and
 * /oauth/* at this function.
 *
 * Issued access tokens are Supabase-compatible JWTs (HS256 with SUPABASE_JWT_SECRET,
 * aud='authenticated', sub=user_id, role='authenticated'). mcp-connector and other
 * NUKE edge functions validate them via the existing apiKeyAuth.ts → supabase.auth.getUser()
 * path — no new validation logic.
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
import { create as createJWT, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

// ── Constants ────────────────────────────────────────────────────────────────

const ISSUER = "https://nuke.ag";
const AUTHORIZATION_ENDPOINT = `${ISSUER}/oauth/authorize`;
const TOKEN_ENDPOINT = `${ISSUER}/oauth/token`;
const REGISTRATION_ENDPOINT = `${ISSUER}/oauth/register`;
const REVOCATION_ENDPOINT = `${ISSUER}/oauth/revoke`;
const RESOURCE_METADATA_ENDPOINT = `${ISSUER}/.well-known/oauth-protected-resource`;
const LOGIN_ENDPOINT = `${ISSUER}/oauth/login`;
const CALLBACK_ENDPOINT = `${ISSUER}/oauth/callback`;
const MCP_RESOURCE = `${ISSUER}/mcp`;

const SCOPES_SUPPORTED = ["events:read", "events:write", "events:write:all", "read", "write"];
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
    headers: { ...CORS, "content-type": "application/json", ...extra },
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

function makeServiceClient() {
  return createClient(getEnv("SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// HMAC key for signing Supabase-compatible JWTs.
async function hmacKey(): Promise<CryptoKey> {
  const secret = getEnv("SUPABASE_JWT_SECRET");
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function mintAccessToken(userId: string, email: string, scopes: string[]): Promise<string> {
  const key = await hmacKey();
  const payload = {
    aud: "authenticated",
    role: "authenticated",
    sub: userId,
    email,
    iss: `${getEnv("SUPABASE_URL")}/auth/v1`,
    iat: getNumericDate(0),
    exp: getNumericDate(ACCESS_TOKEN_TTL_SECONDS),
    nuke_oauth: { scopes, source: "oauth-server" },
  };
  return await createJWT({ alg: "HS256", typ: "JWT" }, payload, key);
}

async function mintRefreshToken(userId: string, clientId: string): Promise<string> {
  const key = await hmacKey();
  const payload = {
    sub: userId,
    cid: clientId,
    type: "refresh",
    iat: getNumericDate(0),
    exp: getNumericDate(REFRESH_TOKEN_TTL_SECONDS),
  };
  return await createJWT({ alg: "HS256", typ: "JWT" }, payload, key);
}

// ── Route: GET /.well-known/oauth-authorization-server ───────────────────────

function handleAuthServerMetadata(): Response {
  return jsonResp({
    issuer: ISSUER,
    authorization_endpoint: AUTHORIZATION_ENDPOINT,
    token_endpoint: TOKEN_ENDPOINT,
    registration_endpoint: REGISTRATION_ENDPOINT,
    revocation_endpoint: REVOCATION_ENDPOINT,
    scopes_supported: SCOPES_SUPPORTED,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    code_challenge_methods_supported: ["S256"],
    service_documentation: `${ISSUER}/api/docs`,
  });
}

// ── Route: GET /.well-known/oauth-protected-resource ─────────────────────────

function handleResourceMetadata(): Response {
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
    return jsonResp({ error: "invalid_client_metadata", error_description: "Body must be valid JSON" }, 400);
  }

  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u) => typeof u === "string") : [];
  if (redirectUris.length === 0) {
    return jsonResp({ error: "invalid_redirect_uri", error_description: "At least one redirect_uri is required" }, 400);
  }
  for (const u of redirectUris) {
    try { new URL(u); } catch {
      return jsonResp({ error: "invalid_redirect_uri", error_description: `Invalid redirect_uri: ${u}` }, 400);
    }
  }

  const clientId = "nuke_" + randomToken(16);
  const tokenAuthMethod = body.token_endpoint_auth_method ?? "none";
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
    scope: body.scope ?? "events:write events:read",
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
    scope: body.scope ?? "events:write events:read",
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
  const scope = params.get("scope") ?? "events:write events:read";
  const state = params.get("state") ?? "";
  const codeChallenge = params.get("code_challenge") ?? "";
  const codeChallengeMethod = params.get("code_challenge_method") ?? "S256";

  if (!clientId) return errorPage("missing client_id");
  if (!redirectUri) return errorPage("missing redirect_uri");
  if (responseType !== "code") return redirectError(redirectUri, state, "unsupported_response_type");
  if (!codeChallenge) return redirectError(redirectUri, state, "invalid_request", "PKCE required: code_challenge");
  if (codeChallengeMethod !== "S256") return redirectError(redirectUri, state, "invalid_request", "code_challenge_method must be S256");

  const supabase = makeServiceClient();
  const { data: client } = await supabase.from("oauth_clients").select("client_id, redirect_uris, client_name").eq("client_id", clientId).maybeSingle();
  if (!client) return errorPage(`unknown client_id: ${clientId}`);

  const allowed = (client.redirect_uris as string[] | null | undefined) ?? [];
  if (!allowed.includes(redirectUri)) return errorPage(`redirect_uri not registered for this client: ${redirectUri}`);

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
    body { margin: 0; font-family: Arial, sans-serif; background: #f5f5f5; color: #111; }
    .card { max-width: 420px; margin: 80px auto; background: #fff; border: 2px solid #111; padding: 28px 24px; }
    h1 { font-size: 14px; letter-spacing: 2px; text-transform: uppercase; margin: 0 0 12px; }
    p  { font-size: 13px; line-height: 1.5; }
    label { display: block; font-size: 9px; letter-spacing: 1px; text-transform: uppercase; margin: 16px 0 6px; }
    input[type=email] { width: 100%; padding: 10px; border: 2px solid #111; font-family: 'Courier New', monospace; font-size: 14px; box-sizing: border-box; }
    button { margin-top: 16px; width: 100%; padding: 12px; background: #111; color: #fff; border: 2px solid #111; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; cursor: pointer; }
    .meta { margin-top: 16px; font-size: 10px; color: #666; }
    .pill { display: inline-block; padding: 2px 6px; border: 1px solid #ccc; font-size: 10px; font-family: 'Courier New', monospace; margin-right: 4px; }
    .err  { color: #b00020; font-size: 11px; margin-top: 8px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Connect ${escapedClientName} to NUKE</h1>
    <p><strong>${escapedClientName}</strong> wants permission to write vehicle events on your behalf.</p>
    <div class="meta">
      <span class="pill">scope</span> ${scope.split(" ").map((s) => `<code>${s}</code>`).join(" ")}
    </div>
    <form method="post" action="/oauth/login">
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

  const sessionId = randomToken(24);
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

  // Generate Supabase magic link via admin API; redirectTo points to /oauth/callback.
  const callbackUrl = `${CALLBACK_ENDPOINT}?session=${sessionId}`;
  const { data, error: linkErr } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: callbackUrl },
  });
  if (linkErr || !data?.properties?.action_link) {
    console.error("[oauth-server] generateLink error:", linkErr?.message ?? "no link returned");
    return errorPage("Could not send magic link. Check that your email is registered with NUKE.");
  }

  // Send the email by piggybacking on Supabase's standard flow:
  // generateLink already triggers email via the configured SMTP if `should_send_email` defaults true.
  // For some Supabase plans/configurations, we may need to call signInWithOtp instead. Try that as a
  // fallback so the email goes out.
  // Best-effort: also call signInWithOtp. Idempotent enough.
  await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: callbackUrl } }).catch(() => null);

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
  if (!sessionId) return errorPage("missing session id");

  // Supabase magic link redirect appends #access_token=...&refresh_token=... as URL fragment.
  // But fragments aren't visible server-side. Supabase also supports ?token=...&type=magiclink
  // via verifyOtp. We'll look for either the access_token param OR a token (one-time-token).
  // Fall back to a second flow: PKCE-style code flow where ?code=... is provided.
  const accessToken = url.searchParams.get("access_token");
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
  }
  if (!userId && codeParam) {
    const { data: v } = await supabase.auth.exchangeCodeForSession(codeParam).catch(() => ({ data: null }));
    userId = (v as any)?.user?.id ?? null;
  }

  // Last resort: return an HTML page with JS that reads the URL fragment and POSTs
  // back to /oauth/callback-finish. Supabase magic-link redirects often put the token in
  // the fragment.
  if (!userId) {
    return htmlResp(`<!doctype html><meta charset="utf-8"><title>Finishing login</title>
<body style="font-family: Arial, sans-serif; max-width: 420px; margin: 80px auto; padding: 24px; border: 2px solid #111;">
<h1 style="font-size: 14px; letter-spacing: 2px; text-transform: uppercase;">Finishing login</h1>
<p style="font-size: 13px;">Completing the connection… this should take a second.</p>
<script>
(async () => {
  const frag = new URLSearchParams(location.hash.replace(/^#/, ""));
  const access_token = frag.get("access_token");
  if (!access_token) {
    document.body.innerHTML += '<p style="color:#b00020">No access_token in callback URL. Try the magic link again.</p>';
    return;
  }
  const u = new URL(location.href);
  u.hash = "";
  const params = new URLSearchParams({ session: ${JSON.stringify(sessionId)}, access_token });
  const res = await fetch("/oauth/callback-finish?" + params.toString(), { method: "POST" });
  if (res.redirected) { location.href = res.url; return; }
  if (res.ok) {
    const j = await res.json().catch(() => ({}));
    if (j.redirect) { location.href = j.redirect; return; }
  }
  document.body.innerHTML += '<p style="color:#b00020">Could not finish login. ' + (await res.text()).slice(0,200) + '</p>';
})();
</script>
</body>`);
  }

  return finishCallback(sessionId, userId);
}

async function handleCallbackFinish(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("session") ?? "";
  const accessToken = url.searchParams.get("access_token") ?? "";
  if (!sessionId || !accessToken) return jsonResp({ error: "missing params" }, 400);
  const supabase = makeServiceClient();
  const { data: u } = await supabase.auth.getUser(accessToken);
  const userId = u?.user?.id;
  if (!userId) return jsonResp({ error: "could not resolve user from access_token" }, 400);
  return finishCallback(sessionId, userId);
}

async function finishCallback(sessionId: string, userId: string): Promise<Response> {
  const supabase = makeServiceClient();
  const { data: sess, error: sErr } = await supabase.from("oauth_login_sessions")
    .select("*").eq("session_id", sessionId).maybeSingle();
  if (sErr || !sess) return errorPage("session not found");

  // Generate authorization code, store with PKCE binding.
  const code = randomToken(32);
  const { error: codeErr } = await supabase.from("oauth_authorization_codes").insert({
    code,
    client_id: sess.client_id,
    user_id: userId,
    redirect_uri: sess.redirect_uri,
    scope: sess.scope,
    code_challenge: sess.code_challenge,
    code_challenge_method: sess.code_challenge_method,
    expires_at: new Date(Date.now() + CODE_TTL_SECONDS * 1000).toISOString(),
  });
  if (codeErr) {
    console.error("[oauth-server] auth code insert:", codeErr.message);
    return errorPage("Could not issue authorization code");
  }

  await supabase.from("oauth_login_sessions").update({ completed_at: new Date().toISOString(), user_id: userId }).eq("session_id", sessionId);

  const redir = new URL(sess.redirect_uri);
  redir.searchParams.set("code", code);
  if (sess.state) redir.searchParams.set("state", sess.state);

  // For browser flow: redirect. For fetch-based polling, return JSON with redirect URL.
  return new Response(JSON.stringify({ redirect: redir.toString() }), {
    status: 200,
    headers: { ...CORS, "content-type": "application/json", location: redir.toString() },
  });
}

// ── Route: POST /oauth/token ─────────────────────────────────────────────────

async function handleToken(req: Request): Promise<Response> {
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

async function handleTokenAuthCode(body: Record<string, string>): Promise<Response> {
  const { code, client_id, redirect_uri, code_verifier } = body;
  if (!code || !client_id || !redirect_uri || !code_verifier) {
    return jsonResp({ error: "invalid_request", error_description: "Missing required parameters" }, 400);
  }

  const supabase = makeServiceClient();
  const { data: row, error } = await supabase.from("oauth_authorization_codes").select("*").eq("code", code).maybeSingle();
  if (error || !row) return jsonResp({ error: "invalid_grant", error_description: "code not found" }, 400);
  if (row.used_at) return jsonResp({ error: "invalid_grant", error_description: "code already used" }, 400);
  if (new Date(row.expires_at) < new Date()) return jsonResp({ error: "invalid_grant", error_description: "code expired" }, 400);
  if (row.client_id !== client_id) return jsonResp({ error: "invalid_grant", error_description: "client_id mismatch" }, 400);
  if (row.redirect_uri !== redirect_uri) return jsonResp({ error: "invalid_grant", error_description: "redirect_uri mismatch" }, 400);

  // PKCE verification.
  const expected = await base64UrlSha256(code_verifier);
  if (expected !== row.code_challenge) {
    return jsonResp({ error: "invalid_grant", error_description: "PKCE verification failed" }, 400);
  }

  // Mark code used (one-time).
  await supabase.from("oauth_authorization_codes").update({ used_at: new Date().toISOString() }).eq("code", code);

  // Get user email (claim hydration).
  const { data: userRec } = await supabase.auth.admin.getUserById(row.user_id);
  const email = userRec?.user?.email ?? "";
  const scopes = (row.scope ?? "events:write events:read").split(" ").filter(Boolean);

  const accessToken = await mintAccessToken(row.user_id, email, scopes);
  const refreshToken = await mintRefreshToken(row.user_id, client_id);

  await supabase.from("oauth_clients").update({ last_used_at: new Date().toISOString() }).eq("client_id", client_id);

  return jsonResp({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
    scope: scopes.join(" "),
  });
}

async function handleTokenRefresh(body: Record<string, string>): Promise<Response> {
  const { refresh_token, client_id } = body;
  if (!refresh_token) return jsonResp({ error: "invalid_request", error_description: "refresh_token required" }, 400);

  const key = await hmacKey();
  const { verify } = await import("https://deno.land/x/djwt@v3.0.2/mod.ts");
  let payload: any;
  try {
    payload = await verify(refresh_token, key);
  } catch {
    return jsonResp({ error: "invalid_grant", error_description: "refresh_token invalid" }, 400);
  }
  if (payload.type !== "refresh") return jsonResp({ error: "invalid_grant" }, 400);
  if (client_id && payload.cid !== client_id) return jsonResp({ error: "invalid_grant", error_description: "client_id mismatch" }, 400);

  const supabase = makeServiceClient();
  const { data: userRec } = await supabase.auth.admin.getUserById(String(payload.sub));
  const email = userRec?.user?.email ?? "";
  const scopes = ["events:write", "events:read"];
  const accessToken = await mintAccessToken(String(payload.sub), email, scopes);
  const refreshNew = await mintRefreshToken(String(payload.sub), String(payload.cid));

  return jsonResp({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshNew,
    scope: scopes.join(" "),
  });
}

// ── Route: POST /oauth/revoke ────────────────────────────────────────────────

async function handleRevoke(_req: Request): Promise<Response> {
  // Stateless tokens — true revocation requires a denylist. Stub for spec compliance.
  return jsonResp({}, 200);
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
    return jsonResp({ error: "server_error", error_description: e instanceof Error ? e.message : String(e) }, 500);
  }
});

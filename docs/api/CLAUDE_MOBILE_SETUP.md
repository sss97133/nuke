# Claude.ai Mobile / Web — NUKE MCP Setup

**Use this if you're connecting from the Claude.ai mobile app or claude.ai in a browser.** For the desktop macOS Claude app, see `CLAUDE_DESKTOP_SETUP.md`.

## What's different from desktop

Desktop bridges remote MCPs through `mcp-remote` running on your Mac, where it can attach a static `X-API-Key` header. Mobile and claude.ai web don't run a local bridge — they expect the MCP server to support **OAuth 2.0** so you can click "Connect" once, log in, and Claude.ai stores a token for you.

NUKE now supports both. Mobile gets a real OAuth flow. No key paste.

## Setup

1. Open **claude.ai/settings/connectors** (works in mobile browser, the mobile app, or a desktop browser — all the same account).
2. Tap **Add custom integration** (or "Add connector" — the wording moves around).
3. **URL:** `https://nuke.ag/mcp`
4. **Auth:** leave it on the default (OAuth / "Sign in to NUKE" — Claude.ai discovers the OAuth metadata at `https://nuke.ag/.well-known/oauth-authorization-server` and walks you through the flow).
5. Tap **Connect**.

## What you'll see during connect

1. Claude.ai opens an in-app browser at `https://nuke.ag/oauth/authorize?...`.
2. NUKE shows a tiny "Connect Claude.ai to NUKE" page asking for your email.
3. You enter the email tied to your NUKE account (`shkylar@gmail.com`).
4. NUKE sends you a magic link via Supabase Auth.
5. You tap the link in your email — it lands on `https://nuke.ag/oauth/callback`.
6. NUKE generates an authorization code, redirects back to Claude.ai.
7. Claude.ai trades the code for a Bearer token.
8. Done. The NUKE tools are now available in any chat.

The whole flow takes about 30 seconds the first time. Subsequent sessions don't repeat it — Claude.ai keeps the token.

## What works after connect

| Tool | What it does |
|---|---|
| `submit_vehicle_event` | Log a service / note event for a vehicle by VIN (`/v1/events` under the hood) |
| `submit_observation` | Lower-level: write any observation kind to a vehicle |
| `query_observations` | Read events back |
| `search_vehicles` | Find a vehicle by VIN or text |
| `get_vehicle` | Pull the full vehicle record |
| `get_event_schema` | Returns the JSON Schema so Claude can self-validate before submitting |
| `verify_vehicle_access` | Check whether the current token can write to a given VIN |

Plus 40 other read tools and the cockpit/projection tools.

## The dogfood loop you've been waiting for

> "Hey Claude, I just wrapped up on the Mustang VIN 6F07C219593 — pulled the engine, found the rear main was leaking, and started cleaning the valley. Here's a photo."

If you attach the iPhone photo to the message, Claude can read the image and then call `submit_vehicle_event` with a structured payload describing the work. The photo upload tool (`submit_vehicle_photo`) is on the next-session list — for now photos can be referenced as URLs, not directly base64-uploaded through MCP.

## Telemetry — when something goes wrong

Every endpoint logs a structured JSON line. Tail in real time:

```bash
supabase functions logs oauth-server --tail 2>/dev/null | jq 'select(.event)' \
  || open "https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/functions/oauth-server/logs"
```

Events (in flow order): `oauth_authorization_server_metadata`, `oauth_register`, `oauth_register_ok`, `oauth_authorize`, `oauth_login`, `oauth_login_session_created`, `oauth_login_magic_link_sent`, `oauth_callback`, `oauth_callback_fragment_fallback`, `oauth_callback_finish`, `oauth_finish_code_issued`, `oauth_token`, `oauth_token_authorization_code`, `oauth_token_pkce_mismatch`, `oauth_token_issued`, `oauth_token_refresh`, `oauth_handler_error`.

Hard rule: **secrets are never logged in plaintext** — only their lengths via `_len` fields (e.g. `code_len`, `access_token_len`, `code_verifier_len`).

If you see `oauth_authorize` → `oauth_login` but no `oauth_callback`, the user never clicked the magic link (or closed the webview). If you see `oauth_callback` → `oauth_token_pkce_mismatch`, the verifier the client sent doesn't S256-hash to the stored challenge — usually because Claude.ai started a new session and lost state.

## Pre-flight test

Before debugging on the live phone, run the end-to-end test against the deployed function:

```bash
dotenvx run -- bash scripts/test-oauth-flow.sh
```

DCR → authorize → login → seed authorization code → token exchange → JWT validate (and a refresh-token + replay-protection check). Exits 0 on green. Failure messages are specific (PKCE mismatch? form-action regression? JWT alignment? metadata 404?), so you know what to fix before tapping the connector.

## Troubleshooting — server-side

- **"Connect" button does nothing / connector says it's already pending:** force-quit the app, reopen, try again. Mobile sometimes caches an in-flight OAuth state.
- **Magic link email never arrives:** check that the email you entered matches your NUKE account. The link is valid for 15 minutes.
- **Magic link clicks land on a "session not found" page:** session expired (15 min). Restart the connector flow.
- **Tools appear but writes return 401:** the connector lost its token. Disconnect + reconnect.
- **Tools appear and writes return 403:** the OAuth flow issued a token without `events:write` scope. Disconnect + reconnect; the consent flow defaults to `events:write events:read`.

## Troubleshooting — known Claude.ai client-side OAuth bugs

These are defects in the **Claude.ai client**, not in NUKE's server. NUKE's `scripts/test-oauth-flow.sh` will pass green even when these symptoms are present, because the bugs occur in how Claude.ai consumes the OAuth result, not in how NUKE produces it. Until Anthropic ships fixes, use the workarounds below.

### Bug A — OAuth completes but Bearer token never sent

- **Tracking:** [`anthropics/claude-code#46140`](https://github.com/anthropics/claude-code/issues/46140) — "OAuth completes but Bearer token never sent"
- **Symptom:** Magic-link click → "Connection complete" page in Claude.ai → connector toggle stays gray, tools never appear in chat. `supabase functions logs oauth-server` shows `oauth_token_issued`, but `mcp-connector` logs show no Bearer header on subsequent tool calls.
- **Root cause (client-side):** Claude.ai successfully completes the token exchange but fails to attach the `Authorization: Bearer <token>` header to subsequent MCP requests. The token is sitting in the client but never reaches the resource server.
- **Workarounds:**
  1. **Force a re-discovery.** Settings → Connectors → remove NUKE → force-quit the app (iOS swipe-up, Android recent-apps swipe) → reopen → re-add `https://nuke.ag/mcp`. The token-attachment glitch tends to happen on stale connector records.
  2. **Prime via desktop browser.** Add the connector at `claude.ai/settings/connectors` on a desktop browser, complete OAuth there, then verify mobile picks up the token. Some users report desktop "primes" mobile.
  3. **Verify server-side.** Run `dotenvx run -- bash scripts/test-oauth-flow.sh` — green means the server is fine and the bug is purely client-side.
  4. **Fall back to Claude Desktop + X-API-Key.** Until Anthropic ships the fix, use `docs/api/CLAUDE_DESKTOP_SETUP.md` (X-API-Key path) on macOS — that path doesn't depend on Bearer attachment.

### Bug B — OAuth authentication fails on claude.ai web — no requests reach the server

- **Tracking:** [`anthropics/claude-ai-mcp#8`](https://github.com/anthropics/claude-ai-mcp/issues/8) — "OAuth authentication fails on claude.ai web — no requests reach server"
- **Symptom:** Click "Authorize" on claude.ai web → redirected back to claude.ai with a generic auth error → `supabase functions logs oauth-server` shows **zero** `oauth_authorize` events for the time window. The authorization endpoint isn't even hit.
- **Root cause (client-side):** The Claude.ai web client occasionally skips the well-known discovery step entirely or stops after a CORS preflight, never issuing the actual `/oauth/authorize` GET. Web-specific.
- **Workarounds:**
  1. **Try the mobile app instead.** Same connector URL on iOS/Android Claude.ai usually works even when web does not — the bug is web-specific.
  2. **Hard-refresh the Connectors page.** Cmd-Shift-R / Ctrl-Shift-R. Web client state can get stuck in a cached failed-discovery state.
  3. **Verify discovery is reachable.** From a terminal:
     ```bash
     curl -s https://nuke.ag/.well-known/oauth-authorization-server | jq .issuer
     curl -s https://nuke.ag/.well-known/oauth-protected-resource     | jq .resource
     ```
     Both must return JSON (not HTML, not 404). If they don't, the Vercel rewrite to `oauth-server` is broken — fix in `nuke_frontend/vercel.json`. If they do return correctly, blame is on the Claude.ai web client.
  4. **Use Claude Desktop + X-API-Key.** Same fallback as Bug A.

### Server-side defenses already in place

- Form action on `/oauth/authorize` is the **absolute URL** `https://nuke.ag/oauth/login` — defensive against webview base resolution quirks (also the symptom space of #8).
- Fragment-token shim in `/oauth/callback` (for Supabase magic links that put the token in `#access_token=`) likewise uses the **absolute URL** `https://nuke.ag/oauth/callback-finish`.
- Structured per-event logging at every endpoint, secret-length only — so we can read the logs even when the client is silent.
- `scripts/test-oauth-flow.sh` smoke-tests the whole chain, including JWT round-trip via `supabase.auth.getUser()`, replay-protection on used codes, and absolute-form-action regression.

## What's stored where

- The OAuth client Claude.ai registered (DCR) — `oauth_clients` table, NUKE DB.
- The one-time auth code during the flow — `oauth_authorization_codes` table.
- The in-flight magic-link login session — `oauth_login_sessions` table.
- The Bearer token Claude.ai holds — only on Claude.ai's side. NUKE doesn't store it; tokens are stateless JWTs signed with NUKE's Supabase JWT secret. Revocation is currently a stub — to revoke you'd need to rotate the signing key or extend the codebase to a denylist (next-session work).

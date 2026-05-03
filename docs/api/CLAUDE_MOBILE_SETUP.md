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

## Troubleshooting

- **"Connect" button does nothing / connector says it's already pending:** force-quit the app, reopen, try again. Mobile sometimes caches an in-flight OAuth state.
- **Magic link email never arrives:** check that the email you entered matches your NUKE account. The link is valid for 15 minutes.
- **Magic link clicks land on a "session not found" page:** session expired (15 min). Restart the connector flow.
- **Tools appear but writes return 401:** the connector lost its token. Disconnect + reconnect.
- **Tools appear and writes return 403:** the OAuth flow issued a token without `events:write` scope. Disconnect + reconnect; the consent flow defaults to `events:write events:read`.

## What's stored where

- The OAuth client Claude.ai registered (DCR) — `oauth_clients` table, NUKE DB.
- The one-time auth code during the flow — `oauth_authorization_codes` table.
- The in-flight magic-link login session — `oauth_login_sessions` table.
- The Bearer token Claude.ai holds — only on Claude.ai's side. NUKE doesn't store it; tokens are stateless JWTs signed with NUKE's Supabase JWT secret. Revocation is currently a stub — to revoke you'd need to rotate the signing key or extend the codebase to a denylist (next-session work).

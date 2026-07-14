# THE CONNECTION COCKPIT — what the app actually is

*Functional spec, 2026-06-11. Synthesized from a 5-miner sweep of the existing substrate
(279 tool calls over repo + prod). Skylar's framing: the app's purpose is permissions and
connecting things — identity + grants + connected services/agents. "It's all there."
He was right. This maps every cockpit capability to its existing organ and lists only
the deltas. Build nothing that exists.*

---

## The headline

**Nuke is already a spec-complete OAuth 2.0 provider with a live 50-tool MCP surface,
a per-VIN permission grammar enforced deny-by-default, an agent trust-tier ladder, a
genuinely-connected QuickBooks, and 569,795 claimable external identities.** Claude.ai
can connect to nuke.ag today via standard OAuth (8 clients already registered).

The cockpit isn't missing. It's **orphaned, scattered across 4+ settings surfaces, and
broken at the last mile in a dozen places — usually one missing table or one missing
nav link.**

## The brutal facts (each verified, cited in the inventory)

1. **The shipped iOS app has never landed a single photo in prod.** The upload path is
   code-complete but DEAD AT RLS: `storage.objects` has 24 policies, ZERO covering the
   `vehicle-photos` bucket for user JWTs. Every capture-lineage photo in prod (12,221)
   came from the retired service-role daemon. **This is THE launch blocker.**
2. **The cockpit UI exists and is live** — `/settings/connected-agents` issues per-VIN
   scoped agent keys with expiry and revoke — **and has zero inbound links anywhere.**
   The marquee surface is unreachable except by typed URL.
3. **Both account-claim flows break on a missing table.** 569,795 scraped identities
   (563,984 BaT handles, FK-linked to years of comments/bids/listings) sit one
   `CREATE TABLE` away from "connect your BaT account and inherit your history."
   Only 2 have ever been claimed.
4. **Security trio that must close before any public user:**
   - `execute_sql` (arbitrary prod SELECT at service-role) is callable with ZERO auth via /mcp
   - mcp-connector hosts a second, divergent OAuth server whose /authorize AUTO-APPROVES
     every client with no login ("single-owner system" comment) — must be disabled in
     favor of the real oauth-server (magic-link consent, PKCE, Supabase-native JWTs)
   - `organization_contributors` INSERT RLS only requires being signed in — any user can
     self-grant `owner` at any org
5. **Token health is unmonitored:** QuickBooks token silently expired 2026-04-28;
   nothing alerted. Dropbox "connection" is a token in localStorage. No per-user vault.
6. **No unified read model.** Identity/grant edges live in `organization_contributors`,
   `vehicle_user_permissions`, `ownership_verifications`, `user_external_profiles`,
   `external_identities`, `api_keys`, `oauth_clients`, `agent_registrations`,
   `platform_credentials`, device pings — with no single "my connections" view. The
   profile's connection strip literally hardcodes NOT CONNECTED.
7. **A graveyard of UI corpses** reads/writes tables that never got migrated:
   webhooks (`webhook_endpoints`/`webhook_deliveries`), BYOK AI providers
   (`user_ai_providers` — ironic, BYOK is doctrine), Stripe keys (`user_stripe_keys`),
   2FA queue (`pending_2fa_requests`), API subscriptions (`api_access_subscriptions`),
   web claims (`external_identity_claims`). Decide per-corpse: migrate the table or
   delete the UI. No third option — a dead settings pane is a lie in the cockpit.

## What's already great (use, don't rebuild)

- **Per-VIN scope grammar** (`events:write:vehicle:{VIN}`), exercised by the Mustang
  dogfood key, last used 2026-06-11. The narrow-grant model is done.
- **Agent self-registration ladder** — anonymous agent → manifest → tiered trust
  (sandbox→contributor→trusted) with auto-promotion. Live, zero users, needs a funnel.
- **Agents are first-class org members** (`actor_type='agent'`) — already true in prod.
- **Evidence-gated grants** — `owner` on a vehicle physically requires an approved
  title verification. The trigger is attached and live.
- **Archive-grade deletion** — identity anonymized, testimony retained.
- **suggest-then-confirm pattern** (`organization_vehicles` auto-match + user_confirmed)
  — the UX template for every machine-proposed connection, including ignition's SITE 01.
- **device-ping**: the iPhone already feeds prod every 15 min via a bare iOS Shortcut —
  proof the connect-a-device loop predates the app.

## The build, tiered

**T0 — launch gates (before Thu/Fri submission)**
1. Storage RLS policy: user-JWT INSERT/SELECT on `vehicle-photos/users/{uid}/**` — then
   witness ONE photo end-to-end phone→`vehicle_images`.
2. Merge #273 (journal 404 + OG) — and apply the same fix to `/api/docs` + the
   `/v1/events` friendly path (the cockpit's printed URLs must not 404).
3. SIWA portal clicks (Skylar, 5 min) + Apple provider config.
4. Ignition branch: push, build, simulator proof (in flight — currently uncommitted
   worktree state, must land).
5. Sites sync to server: SiteStore is device-local; the server never learns work sites.
   One table (`user_sites`), suggest-then-confirm shaped.
6. Close the security trio (4 above) — gate execute_sql behind key+scope, disable the
   auto-approve OAuth path, require invite/approval for org roles.

**T1 — the cockpit proper (the week after)**
7. ONE read model: `v_user_connections` view unioning every edge above into
   (kind, counterparty, scope, status, granted_at, expires_at, health). This is the
   literal cockpit screen, web + iOS, replacing the hardcoded strip.
8. Surface the orphans: nav links to /settings/connected-agents + api-keys from the
   user menu; one /settings hub indexing all surfaces.
9. The claim table (one canonical `account_link_claims`) → revives both the web claim
   flow and the MCP link_account path → "connect your BaT history" goes live against
   569K identities.
10. Per-user token vault: `user_connections` (provider, scopes, encrypted tokens,
    status, expires_at) + expiry monitoring → QuickBooks moves off parent_company,
    Dropbox out of localStorage, Gmail poller gets its secrets, AI-subscription/BYOK
    connections become rows in the same vault.

**T2 — the network effects**
11. Org invite/approve flow (status='pending' already exists; nothing transitions it).
12. Account merge/alias RPC (the 13450c45-vs-user0 split-brain needs `account_aliases`).
13. Webhooks tables + Stripe webhook receiver (or delete those UIs).
14. Agent funnel: the registration ladder is live with 0 registrations — the marketing
    deck's Door 2 should land agents directly on the manifest endpoint.

## The one-sentence spec

The app is the place where a person (and their agents) can see and control every grant
they've made — photos, sites, services, organizations, vehicles, keys — rendered from
one read model, with every connection suggest-then-confirm, evidence-gated where it
matters, and revocable for real.

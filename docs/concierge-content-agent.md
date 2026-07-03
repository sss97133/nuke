# The concierge content agent

Status: **building Track B (brief capture) — unblocked.** Track A (Meta publishing)
is gated on external procurement (see below).

## The problem, in one image

Philippe walks the office briefing an intern: "here's the padel club, here's the
luxury clientele, now make good posts." His taste, the brand voice, the client
positioning — the most valuable asset in the building — evaporates into a hallway
conversation. "Make my Insta better" is not an aesthetics request; it's that there
is **no pipeline from his creative direction to the feed**, and no capture of the
direction itself.

Every concierge/luxury client has this exact problem. It is productizable.

## The product

A sandboxed agent Philippe *talks to* instead of briefing a person. It:
1. Holds every client's asset catalog (villas, the padel club, boutiques, events).
2. **Captures his creative direction as durable, structured briefs** — so his taste
   compounds instead of resetting with each intern.
3. Drafts posts in his voice, per client, from the catalog.
4. Coordinates the post schedule across accounts.
5. Publishes via the Meta pipeline, and pulls engagement back to learn what lands.

## How it fits the engine (not a new silo)

A brief is the **highest-trust observation** in the model we already have: authored
by the principal, top of the `mandate` / `access_tier` / source-trust hierarchy.
Engagement pulled back from Instagram is another observation stream — "content is
the validator." The content agent is a *consumer* of briefs + catalog + engagement,
and a *producer* of scheduled posts. Same observation/provenance backbone, luxury
editorial flavor.

## Two tracks

### Track A — Meta Graph publishing (GATED on procurement)
Blocked until, in order:
1. @lofficielstbarth is an Instagram **Professional** account (Business/Creator).
2. Linked to a **Facebook Page** inside a **Business Manager**.
3. A **Meta app** with `instagram_basic`, `instagram_content_publish`,
   `pages_read_engagement`, submitted for **App Review** (days–weeks).
4. A long-lived / System User token stored in Vault (`credential_secret_id` slot on
   `concierge_partner_connections` is the idiomatic home; note `[db.vault]` is
   currently commented out in `supabase/config.toml` — enable before relying on it).

Publish flow, once unblocked (stable, buildable against a sandbox IG account now):
`POST /{ig-user-id}/media` (container: public image URL + caption) → poll status for
video/reels → `POST /{ig-user-id}/media_publish`. Limit 50 posts/24h. There is a
Nov-2025 design doc, `docs/architecture/SOCIAL_MEDIA_PUBLISHING_ARCHITECTURE.md`
(design phase, unimplemented) — reconcile the publishing schema to it when Track A
starts. Reuse the QuickBooks/Gmail OAuth-refresh patterns already in the repo.

### Track B — brief capture + agent core (UNBLOCKED, building now)
No Meta dependency. Order:
1. **`creative_briefs`** — record Philippe's direction (verbatim + structured
   extraction), keyed to the client org (+ optional asset). *This migration.*
2. **`capture-brief` edge function** — takes a transcript, extracts structured
   direction (voice, clientele, positioning, dos/don'ts, themes) via Claude, stores
   it. Voice→text transcription is a front-end concern; the endpoint takes text.
3. **Content agent tool surface** (MCP): `list_clients`, `get_brief(client)`,
   `list_catalog(client)`, `draft_post`, `schedule_post`, `get_engagement`.
4. **Post queue / calendar** keyed to org + asset (reconciles the empty
   `social_posts` stub + the drafted-but-undeployed `insight_queue` — that schema is
   repo-vs-prod drift; do not assume it is live).

## Drift note (per repo rules)
`supabase/migrations/20260128_social_automation.sql` defines `insights`,
`social_posts`, `insight_queue`; only `social_posts` exists in prod (0 rows), the
other two were never applied. Reconcile — don't stack a third competing schema — when
Track B reaches the post-queue step.

# Email alert acquisition

## Current repair and operating boundary, 2026-10-04

**Owner scope: connected Gmail only.** The dedicated alerts mailbox and its Apple Mail daemon
are excluded from this repair's rollout. The Mac findings below explain the old path's failure;
they are not instructions to enable, repair or expand that account. Select the connected mailbox
explicitly when importing its raw-email manifest.

The v3 reader extends the earlier BHCC repair to KSL, BaT announcements and Cars & Bids.
KSL Mailgun destinations are decoded locally. The two auction publishers often put canonical
listing URLs in their plain-text MIME alternative while wrapping the HTML links in trackers.
Both alternatives are read; no tracking link, pixel or unsubscribe URL is requested.

Each recognized KSL card retains its listing identity, complete title, stated year, advertised
price text/amount/currency, location, image references and publisher copy. Saved-search matches
and recommendation cards remain separate. A recommended car does not inherit another car's
price or year. Missing fields remain unknown. Auction card descriptions remain attributed copy;
an options cost, bid or window-sticker price is not an asking price. Unrecognized cards retain
their URLs with an extraction hold, and unrecognized messages retain their private raw MIME.

Live inspection found the cloud `gmail-alert-poller` paused and its email log last written in
February. The separate BHCC-only Mac daemon is enabled but its October 4 receipt still fails
with `unable to open database file`; its last readable source cache ends May 2. Activation is
not a freshness or throughput proof. The current chat Gmail account contains newer mail but is
not the dedicated mailbox selected by that daemon. Source freshness is reported separately for
each selected publisher so one fresh feed cannot conceal a stale one.

The eight most recent rows sampled from the canonical KSL scrape source were all `skipped`
with `Auto-filtered: KSL blocks scrapers` and no title/price. Therefore KSL email testimony is
written directly through `ingest-observation`, independently of page enrichment. Migration
`20261005011137_register_ksl_email_observation_source.sql` prepares the missing `ksl` source
configuration with listing-only support. It changes no schema or existing testimony and does
not enable any job. Until it is deployed, KSL writes fail explicitly before acknowledgement.

This reader does not create vehicle profiles from year/make/model resemblance. Exact existing
listing bindings may attach evidence; otherwise the observation stays unbound. New-profile
creation, sustained current-mail transport, later availability sightings and profile-reader
exposure remain separate work. Email time establishes **observed by this time**, not a proven
publication time. No later email, a blocked page or a missing alert cannot establish a sale,
withdrawal or exact days on market. The owner's roughly 1,100 current listings is not a measured
denominator in this assay.

An authorized read-only Gmail transport can export original `.eml` files with a private JSON
manifest: `[{"path":"/private/path/message.eml","received_at":"2026-10-04T02:43:18Z"}]`.
The reader checks the selected recipient and sender, uses the original MIME bytes, and preserves
receipt time separately from the sender Date and database ingest time:

```sh
python3 scripts/ingest-mail-alerts.py --source all --target-email "$MAIL_ALERT_TARGET" \
  --message-manifest /private/path/messages.json --dry-run
```

Omitting `--dry-run` requires the existing encrypted Supabase environment and enabled source
configurations. Raw messages and receipts remain private; tests use synthetic emails only.
`defer_analysis` keeps this deterministic intake from dispatching paid analysis.

The connected chat Gmail tool can provide authorized message exports during a session. It does
not provision credentials for the standalone worker. A presence-only environment check found
no `GOOGLE_REFRESH_TOKEN` or separate Gmail refresh token. Continuous deterministic acquisition
from the selected account therefore still needs an authorized read-only Gmail transport. Do not
run the legacy `scripts/gmail-poller.mjs` setup/daemon unchanged: it requests modify access,
changes unread state and calls the old URL-only edge processor. Preparing that transport and
verifying its exact account, readonly scope, durable pagination and failure handling precede
any activation. The paused cloud cron remains paused.

The local assay covers 30 cached KSL messages (30 matches, 79 recommendations) plus current
KSL, BaT and Cars & Bids MIME samples. It checks per-card boundaries and replay/failure behavior;
it does not establish every historical template or fleet completion. Source/template coverage
holds are part of the result. Merge, deployment and runtime evidence must be recorded separately.

Read [`data-machine.md`](../../docs/ledger/theory/data-machine.md) first. An email notification is a dated publisher observation and an acquisition trigger. Asking price is not a sale result. A present-day page cannot replace what an earlier email said.

The existing Apple Mail reader is `scripts/ingest-mail-alerts.py`. `scripts/mail-app-intake.mjs` is its transport wrapper; the old duplicate mailbox-specific parser has been retired. The mailbox is selected explicitly with `--target-email`, `MAIL_ALERT_TARGET`, or `ALERTS_EMAIL`. They leave mail read status, labels and the Mail database untouched.

## The path

Apple Mail → recipient/sender allowlist → byte-counted MIME → private raw archive → `ingest-observation` → exact readback → processed receipt.

For Beverly Hills Car Club, a uniquely resolved listing also enters `import_queue`, keyed to the existing BHCC `scrape_sources` row for `inventory.htm`. The listing URL is unique: another alert for the same listing creates new dated testimony, while the existing queue status and vehicle binding survive. A completed observation is keyed by the hashed RFC Message-ID, falling back to raw MIME hash if absent. Multi-car emails add a stable per-card key.

BHCC puts the car description, asking price and images in its HTML part. The plain-text part may omit them. Discovery covered the 30 newest cached alerts before the parser was broadened across the archive. Supported subject variants include `Stock#`, mileage/Euro/matching-numbers prefixes and Alfa Romeo's `2000` model name. The subject's stock number and the gallery's listing ID are different identifiers; neither is a VIN.

The reader **never opens Pardot redirects, pixels, unsubscribe links or MIME image URLs**. It resolves an email's gallery ID against the public BHCC sitemap, archived by SHA-256, or an exact canonical listing ID in the existing dealer-linked vehicle URLs. Dealer inventory is read in bounded 200-row pages and cached per batch. Existing image metadata is not an identity key. Multiple vehicles or a conflicting year stay unbound. Missing or conflicting gallery identity still yields historical testimony with the publisher's claims and uncertainty. It does not yield an invented URL, a guessed vehicle association or a claim that the car sold. Unresolved messages are reconsidered when the sitemap changes.

Replay may attach an originally unbound observation through the existing `attribute_testimony` RPC. It verifies the original UUID, source URL, content, prices and both clocks survive, and requires an exact dealer-linked listing ID with matching year. The RPC records the attribution audit. It never moves an already-bound observation or replaces a vehicle's displayed price.

Raw `.eml` files, the public sitemap versions, processed state and writer receipts live under `~/nuke-private-data/email-alerts/`. Raw messages use owner-only permissions. Recipient addresses and tracking tokens do not enter observation/queue payloads. The vehicle section excludes the footer and “Cars Coming Soon”.

## Run and assay

```sh
# Offline survey, using an already cached public sitemap
python3 scripts/ingest-mail-alerts.py --source bhcc --dry-run

# Fetch only the public sitemap during a survey
python3 scripts/ingest-mail-alerts.py --source bhcc --dry-run --refresh-sitemap

# Ten new messages maximum; writes use the existing observation endpoint
# Run from the checkout that holds the encrypted environment.
dotenvx run -- python3 scripts/ingest-mail-alerts.py --source bhcc --batch-size 10

# Replay a bounded sample; require the same observation IDs and zero extra queue rows
dotenvx run -- python3 scripts/ingest-mail-alerts.py --source bhcc --replay --limit 3

# Health fails on failed writes, a writer older than 15 minutes, or alerts older than 72 hours
python3 scripts/ingest-mail-alerts.py --check

# Offline MIME, source identity, replay, and failure/readback contracts
npm run mail:intake:test
```

Use `--source ksl` for the existing KSL path. KSL's Mailgun URL is decoded locally; the tracking endpoint is never contacted. `--target-email`, `--mail-db`, `--mail-dir` and `--state-dir` support an existing alternate account or an isolated fixture. No OAuth setup or new Gmail account is required for the local reader.

The reader takes an exclusive local lock, attempts at most the configured batch, and stops after three errors. It checkpoints only after every listing in a message has a verified receipt. Failed requests remain retryable. The daemon waits five minutes between bounded cycles.

## Recurrence and limits

The existing `com.nuke.mail-intake` LaunchAgent was enabled with BHCC-only arguments after the owner's follow-up on 2026-10-02. It points at the reviewed checkout, uses the original checkout's encrypted environment, and passes `--source bhcc --daemon`. Its first scheduled run failed opening the Mail database: macOS Full Disk Access is required for its Python executable. Enabled is not healthy. Verify a successful scheduled run and `--check` after granting access. Do not enable the dormant `gmail-alert-poller` cron as a substitute.

The locally cached alerts end at 2026-05-02. A newly loaded reader cannot make an unsynced mailbox fresh. Continued acquisition requires that the existing alerts account sync into Mail; a direct Gmail transport would require authorization for that account. The connected chat Gmail account is different.

The observed active `bat-settlement-drain` calls `process-import-queue` with a BaT-only source ID. Its existence does **not** prove BHCC queue drainage. Page enrichment and later vehicle attribution remain separate from successful email testimony ingestion. A single source-scoped page-enrichment assay on 2026-10-02 reached the existing AI worker and failed with OpenAI HTTP 429 `credit_balance_exhausted`; the queue task stayed pending for retry. Email evidence ingestion itself uses no model API. No recurring paid drain, background sweep, schema migration or edge-function deployment is part of this local change.

## Inspect landed evidence

The source configuration is `observation_sources.slug = 'beverlyhillscarclub'`, with conservative publisher trust and `listing` support. The writer's `last-run.json` contains exact observation IDs, queue IDs/status, errors, acquisition/resolution holds and source freshness. Use these rather than “exit 0” as evidence.

```sql
SELECT o.id, o.vehicle_id, o.source_url, o.observed_at, o.ingested_at,
       o.structured_data->>'asking_price' AS advertised_price,
       o.structured_data->>'stock_number' AS dealer_stock,
       o.structured_data->>'resolution_hold' AS identity_hold
FROM vehicle_observations o
WHERE o.source_id = (SELECT id FROM observation_sources WHERE slug = 'beverlyhillscarclub')
ORDER BY o.ingested_at DESC LIMIT 20;
```

`observed_at` is the timezone-aware sender Date, falling back explicitly to Mail's receipt timestamp. Both source dates are retained. Database `ingested_at` is when this machine learned the claim. Historical mail is retrospective import: mailbox receipt time alone does not prove machine availability for a past prediction.

The older Apps Script and edge poller are historical transports, not verified live alternatives. Their setup instructions previously assumed a working reader and silent successful writes; don't use that as a production readiness claim.


## Cached-history assay, 2026-10-02

Eligible cached-mail coverage is **274/274 (100%)**, with 274 distinct durable message keys and all advertised-price
claims carrying separate observation/ingest clocks plus a raw-evidence reference. Exact public listing URL coverage
was initially **86/274 (31.4%)**; exact vehicle binding was **3/274 (1.1%)**. The remaining edges are unresolved, not inferred.
A three-message replay returned the original observation UUIDs, zero new queue rows and no errors. Lock waits were
zero after the audit. The health check correctly remains red because the source cache ends May 2. Twenty offline
contracts and the checkout-local ENFORCE gate passed. This proves cached testimony ingestion, not live recurrence
or completed page enrichment.

The subsequent database-alignment assay found 13 alerts naming 12 existing dealer vehicles by exact listing ID.
Ten missed edges were attached through `attribute_testimony`, preserving every original column except `vehicle_id`
and recording ten attribution audit rows. Readback is **274 observations, 13 bound observations, 12 distinct vehicles**;
there were zero lock waits. Decimal-engine URL slugs are now accepted: the cached-mail survey resolves 93 public
sitemap URLs, without rewriting the historical rows. Twenty-five offline contracts pass. This closes the exact
existing-profile matching gap; current mailbox freshness, scheduled-process access, and paid page enrichment remain
separate boundaries.

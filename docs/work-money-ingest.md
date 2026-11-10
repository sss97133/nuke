# Work money ingest — Phase 1, prepared and inactive

This change captures **claims awaiting confirmation**, not collected revenue or physical
completion. It contains no cron registration, backfill, payment insert, completion
attestation, Gmail label mutation, outbound message, paid inference or iOS UI change.
Do not merge this PR until schema/function release is separately authorized: the normal
`supabase-deploy.yml` workflow deploys changes when merged into main. A feature-branch
push and PR do not trigger that workflow.

## Existing owners and verified boundary

Read-only inspection on 2026-11-10 UTC confirmed job 265 (`gmail-alert-poller`) is
inactive. `v_job_health` has no retained last-run result for it. Its source processes
listing URLs and marks messages read, so a money reader must not depend on unread
labels. `alert_email_log`'s latest row is dated February 27; conversation timestamps
for both SMS and iMessage stop March 22. `work_order_payments` has 14 rows with its
latest payment dated March 29; completion attestations are empty. These are dated
observations, not proof of the OAuth token's present validity.

The atlas identifies `financial_review_queue` as a document-bound accounting
worklist, `payment_events` as money testimony, and `work_order_payments` as customer
payments. None is an appropriate home for unconfirmed email interpretations. The
new `work_money_staging` is a private source inbox; it does not compete with those
ledgers. Jobs are selected using `work_order_viewer_slots` and `job_reader_is_party`,
not service-role visibility over all customers. The existing completion/payment Sign
owners remain `attest_work_completion`, `record_work_order_payment` and their canonical
observation/projector paths. A later confirmation implementation must reconcile the
legacy `work_order_payments` reader with these witnesses; it must not silently treat
a bank deposit as delivery or write a completion row directly.

## Offline acceptance

No credentials, database or network permissions are needed:

```sh
deno run --allow-read scripts/work-money-dry-run.ts scripts/fixtures/work-money/samples.json
deno test supabase/functions/gmail-books-poller/core.test.ts
deno check supabase/functions/gmail-books-poller/index.ts scripts/work-money-dry-run.ts
```

All committed examples are synthetic. Private samples can use the same JSON shape:
`{accountantSenders: string[], emails: Email[], jobs: Job[]}` (types in `core.ts`).
Do not commit private emails, contact details, account references or amounts. The CLI
cannot write, contact Gmail, mark mail read, or advance an ingestion cursor. Its output
is sensitive when private input is used.

The local SQL contract `supabase/sql/test_work_money_ingest.sql` uses a disposable
PostgreSQL database with minimal prerequisite stubs; never run it against a hosted
project. It applies the actual migration twice and tests idempotency, scoped admission,
owner-only reads, write denial, pending reader results and successful/failed freshness.

## Source, interpretation and matching contract

`gmail-books-poller` is an isolated, service-only sibling. Its default request is a
**dry run**; live staging additionally requires `WORK_MONEY_INGEST_ENABLED=true` and
`{"dry_run":false}`. Dry runs may read Gmail and candidate jobs but write no runs or
staging rows. Use the offline CLI before deployment.

The deterministic versioned classifier covers incoming-payment claims, deposits,
invoices (including attachment-only invoice metadata), BaT payout claims, personal
BaT sale notices, and questions from explicitly configured accountant senders. Vendor
receipts and listing fees are outbound. Auction sale notices are not proceeds.
Promotions, failed/scheduled/reversed payments and quoted historical payments cannot
become received money. Forwarded money stays direction-unknown. Books questions are
message-level review items, not individual resolved accounting lines. Sender text is
not authenticated financial evidence; every classification retains that qualification.

Only one distinct explicitly denominated amount is selected. Multiple amounts remain
unknown and retain a reason; amounts are integer cents, never summed from repeats.
Bare dollar signs are interpreted as USD for this mailbox's US banking inputs; mixed
or unsupported formats require review. Attachments retain filename/Gmail attachment
ID; no PDF download, OCR or inferred attachment amount occurs. Original Gmail IDs,
thread IDs, RFC Message-ID, received clock, ingestion clock, sender, excerpt, source
hash and classifier version support source retrieval and replay. The hash covers the
normalized email, not raw RFC bytes. Full bodies remain in Gmail; excerpts are limited
to 4,000 characters. A versioned replay retains the earlier interpretation.

Incoming claims can propose multiple jobs. Each proposal gives job/vehicle IDs,
confidence and reasons: explicit counterparty text/email, vehicle text, equality to
an estimate, and proximity to job creation. Estimates are **not balances**. Amount
plus date alone never proposes a job; closed jobs and currency conflicts are excluded.
Partial payments can propose identity without an amount match. All proposals remain
`pending_confirmation`, including ties and high scores. Confidence is a rule score,
not calibrated probability. Matching is deliberately conservative and does not resolve
aliases or infer customer identity from a bank's sender address.

## Private reader contract for later Work UI

Authenticated owner reads (RLS, no client write grants):

- `work_money_pending_confirmations`: staged source claims with nested `proposals`;
  ordered/paginated by `received_at`, then `id`. No amount from this view belongs in
  a collected-total calculation. Rows from distinct classifier versions are separate
  interpretations and must be grouped by `(source, source_message_id)` in review.
- `work_money_source_health`: `last_attempt_at`, `last_success_at`, `covered_through`,
  `last_message_at`, `latest_status`, `latest_error_code` for each observed source.
  A missing source row means **never observed**, not healthy and not zero activity.
  A recent attempt with an old success is a failure/stall. A long-running receipt is
  an interrupted attempt; the UI must not render it as a successful ingest.

Successful empty scans establish source freshness but create no money. Failed fetches,
failed staging writes and overflow never advance `covered_through`. An interrupted
edge invocation can leave a `running` receipt and immutable staged rows; replay is
idempotent. A start/finish database failure is an HTTP error, never reported success.
Freshness is separate from last message date. Consumers should mark Gmail stale when
successful coverage is older than the agreed polling interval plus tolerance; do not
use message dates to decide whether an idle mailbox is broken.

Polling starts with a seven-day window and then overlaps the last successful poll
by one day. It includes read mail. Each run follows pagination up to 250 distinct
messages/10 page tokens, and refuses more than 500 candidate jobs. Overflow is an
explicit failure requiring a narrower window or a future durable paging extension;
it does not certify truncated coverage. Each window is at most 31 days. For reviewed
backfills pass **both** `after` and `before` ISO timestamps; those successes never
advance the normal poll watermark. After a long outage, approve bounded backfills
and a deliberate polling restart; do not represent older uncaptured months as covered.
The seven-day initial window is a declared retrieval boundary, not historical completeness.

## Exact activation confirmations (nothing below has been executed)

1. **Release:** approve applying the single migration and deploying the new function
   through the normal reviewed CI path. The PR is held for this decision; no manual
   migration, edge deploy or workflow dispatch is part of Phase 1 preparation.
2. **Mailbox and owner:** confirm the Gmail account and Nuke owner UUID in
   `WORK_MONEY_MAILBOX` and `WORK_MONEY_OWNER_ID`. The worker checks Gmail's profile
   against that mailbox before reading messages. Confirm the exact comma-separated
   accountant addresses in `WORK_MONEY_ACCOUNTANT_SENDERS` (including the address
   identified in the private build plan); no private address is baked into public code.
3. **OAuth secrets and scopes:** confirm `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
   `GOOGLE_REFRESH_TOKEN` are valid for that mailbox and have
   `https://www.googleapis.com/auth/gmail.readonly`. `gmail.metadata` is insufficient
   for body/query access. No send/modify scope is needed; do not use the old
   listing-poller setup if it requests broader access unnecessarily. Keep these in
   server secrets. Confirm runtime `SUPABASE_URL` and the existing project secret-key
   configuration consumed by `projectSecretKey()`; never expose it to iOS.
4. **Staging writes and window:** approve `WORK_MONEY_INGEST_ENABLED=true`, the initial
   seven-day boundary or specific bounded backfill windows, and one staging canary
   after inspecting a deployed dry run. Verify the source row, pending queue, duplicate
   replay and absence of payment/completion changes before any schedule is enabled.
5. **Cron:** separately approve a new 15-minute Gmail books schedule, service-key
   invocation and operational owner. No cron SQL is included or executed here. Leave
   job 265 disabled unless its listing path gets its own health check and approval.
6. **Messages:** separately confirm the Mac, chat allowlist, Full Disk Access, SMS
   forwarding, historical boundary and replacement receiver before enabling a bridge.
   Do not restart the old bridge or `sms-reminder-scheduler` as part of Gmail activation.

A future iOS confirmation is another explicit action: source review, correct payer,
amount/currency/date and allocation, duplicate-payment reconciliation, then canonical
payment Sign; delivery/completion needs its own evidence and Sign. This PR provides
neither an automatic confirmation writer nor a button claiming to complete that step.

## iMessage/SMS replacement and restart path

Repository inspection: `scripts/imessage-bridge.mjs` reads Mac `chat.db`, uploads
attachments, calls `imessage-router`, advances cursors and handles outbound messages.
Its `--dry-run` suppresses the router call but is **not write-free**: the surrounding
loop can upload attachments, save cursor state and mark outbound rows sent. Do not
use it for a production-safe inspection. `sms-reminder-scheduler` is a retired guarded
410 stub, not an ingestion source. The local LaunchAgents inventory contained a
`.DISABLED` iMessage vehicle-sync plist; process enumeration was unavailable in this
sandbox, so daemon inactivity itself is not verified.

Proposed replacement (not installed or started):

1. A read-only Mac extractor opens `~/Library/Messages/chat.db` with SQLite `mode=ro`,
   selects only explicitly allowlisted chats and a bounded ROWID range, and emits local
   JSON containing message GUID, original Apple timestamp, service (iMessage/SMS),
   sender, text and attachment *references*. No AppleScript replies, attachment upload,
   outbound queue or model calls. SMS requires Messages text forwarding already enabled.
   Reading `attributedBody` needs a reviewed decoder; absent text is unsupported, not empty.
2. Its offline preview never loads remote credentials, mutates cursors or writes source
   health. The owner reviews a bounded export before transport activation. GUID + source
   + owner + classifier version is the idempotency key; ROWID is only a local cursor.
3. A dedicated service-only receiver validates configured owner/chat scope, source clock
   and payload limits, adapts to the staging contract, and acknowledges only after the
   staged item and health receipt succeed. It must not call the conversational router.
   Money classifiers need a message-specific adapter: an email sender parser cannot
   infer a payer from a phone number. No payment/completion auto-writes.
4. Advance the local cursor atomically only after receiver acknowledgement; replay failed
   batches, back off on errors, record source-specific health, and install launchd only
   after a reviewed canary. A restart first checks Full Disk Access, Messages sync/SMS
   forwarding, current secret-key auth, receiver deployment, allowlist and prior cursor.
   Never reset to latest to conceal an unprocessed backlog. Mac-offline must show stale.

This is a replacement design, not a claim that text ingestion is revived. Phase 1 is
implemented/tested preparation; deployed intake, signed-in iOS review and actual job
closure remain open until their explicit release and later UI/Sign work.

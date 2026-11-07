# Client evidence producers (mail intake, timeline, labor)

Code: `scripts/client_evidence/` (Python stdlib only). Tests: `python3 -I scripts/client_evidence/test_client_evidence.py`
(synthetic fixtures only), run by `scripts/ci/verify.sh` inside the existing `pre-deploy-check.yml` job. **Nothing here has
been run against production.** Stage reached: implemented and unit-tested against an in-memory model of the writer; not
integration-tested, not deployed.

## Pipeline (one dry-run, no hand-built dicts)
`cli.py plan MANIFEST --owner UUID --clock ISO [--rates F] [--images F --vehicle ID] [--out F]`

connector manifest (`client_mail_manifest_v1`: thread/message/RFC ids, part id, SHA-256, private `user-documents/<owner>/…` ref,
cited claims) -> `mail_manifest.plan` (financial_evidence_v1 envelopes) -> `timeline` events derived from each document's claims
-> `labor` source-claim arithmetic -> optional invoice-vs-photo reconciliation. The connector (authorized, read-only) is outside
this repo; no mail credential or app database is read here, and original bytes are never moved.

## Writer contract it is built against
Read from `supabase/migrations/20261028161800` (`ingest_financial_evidence`); parity with the deployed function is **unverified**.
- A key already in a document's runs replays only if the whole payload digest is equal, else the writer raises
  `idempotency key payload conflict`. The key here is `hash(owner, account_ref, sha256, method, version, content_hash)`; the content
  hash covers every cell, line and concern except the ingest clock. A later forward, a changed claim or another owner is a new key.
- A second revision of an existing original must name the current run (`supersedes_run_id`) and carry every prior `field_key`.
  Cell keys are therefore stable ids (`origin.<h>`, `claim.<h>`, `timeline.<h>`, `labor.<h>`), and lines are carried explicitly.
- Lines: `source_row` is written as row+1 (writer needs >= 2); the line key includes kind and claim id. Citations ride in `issues`
  (the line schema has no page key). Concerns (<= 30) go to `financial_review_queue`.

## Apply (the only write path; never run here)
1. `backup CHANGESET --token-env NAME --out PATH`: read-only preflight of each original; writes a 0600 artifact **outside the repo**
   holding owner, changeset hash, `created_at`, per-original pre-state (current run, run keys, field-key and value digests) and its own
   integrity hash. The writer is append-only, so rollback is supersession; this artifact is the pre-state it is measured against.
2. `apply … --receipt-sha SHA` without `--execute` is an offline check (changeset re-validated, artifact verified: integrity, owner,
   exact changeset, age <= 24 h, coverage). `--execute --token-env NAME` additionally preflights each original live, refuses if it no
   longer matches the artifact, submits **sequentially**, stops at the first refusal and returns a ledger
   (`done / already_applied / failed / not_attempted`); re-running with the same artifact resumes.
3. `transport.HttpTransport` posts to `ingest-observation` (`mode: financial_evidence_v1`, `action: read|submit`) with the caller's own
   credential taken from the **named** environment variable. It is exercised only by tests with an injected opener.

## What is claimed vs. what is not
- Every cell is `claim_unverified`, `posted:false`. A quote, request or report is never completed work or verified payment; invoice hours are
  a source claim (`verified:false`). Business handling is not ownership; nothing here asserts owner facts.
- Forwards of the same bytes add origins. Two different claims at one slot are both kept and raised as concerns. Declared `composite_of`
  relations drive grouping: an equal claim is aliased (origins merged), a claim equal to the sum of components is a non-additive rollup,
  anything else is flagged unmatched. Amounts are never added across documents.
- Zero balance after a deposit is not zero cost (`accounting.invoice_view`); printed-vs-computed differences are flags, never corrections.

## Clocks
Sent, document, service period and ingest clocks stay separate. `sent_at` and import times are never a work date; non-ISO strings are
refused. A camera capture time is either aware (offset known) or camera-local with the offset **unknown**: the two are never clustered
together, no UTC is invented, camera-local clusters are review evidence with `billable_hours: null`. Hours come only from aware,
in-window, identity-confirmed, `labor`-intent frames, as a lower bound; observed days and frame counts are the primary signal. Frames
outside the invoice service window, before 2000, or outside a supplied vehicle date range are held. A missing intent label is
`intent_unclassified` (its own hold); intent must come from a reviewed label supplied with the image. Contextual/low-confidence identity,
privacy-hold, person and protected origins are held and never auto-confirmed.

## Timeline and labor persistence: what exists
- **Persisted (private):** timeline events and labor source-claim cells derived from a document's claims ride on that document's
  private `financial_evidence_v1` revision (`financial_document_extractions`, privacy tier private). Event identity is bytes + page + line +
  claim + stance, never the title, so an edit supersedes the old cell by `field_key` with the real run pointer and nothing is deleted.
- **Not persisted:** image-derived events, camera-clock review and invoice-vs-photo reconciliation are printed locally only.
  `timeline.publish()` / `publish-timeline` always refuse: the public `timeline_events` and `work_sessions` rows are readable with the
  vehicle and cannot hold client invoice or messaging facts. A cross-source projection needs an owner-private store (owner-only RLS,
  append-only with a supersession pointer, `privacy_tier = 'private'`, service-role writer that is not `SECURITY DEFINER` in `public`);
  **no migration or table was written** and none is applied.

## Limits and unverified items
- Writer source vs deployed parity; the accepted `concern_type` values of `financial_review_queue` (`client_evidence_conflict` is
  unverified, a refusal would stop apply safely); the exact shape of the `read` response (`apply` fails closed on anything unrecognised);
  whether the caller's credential type is accepted for `read`/`submit` scopes.
- PDF-to-claim parsing and the connector export are not in this repo. No real-data run was made for this PR.
- Max 100 cells and 500 lines per original; larger documents are refused, not truncated.
- `process-receipt`, `smart-receipt-linker`, `daily-receipt` span fallbacks and `mail_attachments.py` are deliberately not reused.

# Client evidence producers (mail intake, timeline, labor)

Code: `scripts/client_evidence/` (Python stdlib only). Tests: `python3 -I scripts/client_evidence/test_client_evidence.py`
(synthetic fixtures only), run by `scripts/ci/verify.sh` inside the existing `pre-deploy-check.yml` job. **Nothing here has
been run against production.** Stage reached: implemented and unit/contract-tested against an in-memory model of the writer and a disposable PostgreSQL contract; not
integration-tested, not deployed.

## Pipeline (one dry-run, no hand-built dicts)
`cli.py plan MANIFEST --owner UUID --clock ISO [--rates F] [--images F --vehicle ID] [--out F]`

connector manifest (`client_mail_manifest_v1`: thread/message/RFC ids, part id, SHA-256, private `user-documents/<owner>/…` ref,
cited claims) -> `mail_manifest.plan` (financial_evidence_v1 envelopes) -> `timeline` events derived from each document's claims
-> `labor` source-claim arithmetic -> optional invoice-vs-photo reconciliation. The connector (authorized, read-only) is outside
this repo; no mail credential or app database is read here, and original bytes are never moved.

## Writer contract it is built against
Read from `supabase/migrations/20261028161800` (`ingest_financial_evidence`); the deployed `ingest_financial_evidence` SQL was read as metadata on 2026-11-07 (SELECT only; the producer was never run against it) and its
idempotency, supersession and field/concern caps match. Concern types are mapped below.
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

## Timeline and labor persistence
- **Source-claim cells (private, existing store):** timeline events and labor source-claim cells derived from a document's claims ride on that
  document's private `financial_evidence_v1` revision (`financial_document_extractions`, privacy tier private). Event identity is bytes + page +
  line + claim + stance, never the title, so an edit supersedes the old cell by `field_key` with the real run pointer and nothing is deleted.
- **Image-derived observations and invoice-vs-photo reconciliation (new owner-private store):** migration
  `20261107210025_private_work_projections.sql` adds `public.private_work_projections` (append-only; RLS on with no policy; no grant to
  `anon`/`authenticated`; `service_role` has SELECT and INSERT only, UPDATE/DELETE/TRUNCATE are refused by trigger for everyone),
  the writer `ingest_private_work_projection` and reader `read_private_work_projections` (both `SECURITY INVOKER`, execute for `service_role` only).
  They are reached only through `ingest-observation` mode `financial_evidence_v1`, actions `projection_submit` / `projection_read`
  (`privateProjection.ts`): the account is the caller's own credential (own account only; delegated access is refused), and a body naming an owner is refused.
  **Account scope is not vehicle ownership**: nothing here creates or implies a vehicle owner/co-owner permission, and a photo identity with a citation is
  an attributed observation, not authority.
  - `image_timeline_event` (one per retained image, key = hash of the image bytes): a visual observation, `completed_work_asserted:false`. A frame whose
    identity is unknown, unconfirmed or contextual, whose origin is excluded or personal, or that is privacy-held is recorded as **held**: no capture time, no
    vehicle link. Camera-local EXIF with an unknown offset is stored verbatim with `offset_state:'unknown'`; no UTC is derived (the table refuses a UTC
    value on an unknown offset).
  - `labor_reconciliation` (one per reconciled labor claim): the invoice **claim** (`source_claim:true`, `verified:false`), the **observed** days/frames/clusters
    (aware-offset frames only yield a lower bound), **holds** (unknown clock, unclassified intent, identity), **rate provenance** and **conflicts**,
    side by side. `additive:false`, `billable_hours:null`, `hours_verified:false` are enforced by the database; keys that assert total/verified hours,
    payment or ownership are refused. Photo evidence is never reinterpreted as billable hours.
  - Every row carries producer / method / version / run label and exact refs: image sha256, attachment sha256, source-message origin key, and the
    financial document revision (document id, extraction run id, original sha256, revision idempotency key) which the database checks belongs to the same account.
    Corrections are new revisions naming the current head (`supersedes_id`); a stale or missing pointer fails closed; replay is idempotent; equal content under a new run
    writes nothing; a source privacy hold, once set, cannot be cleared by a later revision. No raw mail body, OCR, person or bank data is accepted (content scan in the table guard).
  - The public `timeline_events` / `work_sessions` rows are still never written: `timeline.publish()` / `publish-timeline` always refuse.

### Projection workflow (dry-run by default)
1. `plan MANIFEST … --images F --vehicle ID --out CS --projection-out PCS` (images need an exact `sha256`; frames without one are listed as unpersistable).
2. Apply the financial changeset first (above): the labor projection cites that document revision, resolved from the live document at apply time.
3. `projection-backup PCS --owner UUID --out PATH --token-env NAME` (read-only; pre-state = every projection head; 0600 artifact outside the repo, integrity hash, owner, exact changeset, age <= 24 h).
4. `projection-apply PCS --owner UUID --backup PATH --receipt-sha SHA` is an offline check; `--execute --token-env NAME` re-validates, re-reads heads (a head that moved since the backup is refused), resolves
   document refs, submits batches of <= 50 sequentially, stops at the first refusal and returns a ledger (`done / already_applied / failed / not_attempted`).

**Not run anywhere:** the migration, writer and CLI have not been applied or executed against any service. They are covered by `supabase/sql/test_private_work_projections.sql`
(disposable PostgreSQL via `db-contracts`), the Deno handler tests in `financialEvidence.test.ts`, and the Python tests against an in-memory model of the writer.

## Limits and unverified items
- Verified read-only 2026-11-07: `financial_review_queue_concern_type_check` allows only `montant_non_corrobore`, `ecart_arithmetique`,
  `ecart_tva`, `doublon_suspect`, `piece_illisible`, `tiers_non_identifie`, `hors_perimetre`, `cut_off` (priority: low/medium/high/critical).
  `client_evidence_conflict` is not valid. The producer maps its classes (`claim_slot_conflict`, `amount_conflict` -> `montant_non_corrobore`;
  `composite_unmatched` -> `ecart_arithmetique`; `composite_repeat`, `rollup`, `custody_path_conflict` -> `doublon_suspect`) and keeps
  the class as a `[client_evidence:<class>]` prefix of `detail`. Tests assert every emitted concern is in the deployed set and
  `validate_changeset` refuses any other.
- Verified read-only 2026-11-07: the `read` action returns `read_financial_accounting`, which is `read_financial_evidence || {lines, ...}`,
  so `document.attributes.runs` is present and `state_summary` reads it; the test fixture has that shape.
- Still unverified: whether the caller's credential type is accepted for `read`/`submit` scopes; no live execution of backup/apply.
- A corrected claim amount gets a new `claim.<h>` key and drops the old one, so `apply` refuses it ("would drop prior field keys",
  fail closed). Only a forward that adds an origin is a supported revision.
- Image-derived events and invoice-vs-photo reconciliation have a private store and writer (above) that is implemented and unit/contract-tested but **not deployed or live-verified**; nothing goes to the public timeline. The store cannot verify that a cited image sha256 or message exists (those bytes live outside the database); it verifies shape, scope and the financial-document revision only.
- Intent labels, camera offsets and identity states are inputs supplied with each image; this code does not infer them. Image bytes, EXIF extraction and the identity review are outside this repo.
- Delegated (shared-book) access to projections is deliberately not offered: own account only.
- PDF-to-claim parsing and the connector export are not in this repo. No real-data run was made for this PR.
- Max 100 cells and 500 lines per original; larger documents are refused, not truncated.
- `process-receipt`, `smart-receipt-linker`, `daily-receipt` span fallbacks and `mail_attachments.py` are deliberately not reused.

# Image evidence loop runner

Runs the passes of the image and vehicle-record rebuild (design v6), writes their rows as the payloads of the
evidence writers, checks them, plans or performs the load, reads the result back against an exit fixture, and
issues the owner's review sheet. The writers and readers are the M1w and M1p blocks of the v6 design (not yet
migrations); this folder only calls them.

## Two modes

| | file (default) | db |
|---|---|---|
| Passes | build JSONL payloads from local inputs | the same |
| Checks | `checks.py` against the v6 CHECK rules and the privacy rules | the same; a violation stops the run |
| Load | `loader.py` dry run: `load-plan.json` (every call, batch and gate, no network) | writer RPCs through PostgREST; `load-manifest.json` (line key -> id); every returned id appended to the manifest |
| Exit test | `exit_test.py` against `readers.py`, a Python model of `vehicle_accounting_evidence` over the files | the read keyed by the owner through `scripts/data/q.sh`; stored as an `exit_test` run |
| Review | `review-<date>.md` + `.json` | the same, and a `review` run holding the sheet's sha256, row count and each row's targets, question and asks; the sheet joins the sheets index |
| Answers, promote, repin, publish, probe | print what they would call | the writers, one image per call |

db mode refuses to start unless `EVIDENCE_DB_WRITES=1`. Set it only after M1a and M1w are deployed and their
post-deploy checks pass (promotion also needs M1p and, for any testimony write, M1e). It reads
`SUPABASE_URL` (or `VITE_SUPABASE_URL`) and `SUPABASE_SERVICE_ROLE_KEY` from the environment: run it under
`dotenvx run --`. The key is never printed, logged or written; error text is scrubbed of it.

Writes go only through the writers (`evidence_open_run`, `propose_*`, `confirm_capture_times_by_rule`,
`record_day_context`, `evidence_record_answers`, `decide_evidence`, `promote_image`, `evidence_repin_after_merge`,
`publish_image`, `record_promotion_failure`, `evidence_probe_write`, `evidence_close_run`). Reads go through
`scripts/data/q.sh` (one statement, SELECT/WITH only, paced at `EVIDENCE_READ_GAP_S` seconds, default 60); every
reader call passes the owner as `p_user_id` (the 4th argument of `vehicle_accounting_evidence` and
`get_vehicle_day_records`, the 2nd of `evidence_candidates_for_images`, `evidence_custody` and
`evidence_identity_set`), so a service-role read shows his rows only. (v6) The readers raise when no user is named, and
the q.sh reader refuses a reader call whose SQL does not pass `:uid` as a uuid before it is sent; the scoreboard's
`evidence_status` calls pass `:uid` too.

## The manifest of returned ids (M10b)

Every writer call through `common.Rest` appends one line to `<EVIDENCE_MANIFEST_DIR, default
~/nuke-logs/image-rebuild-20261019/loop/manifests>/<UTC date>.jsonl`: the writer, the run, every id the call created
(`ids`, with `decision_ids`, `implied_decision_ids` and `reassign_decision_ids` also apart; (v6) the ids inside a
nested `reassign_result` too), support rows per claim, rows it returned without creating (`existing`) and the per-row
results. A call whose outcome is unknown (a client timeout) is recorded as `unknown`. The runner only appends; a line it
cannot write stops the loop. The scoreboard's M10b matches every evidence row created in the window against the
manifest; any unmanifested row holds promotion and publication and is reported with its ids. Owner decisions
(`human:`) are counted for the lead to match against the API request log.

(v6, AC10) M10b also checks the chat, from three local records in the loop dir (each path can be moved with its
setting): `sheets.jsonl` (`EVIDENCE_SHEETS_INDEX`; a line when a sheet is issued with its sha256, and when its delivery
message is recorded), `disputed.jsonl` (`EVIDENCE_DISPUTED`; answers runs a second reader, the transcript check or his
objection disputed, and the rows a later sheet asked again) and `readback.jsonl` (`EVIDENCE_READBACK`; every agent
decision recorded from his answers, with what the store did). `M10b_answers` matches each answers run to the chat
transcript (`transcript.py`: the sheet's delivery message hashes to the sheet's sha256, his reply comes after it and
holds each row's verbatim words) and marks a failing run disputed; `M10b_readback` lists any agent decision of the
week that is not on the read-back list; M4a leaves out agent rows of disputed runs, and so does promotion. Reading the
auth audit log for his account (M10b item 7) is the lead's.

## Per-row results reported, never retried

`already_decided`, `kept_stronger`, `owner_answer_missing`, `entity_is_owners_call`, `human_decision_newer`,
`human_decision_stands` and (v6) `reassign_needs_review`, `reassign_not_a_placement` and `unchanged` (and the
refusals `image_not_eligible`, `vehicle_not_in_scope`, `source_not_users`, `vehicle_not_found`, `not_current`,
`changed_since_review`) are counted in the load manifest and the decision records and never retried: the next run
or the next sheet asks again. The read-back on the next sheet says which of his answers the store did not record and
why.

## Run file mode

```bash
python3 scripts/evidence/loop.py --case <case.json> --out <dir> --user <owner uuid>
python3 scripts/evidence/test_evidence.py          # offline contracts on synthetic inputs
```

`loop.py` builds every pass, validates, plans the load, runs the exit fixture named by the case
(`exit_fixture`), writes the review sheet and `loop-report-<date>.json`. It exits 1 on a payload violation or a
failed structural exit assertion. Each `pass_*.py` also runs alone with the same arguments and writes only its
own lines.

## The case file

A case is a local JSON file (kept under `~/nuke-logs`, never in this repo) that holds what only his records say:
vehicle ids and aliases, input paths, the album choices, the ledger placements, the Gmail manifest, the Messages
mentions to resolve, the document anchors, the declared claims with their support selectors, place clusters, and
the hashed list of people's names the privacy check refuses. The passes are generic; the case carries the facts.
`testdata.py` writes a complete synthetic case and shows every key.

## Pinned sources

Money and document passes read only the files listed in the pinned list (`~/nuke-logs/image-rebuild-20261019/loop/
pinned_sources.txt` by default, `EVIDENCE_PINNED_SOURCES` or the case's `pinned_sources_file` to change it): exact
absolute paths, one per line. The runner never globs or recurses, refuses a directory, a path with glob characters,
a path not on the list, and any path containing `FOR-SIGNING` or `jenny-inbox` (in the list, at open time or after
resolving a symlink). A refused path stops the loop. Amounts are read from these files only when the loader resolves
an `@amount:<source>:<ref>` placeholder in db mode, in memory.

## Owner review and answers (v6)

- Each numbered row asks one question, of one decision kind, in one dimension, and names its targets: the exact ids a
  bare yes or no decides, plus the payment key, account or image a named place may land on. The review run stores the
  targets with the row's `question` (always written) and `asks` (`place`, or `party` for a who-paid row); the writer
  derives the rest of the row's profile (`asked_place`, `frame`, `link_class`, what it covers) and `review_sheet.py`
  computes the same profile so a reading is checked before it is stored. A row whose targets did not load is left off.
  Questions that decide no evidence row (spend, the writers, the Photos order, "is account X closed or is an export
  missing?" for a lagging account) are listed apart as lettered decisions. Thumbnails only for images the phone's
  vision gate approved; others say "review in the app".
- Rows: a photo lists its candidate and the image; an album its album link; a pair its claim; a contested payment its
  key and its unallocated links on this truck; a contradiction the contradicting link and the key; money in its key
  and links; an account its map row and the account; a document line with no payment found is a **who-paid** row
  (`asks: party`, the one placement link), as is the case's "who paid for the truck" (the acquisition claim). A case
  question that lists only an image states its `question` ("which truck is in this photo?" is `image_candidate`) and
  optionally its `frame`. Rows a second reader or his objection disputed are asked again ("asked again") until a
  delivered sheet has asked them.
- The sheet opens with the read-back: every agent decision of the last 7 days, his reading of each answer and what
  the store recorded (or that it did not, and why).
- Send the `.md` text as its own message, then `record_answers.py delivered --message-ref <source>:<message id>`.
  `store` takes his reply as a later message (`<source>:<message id>`, one answers run per message and per sheet)
  with his words verbatim and the transcriber's structured reading, `{"decision": "confirmed" | "rejected" |
  "unsure", and at most one place of the row's dimension}`: `vehicle_id` / `subject_key` on a photo, album or
  unallocated placement, `entity_key` on an account or who-paid row, `captured_on` on a capture time, none on a pair,
  claim, share or contradiction. "Yes" is `{confirmed}` (or names the asked place), a bare "no" is `{rejected}`, "no,
  it is Y" is `{rejected, Y}`, a "where?" row takes `{confirmed, <place>}`, a row in several places only a bare yes or
  no, a who-paid row `{confirmed, entity_key}`; `{rejected, <the asked place>}` and `{confirmed, <another place>}` are
  refused. When the transcript is on this Mac the delivery and the reply are checked there first.
- `decide` checks each decision as `decide_evidence` does: the kind is the row's question; a who-paid row decides
  nothing; every target is on the row or in the slot it asks about; a bare yes or no decides only the row's exact
  targets; a named place confirms only what sits there and rejects the asked target or another place in an exclusive
  slot; a reassign is his "no, it is Y".
- A payment that rests on his word answers a who-paid row: an `owner_statement` link at that row's place citing
  `answers:<run>#<row>`, with payment key `owner:answers:<run>#<row>`, the entity his answer names on the paying side,
  and `{"kind": "answers_row_target", "ref": <the row's target>}` in its evidence.
- `second-read packet` gives a second reader the rows and his words with no reading; `second-read compare` disputes
  the answers run on any disagreement; `dispute` records his objection to a read-back line.

## Payload rules (v6)

- A pass names only third parties (`third_party:<x>`) as payer, payee or party, or leaves it NULL: whose money it
  was comes from his confirmed account map or his own statement. The owner may be named as the worker of a
  `work_performed` / `worked_on` claim; a truck with no row is a `subject_key` there and on links and candidates.
- Only a payment-source run (`ledger_vendor_date`, later `qb_correlation`, `receipt_vehicle_id`) records
  `coverage_to` (a real date), always with `covers_accounts` (the account refs the export truly covers); (v6) the
  case's `closed_accounts` adds the accounts whose final statement the export is (a subset of `covers_accounts`). The
  reader then counts coverage over his open accounts only, names the accounts an assertion waits on and asks about an
  open account whose coverage lags (`money_source_behind`).
- `custody_bounds` proposes only an acquisition upper bound (occurred_to = the first own-photo day, no start,
  confidence at most 0.5) where no source dates the acquisition, and never a sale.
- Every capture-time claim carries `witness.upload_day`; the batch gate records counts per upload day, and the
  loader calls `confirm_capture_times_by_rule` after the claims are in. (v6) The time pass re-proposes freely: an
  identical claim comes back `unchanged`. A capture time on his word (`rule: owner`) carries `witness.answer_ref` of
  his answer to a capture-time row.
- (v6) Work sessions are his own: a session another user logged on the truck never makes a work day.
- Album items with no image row become `photos_item` links (context, `photos:<uuid>`), listed per day by the reader.

## Privacy rules

- Files name money by ledger line id, payment key or link id, never by amount. Every amount field is a placeholder;
  `checks.py` refuses a number, a dollar sign or any amount the pinned sources hold appearing in a payload.
- No personal contact details: no e-mail address, phone number, street address or coordinates (place clusters are
  labels). Counterparties are a business name or a role. A ledger line's free text is never copied.
- The owner's user id appears only in the output's `run.json` `config.user_id` (local) and never in this repo.
- Photos are read as metadata only (`photos_index.py`, `photos_join.py`); no pixels leave the Mac.
- Messages: `chat.db` is opened read-only (`mode=ro`); only message GUIDs, directions and per-day counts leave the
  pass, and no text column is selected. Chats are named by a hash of their row id.
- Gmail: ids and the ledger line a total joins, never the total (`pass_gmail.py`). The repo has no Gmail API
  client, so a session with the Gmail connector writes the manifest; `collect_from_mail()` documents the stub.
- His review answers are stored verbatim only in the owner-private store (`evidence_record_answers`); local
  receipts keep their sha256 and the structured reading. The transcript check reads his words in memory and writes
  only refs and verdicts; the second reader's packet (his words, no reading) stays beside the sheet under nuke-logs.

## Load rules (db mode)

- At most 500 rows per call (account entities 200, claim support 50, one claim per call), one row per image or
  source key in a call so each result maps back to its line.
- Listing-gallery rows wait until the dedupe's done list names the vehicle, and `is_duplicate` is re-checked per
  image id right before each call.
- IO waiters at most 3 before each batch, no lock waiters after it. Stop conditions (the run closes `aborted` with
  the reason): a writer's 42501, the insert or append-only guard, IO above 3 for 10 minutes, a halting row in
  `evidence_revert_watch`, a STOP file for a vehicle in scope, a refused pinned source.
- Promotion: one image per call, refused 03:15-03:35Z, daily cap of 1,000 testimony writes; a 57014 is recorded
  with `record_promotion_failure` (steps promote, repin, publish) and retried next run.

## Scheduling

`launchd/` holds two templates. Fill `__HOME__`, `__WORKTREE__` (a detached worktree the job resets to
origin/main before each run), `__CASE__`, `__OUT__`, `__MODE__` and `__DB_WRITES__`, check with `plutil -lint`, then
`launchctl bootstrap gui/$(id -u) <file>`.

- `ag.nuke.evidence-loop`: `loop.py` daily at 04:00 local (Pacific).
- `ag.nuke.evidence-repin`: wakes every 15 minutes; `repin.py --window-utc 02:45-03:00` acts only in that UTC
  window, before the 03:20Z derive sweep, whatever the daylight-saving offset.

Install them in file mode first; switch `__MODE__` to `db` and `__DB_WRITES__` to `1` only once the store is live.

## Files

| File | Job |
|---|---|
| `common.py` | modes, pinned sources, PostgREST client, q.sh reader, case context |
| `payloads.py` | the writer contract (signatures, vocabularies) and every payload builder; override per case |
| `checks.py` | the v6 CHECK rules and the privacy scan over a payload directory |
| `readers.py` | file-mode `vehicle_accounting_evidence` (v6) and the M5 extraction |
| `manifest.py` | the manifest of ids every writer call returned, the M10b reconciliation, the disputed and read-back lists |
| `transcript.py` | finds a `<source>:<message id>` in the Claude Code transcripts; checks a sheet's delivery and his reply |
| `inputs.py`, `money.py` | input readers; pinned money sources (metadata for passes, amounts for the loader) |
| `photos_index.py`, `photos_join.py`, `photos_albums.py` | Photos metadata index, the image join, album to vehicle map |
| `pass_*.py`, `passlib.py` | the passes and their orchestration |
| `loader.py` | replay through the writers |
| `review_sheet.py`, `record_answers.py` | the owner review, its delivery, his stored answers, decisions citing them, the second reader |
| `promote.py`, `repin.py`, `publish.py`, `probe.py`, `dbops.py` | the promotion path, one image per call |
| `exit_test.py` | the exit fixture against the read |
| `scoreboard.sql`, `scoreboard.py` | the daily scoreboard with a diff |
| `loop.py` | the daily sequence and its stop conditions |
| `test_evidence.py`, `testdata.py` | offline contracts on synthetic inputs |

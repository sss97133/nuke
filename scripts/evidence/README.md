# Image evidence loop runner

Runs the passes of the image and vehicle-record rebuild (design v10), writes their rows as the payloads of the
evidence writers, checks them, plans or performs the load, reads the result back against an exit fixture, and
issues the owner's review sheet. The writers and readers are the M1w and M1p blocks of the v10 design (not yet
migrations); this folder only calls them.

(v8) No job decides. The runner proposes, stores his chat answers word for word and reads; every decision is his,
from his own step-up session in the app. It never calls `decide_evidence` (the service role has no EXECUTE on it, and
its body refuses any job: `agent_channel_disabled`), never writes his word (an `owner_statement` link, an `owner:`
payment key or a rule `owner` capture time: `owner_answer_missing`) and never opens an `owner_review` run.

## Two modes

| | file (default) | db |
|---|---|---|
| Passes | build JSONL payloads from local inputs | the same |
| Checks | `checks.py` against the v10 CHECK rules and the privacy rules | the same; a violation stops the run |
| Load | `loader.py` dry run: `load-plan.json` (every call, batch and gate, no network) | writer RPCs through PostgREST; `load-manifest.json` (line key -> id); every returned id appended to the manifest |
| Exit test | `exit_test.py` against `readers.py`, a Python model of `vehicle_accounting_evidence` over the files | the read keyed by the owner through `scripts/data/q.sh`; stored as an `exit_test` run; the confirmed level waits on his decisions in the app |
| Review | `review-<date>.md` + `.json` | a `review` run (opened running) holding the sheet's sha256, row count and each row's targets, question and asks; the sheet joins the sheets index and is held as `review-<date>.unsent` until `record_answers.py send` closes the run and records the store's send time; only then is the `.md` written |
| Answers | a local receipt per message (sha256 and reading per row) | `evidence_record_answers`: his words stored per chat message with its time, written closed; nothing decided |
| Promote, repin, publish, probe | print what they would call | the writers, one image per call |

db mode refuses to start unless `EVIDENCE_DB_WRITES=1`. Set it only after M1a and M1w are deployed and their
post-deploy checks pass (promotion also needs M1p and, for any testimony write, M1e). It reads
`SUPABASE_URL` (or `VITE_SUPABASE_URL`) and `SUPABASE_SERVICE_ROLE_KEY` from the environment: run it under
`dotenvx run --`. The key is never printed, logged or written; error text is scrubbed of it.

Writes go only through the job writers (`evidence_open_run`, `propose_*`, `confirm_capture_times_by_rule`,
`record_day_context`, `evidence_record_answers`, `promote_image`, `evidence_repin_after_merge`, `publish_image`,
`record_promotion_failure`, `evidence_probe_write`, `evidence_close_run`). Reads go through `scripts/data/q.sh` (one
statement, SELECT/WITH only, paced at `EVIDENCE_READ_GAP_S` seconds, default 60); every reader call passes the owner
as `p_user_id` (the 4th argument of `vehicle_accounting_evidence` and `get_vehicle_day_records`, the 2nd of
`evidence_candidates_for_images`, `evidence_custody` and `evidence_identity_set`, the 1st of
`evidence_answers_to_confirm`), so a service-role read shows his rows only. The readers raise when no user is named,
and the q.sh reader refuses a reader call whose SQL does not pass `:uid` as a uuid before it is sent; the scoreboard's
`evidence_status` calls pass `:uid` too.

## The manifest of returned ids (M10b)

Every writer call through `common.Rest` appends one line to `<EVIDENCE_MANIFEST_DIR, default
~/nuke-logs/image-rebuild-20261019/loop/manifests>/<UTC date>.jsonl`: the writer, the run, every id the call created
(`ids`, with machine `decision_ids` also apart), support rows per claim, rows it returned without creating
(`existing`) and the per-row results. A call whose outcome is unknown (a client timeout) is recorded as `unknown`. The
runner only appends; a line it cannot write stops the loop. The scoreboard's M10b matches every evidence row a job
created in the window against the manifest; any unmanifested row (an agent decision included) holds promotion and
publication and is reported with its ids. His decisions (`human:`), the rejections his confirms imply (`implied:`) and
the rows his decisions write (`created_by` `human:`) are counted for the lead to match against the API request log.

M10b also checks the chat, from two local records in the loop dir (each path can be moved with its setting):
`sheets.jsonl` (`EVIDENCE_SHEETS_INDEX`; a line when a sheet is issued with its sha256, and when its delivery message
is recorded) and `disputed.jsonl` (`EVIDENCE_DISPUTED`; answers runs a second reader, the transcript check or his
objection disputed, and the rows a later sheet asked again). `M10b_answers` matches each answers run to the chat
transcript (`transcript.py`: the sheet's delivery message hashes to the sheet's sha256, his reply comes after it and
holds each row's verbatim words, and (v9) the stored message time is the reply's own) and marks a failing run
disputed; the next sheet asks its rows again. Reading the auth audit log for his account (M10b item 7) is the lead's.

(v8) M4a is transcription accuracy: for each of his decisions that cites a stored answer, whether the stored reading
(`detail.stored_reading`) agrees with what he decided. M10_stamps expects no agent row, no owner day a job wrote, no
owner statement without his decision and no service_role EXECUTE on `decide_evidence`; M10_step_up, every human
decision from a step-up session. M15 reads `evidence_answers_to_confirm(:uid)`: his stored answers waiting for him
((v10) his latest answer per question, `replaced_by` NULL: a question keeps its key across its re-asks), the rows
re-written with another meaning since (asked again), and his decisions so far; until he has decided, the confirmed
level reads "waiting on his app". M5 sums nothing and lists his statements apart (`stated`, ids only): only the
`costs` bands are payments.

## Per-row results reported, never retried

`already_decided`, `already_rejected`, `kept_stronger`, `owner_answer_missing`, `entity_is_owners_call` and
`unchanged` (and the refusals `image_not_eligible`, `vehicle_not_in_scope`, `source_not_users`, `vehicle_not_found`)
are counted in the load manifest and never retried: the next run or the next sheet asks again. (v9) A photo's
`already_rejected` (a truck he said no to for it, on any row or id of that truck, or a place other than the subject he
confirmed) writes nothing and leaves the line off the sheet; a skip a writer both counts and itemizes is counted once.
A claim his decision or his who-paid statement answers is never superseded by a pass: the line's support goes onto
his claim (`claim_carries_owner_decision`); a claim that is no longer current is `claim_not_current`. (v10) A capture
time on a day he said no to is `already_rejected` whatever its instant, and the batch gate skips it. An image
candidate is matched to its line by image id: the store keeps the photo's own vehicle row (for a photo a merge moved,
the row it came from), not always the vehicle the pass named.

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
`testdata.py` writes a complete synthetic case and shows every key (its `as_of` sets the case clock for synthetic
years ahead of today).

## Pinned sources

Money and document passes read only the files listed in the pinned list (`~/nuke-logs/image-rebuild-20261019/loop/
pinned_sources.txt` by default, `EVIDENCE_PINNED_SOURCES` or the case's `pinned_sources_file` to change it): exact
absolute paths, one per line. The runner never globs or recurses, refuses a directory, a path with glob characters,
a path not on the list, and any path containing `FOR-SIGNING` or `jenny-inbox` (in the list, at open time or after
resolving a symlink). A refused path stops the loop. Amounts are read from these files only when the loader resolves
an `@amount:<source>:<ref>` placeholder in db mode, in memory.

## Owner review and answers (v10)

- Each numbered row asks one question, of one decision kind, in one dimension, and names its targets: the exact ids a
  bare yes or no is about, plus the payment key, account or image a named place may land on. The review run stores the
  targets with the row's `question` (always written) and `asks` (`place`, or `party` for a who-paid row); the writer
  derives the rest of the row's profile (`asked_place`, `frame`, `link_class`, what it covers) and `review_sheet.py`
  computes the same profile so a reading is checked before it is stored. A row whose targets did not load is left off.
  Questions that decide no evidence row (spend, the writers, the Photos order, "is account X closed or is an export
  missing?" for a lagging account, "is there an export of account X?" for an account no statement covers) are listed
  apart as lettered decisions. Thumbnails only for images the phone's vision gate approved; others say "review in the
  app".
- Rows: a photo lists its candidate and the image; an album its album link; a pair its claim; a contested payment its
  key and its unallocated links on this truck; a contradiction the contradicting link and the key; money in its key
  and links; an account its map row and the account. A **who-paid** row (`asks: party`, exactly one target) asks only
  about money no payment source carries (a jacket line, an order with no bank line: its one placement link) or an
  acquisition or sale claim (the case's "who paid for the truck"). Money with a payment key gets its payer from the
  account map: its question is the account's row, and `evidence_open_run` refuses a who-paid row on it, and on any
  line of a payment source, keyed or not ((v10) one list: a bank, card or ledger line, a payment event, a QB
  transaction or a journal entry; a P&L line is not one, so a who-paid row may ask about it). A
  row whose targets place nothing asks about place `none`. Rows a second reader or his objection disputed are asked
  again ("asked again") until a delivered sheet has asked them; (v9) a row of a sent db sheet is asked again by
  reference (`{"reask_of": "review:<sheet run>#<row>"}`): the writer copies it exactly as it was frozen, and the
  sidecar keeps the frozen row. The runner never sends `asked_first`: (v10) the writer sets it on a re-ask (the
  question's first asking, which keeps one question across sheets) and drops it from a fresh row. A sheet lists at
  most 10,000 targets. (v10) Two or more current acquisition (or sale) claims on the truck (`acquisition_conflict`)
  are asked one yes/no row per claim: is this one the deal?
- The order, so that no reply of his can predate the sheet (the store takes only messages written after the review
  run was closed, `message_predates_sheet`): (1) `record_answers.py send --mode db` closes the review run, once, reads
  back the store's send time (the run's `finished_at`), writes it into the sidecar (`sent_at`) and only then writes
  `review-<date>.md`; a db sheet is held as `review-<date>.unsent` until then, so there is nothing to post before the
  close, and a run the store does not hold `done` is never posted. (2) Post the `.md` text as its own message. (3)
  `record_answers.py delivered --message-ref <source>:<message id>` records that message; it refuses a sheet not yet
  sent, and a message the transcript dates before the send time. A file-mode sheet has no run: `send` records the
  local clock. A message ref is `<source>:<message id>`: one colon, no path, stored lower-cased; for a Claude session
  the session id and the message's own uuid.
- `store` takes one message of his reply, a later message than the delivery: (v9) one answers run per chat message
  (a reply spread over several messages is stored message by message on the sheet it answers, one receipt each; a
  message id is stored once, whatever the source), written closed, with the message's own time: the transcript's when
  it is on this Mac, else `--message-at` as the chat shows it, never the time of storing. The store refuses a sheet
  never sent (`sheet_not_sent`), a message older than the sheet's sending (`message_predates_sheet`), a time from the
  future, an empty set and more than 20,000 characters of his words per row; refusals are reported, never retried.
  Each row carries his words verbatim and, when the transcriber has one, a structured reading:
  `{"decision": "confirmed" | "rejected" | "unsure", and at most one place of the row's dimension}`: `vehicle_id` /
  `subject_key` on a photo, album or unallocated placement, `entity_key` on an account or who-paid row, `captured_on`
  on a capture time, none on a pair, claim, share or contradiction. "Yes" is `{confirmed}` (or names the asked place),
  a bare "no" is `{rejected}`, "no, it is Y" is `{rejected, Y}`, a "where?" row takes `{confirmed, <place>}`, a row in
  several places only a bare yes or no, a who-paid row `{confirmed, entity_key}`; `{rejected, <the asked place>}` and
  `{confirmed, <another place>}` are refused. When his words are unclear, send `{"verbatim"}` alone: the store keeps
  them as `{"decision": "unsure", "unread": true}`, and the app shows his words only. Storing decides nothing: he
  confirms each answer himself in the app (`evidence_answers_to_confirm`). When the transcript is on this Mac the
  delivery and the reply are checked there first.
- `second-read packet` gives a second reader the rows and his words with no reading; `second-read compare` disputes
  the answers run on any disagreement with a stored reading (rows stored unread are skipped); `dispute` records his
  objection to a stored reading. `decide` is retired.

## Payload rules (v10)

- A pass names only third parties (`third_party:<x>`) as payer, payee or party, or leaves it NULL: whose money it
  was comes from his confirmed account map or his own statement, which only his decision in the app writes. The owner
  may be named as the worker of a `work_performed` / `worked_on` claim; a truck with no row is a `subject_key` there
  and on links and candidates.
- Only a payment-source run (`ledger_vendor_date`, later `qb_correlation`, `receipt_vehicle_id`) records
  `coverage_to` (a real date, never later than the run day), always with `covers_accounts` (the account refs the export
  truly covers); the case's `closed_accounts` adds the accounts whose final statement the export is (a subset of
  `covers_accounts`). The reader counts coverage over his open accounts only (an account's closed state is the word of
  the newest run covering it), names the accounts an assertion waits on, asks about an open account whose coverage
  lags (`money_source_behind`) and about an account his records name that no statement covers
  (`money_source_missing`).
- `custody_bounds` proposes only an acquisition upper bound (occurred_to = the first own-photo day, no start,
  confidence at most 0.5) where no source dates the acquisition, and never a sale.
- Every capture-time claim carries `witness.upload_day`; the batch gate records counts per upload day, and the
  loader calls `confirm_capture_times_by_rule` after the claims are in. The time pass re-proposes freely: an identical
  claim comes back `unchanged`. A capture time on his word comes only from his own decision in the app; a day he
  rejected leaves the photo undated.
- Work sessions are his own: a session another user logged on the truck never makes a work day.
- Album items with no image row become `photos_item` links (context, `photos:<uuid>`), listed per day by the reader.

## The file-mode readers (v10)

`readers.py` follows `vehicle_accounting_evidence` and the day readers over the payload files (the exit test's file
mode). A photo's row reads `rejected` when his latest word on that photo, truck (its identity: his confirmed same-truck
pairs) and frame role, on any row, is a no, or when he confirmed another subject for the photo; an album row reads
`confirmed_by_album_map` only when the album's truck is the row's; (v10) a row and a VIN are not known to differ (file
mode reads no VINs). (v10, the lead's money decision) An owner statement is never summed: no `costs` band holds one;
every confirmed statement is listed under the top-level `stated` with the row it answers and the keyed payments that
cover it (`covered_by`; `covered_cents` is information only, and file mode reads no cents). A statement exists only on
his decision in the app, so in file mode it appears only when a payload carries one. A payment is dated by the one
list of payment sources (a journal entry is one, a P&L line is not). Two or more current acquisition (or sale)
claims add the open question `acquisition_conflict`.

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
- (v10) On any load larger than the pilot, ANALYZE the evidence tables between batches: writer calls slow as
  unanalyzed rows accumulate (0.2 s to 1.1 s per 500-row batch at 10x the pilot; one early ANALYZE keeps them near
  67 ms). It is an operator step for the lane lead: the runner's read path runs SELECT only.

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
| `checks.py` | the v10 CHECK rules and the privacy scan over a payload directory |
| `readers.py` | file-mode `vehicle_accounting_evidence` (v10) and the M5 extraction |
| `manifest.py` | the manifest of ids every writer call returned, the M10b reconciliation, the disputed list |
| `transcript.py` | finds a `<source>:<message id>` in the Claude Code transcripts; checks a sheet's delivery and his reply |
| `inputs.py`, `money.py` | input readers; pinned money sources (metadata for passes, amounts for the loader) |
| `photos_index.py`, `photos_join.py`, `photos_albums.py` | Photos metadata index, the image join, album to vehicle map |
| `pass_*.py`, `passlib.py` | the passes and their orchestration |
| `loader.py` | replay through the writers |
| `review_sheet.py`, `record_answers.py` | the owner review, its delivery, his stored answers, the second reader |
| `promote.py`, `repin.py`, `publish.py`, `probe.py`, `dbops.py` | the promotion path, one image per call |
| `exit_test.py` | the exit fixture against the read |
| `scoreboard.sql`, `scoreboard.py` | the daily scoreboard with a diff |
| `loop.py` | the daily sequence and its stop conditions |
| `test_evidence.py`, `testdata.py` | offline contracts on synthetic inputs |

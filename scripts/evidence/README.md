# Image evidence loop runner

Runs the passes of the image and vehicle-record rebuild (design v3), writes their rows as the payloads of the
evidence writers, checks them, plans or performs the load, reads the result back against an exit fixture, and
issues the owner's review sheet. The writers and readers are the M1w and M1p blocks of the v3 design (not yet
migrations); this folder only calls them.

## Two modes

| | file (default) | db |
|---|---|---|
| Passes | build JSONL payloads from local inputs | the same |
| Checks | `checks.py` against the v3 CHECK rules and the privacy rules | the same; a violation stops the run |
| Load | `loader.py` dry run: `load-plan.json` (every call, batch and gate, no network) | writer RPCs through PostgREST; `load-manifest.json` (line key -> id) |
| Exit test | `exit_test.py` against `readers.py`, a Python model of `vehicle_accounting_evidence` over the files | the live read through `scripts/data/q.sh`; stored as an `exit_test` run |
| Review | `review-<date>.md` + `.json` | the same, and a `review` run holding the sheet's sha256 and row count |
| Answers, promote, repin, publish, probe | print what they would call | the writers, one image per call |

db mode refuses to start unless `EVIDENCE_DB_WRITES=1`. Set it only after M1a and M1w are deployed and their
post-deploy checks pass (promotion also needs M1p and, for any testimony write, M1e). It reads
`SUPABASE_URL` (or `VITE_SUPABASE_URL`) and `SUPABASE_SERVICE_ROLE_KEY` from the environment: run it under
`dotenvx run --`. The key is never printed, logged or written; error text is scrubbed of it.

Writes go only through the writers (`evidence_open_run`, `propose_*`, `record_day_context`,
`evidence_record_answers`, `decide_evidence`, `promote_image`, `evidence_repin_after_merge`, `publish_image`,
`record_promotion_failure`, `evidence_probe_write`, `evidence_close_run`). Reads go through `scripts/data/q.sh`
(one statement, SELECT/WITH only, paced at `EVIDENCE_READ_GAP_S` seconds, default 60).

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
  receipts keep their sha256.

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
| `checks.py` | the v3 CHECK rules and the privacy scan over a payload directory |
| `readers.py` | file-mode `vehicle_accounting_evidence` and the M5 extraction |
| `inputs.py`, `money.py` | input readers; pinned money sources (metadata for passes, amounts for the loader) |
| `photos_index.py`, `photos_join.py`, `photos_albums.py` | Photos metadata index, the image join, album to vehicle map |
| `pass_*.py`, `passlib.py` | the passes and their orchestration |
| `loader.py` | replay through the writers |
| `review_sheet.py`, `record_answers.py` | the owner review, his stored answers, decisions citing them |
| `promote.py`, `repin.py`, `publish.py`, `probe.py`, `dbops.py` | the promotion path, one image per call |
| `exit_test.py` | the exit fixture against the read |
| `scoreboard.sql`, `scoreboard.py` | the daily scoreboard with a diff |
| `loop.py` | the daily sequence and its stop conditions |
| `test_evidence.py`, `testdata.py` | offline contracts on synthetic inputs |

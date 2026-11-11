# Keys dry run

A read-only harness for the keys role ([`skills/image-keys/SKILL.md`](../../../skills/image-keys/SKILL.md)). It takes
the statements readers have already stored about one vehicle's photos, has the keys role give each one the model's
keys, checks every result by code, folds repeats, and joins receipt lines through the same part keys. It reads no
photo. The dry run writes nothing to the database; landing is a separate, explicit step (below). It exists so a
claim about what keying would add to the model can be measured first, landed deliberately, and replayed afterwards.

Owner direction this follows (2026-11-10, `docs/ledger/theory/data-machine.md`, "Image analysis is the model asking"):
a reading is finished when it is keyed; "the best type of batch is one at a time ... and then figuring out how to
speed things up beyond one at a time ... if they can't do one, they definitely can't do [many]"; batch context "is
a different approach, a different harness".

## The pieces

| File | What it is |
|---|---|
| `pull.sql` | One read-only query: a vehicle's stored statements and the receipt-part questions already answered about it. |
| `prepare.py` | Turns that result into inputs: one file per photo, batches that never split a photo, receipt lines without prices. |
| `workflows/one-photo.js` | The unit: one agent keys one photo and returns data. Nothing is shared but the registry and the decisions. |
| `workflows/batches.js` | The speed-up that was measured: one agent keys about fifteen photos, bound by the same decisions. |
| `check_units.py` | **The code check.** Every photo's result passes it or is not counted. `test_check_units.py` holds its cases. |
| `compare.py` | The same statements keyed two ways: where one photo at a time and a batch agree. |
| `workflows/verify.js` | The steps that need the whole set: one reconciler merges drafted names; three skeptics try to refute a sample. |
| `fold.py` | Folding in code: same part, side, state and capture day is one claim with every photo as witness. Joins receipts. |
| `pack_claims.py` | Chooses the keyed claims the writer can accept today and packs them, with a checksum per part. |
| `land.sql` | **The landing.** Has the database POST each packed claim to `ingest-observation`, as the project's own jobs do. It inserts nothing itself. |
| `fold.sql` | Reads back what landed and folds it in the database: keyed count, folded claims, photos behind each. |
| `registry.snapshot.md`, `registry.snapshot.json` | The registry as read from production on 2026-11-10. A dated copy: read it again before a new run. |
| `decisions.pending.2026-11-10.json` | The memory from the first run: 122 part decisions, 49 state decisions, 24 conventions. Drafted by an agent, **pending, not approved**. |

The workflow files are Claude Code workflow scripts. Each takes `args.dir`, the private data folder.

## Running it

Everything private stays in a folder outside the repository. The repository holds only the code, the registry copy
and the pending decisions.

```bash
export KEYS_DRY_RUN_DATA=~/nuke-logs/keys-dry-run/<vehicle>      # private; never commit it
# 1. run pull.sql with the vehicle and user ids filled in; save the result as $KEYS_DRY_RUN_DATA/raw.json
python3 scripts/photo-pipeline/keys-dry-run/prepare.py --context "<vehicle kind and the job in hand>"
# 2. one photo first (workflows/one-photo.js, args: {dir, photos: ["<photo>"]}), then check it:
python3 scripts/photo-pipeline/keys-dry-run/check_units.py <workflow output> --show
# 3. only when one passes: more photos one at a time, or batches (workflows/batches.js, args: {dir, chunks, receipts})
# 4. the whole set: workflows/verify.js, then
python3 scripts/photo-pipeline/keys-dry-run/fold.py --map <the reconciler's merges as {from: to}>
```

## Landing

The owner, 2026-11-11, asked whether keys and folds was going, and then: "You have db acces you do it". The first
landing was done that hour, by hand, through the sanctioned writer:

```bash
python3 scripts/photo-pipeline/keys-dry-run/fold.py --map <merges> --json $KEYS_DRY_RUN_DATA/fold.json
python3 scripts/photo-pipeline/keys-dry-run/pack_claims.py $KEYS_DRY_RUN_DATA/fold.json
# land.sql: one claim first, read it back with fold.sql, then each part
```

Only a claim whose state is a live `condition_taxonomy` key lands. Its part rides in `structured_data` until a part
has a place on an observation. A landed row is agent testimony capped at 0.6; it is replaced through
`supersede_observation_relay` after a successor has landed, never edited.

## What it is not

- Not a runner. The landing above was run once by an agent. Nothing schedules it, and the writer, scoreboard and
  database gates the theory card lists are still not built.
- Not a reader. It adds no vocabulary of its own: every key is a registry key, a stored decision or a proposal.
- Not an approval. A drafted key is a proposal for the owner. The decisions file says what an agent decided so that
  the next run decides the same way; it does not say the owner agreed.

The results of the first run are in [`docs/ledger/theory/image-keys-test.md`](../../../docs/ledger/theory/image-keys-test.md).

## The lane

[`../keys_lane.py`](../keys_lane.py) is the one-photo unit run without an agent workflow. For one vehicle it takes the
stored statements of one photo at a time, has the `claude` CLI key them on the subscription with the same brief,
conventions and decisions, checks the result with `check_units.py` against the registry read live, and with `--write`
sends each landable claim to `ingest-observation` with the body `land.sql` builds. It reads no photo and prints
counts only. Its cases are in `../test_keys_lane.py`.

Three things it does beyond the dry run's check, each counted in its summary:

- A condition key is offered and landed only when it is live **and** in the curated list of `registry.snapshot.json`.
  The table also holds fragments of a service manual that no column marks, and the writer admits any live key.
- A result is rejected when one statement carries more than six claims, or when a landable claim quotes fewer than
  two words of its statement (unless that is the whole statement).
- A POST that gets no answer, a 5xx or a 429 is sent again with the same bytes, three times in all. The writer
  answers duplicate when an earlier attempt had landed the row, so a re-send cannot land it twice.

What a run says beyond its counts, all of it safe for a public log:

- **Which places were missing.** For every claim it could not land: where its state is (a registered property, or a
  drafted name) and the state's name when it is shaped like a key. A drafted name is the list to take to the
  registry: an existing key or alias first, then a proposal. A registered property is not this lane's to send (next
  section).
- **Why a model call failed.** The tool's own error line, and only that: a result the CLI did not mark as an error,
  or anything on stdout that is not an envelope, may be the model's answer and is never printed. Six characters in a
  row of a stored secret, a header value, an id, an address and a long token are removed before the line is cut.
- **What was wrong with the stored token.** A subscription token copied from a wrapped terminal line carries a line
  break; the CLI then cannot build the request and no model is asked (`Header '14' has invalid value`, first run,
  2026-11-11). The lane uses the token without its white space and says what it removed as counts. Other jobs read
  the secret as stored, so it still has to be saved again as one line.

It is started by a person: the dispatch-only workflow `Photo Keys Lane` (`.github/workflows/photo-keys.yml`), or

```bash
# needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and CLAUDE_CODE_OAUTH_TOKEN; refuses to start if ANTHROPIC_API_KEY is set
python3 scripts/photo-pipeline/keys_lane.py --vehicle-id <uuid> --user-id <uuid> --photos 1            # dry run
python3 scripts/photo-pipeline/keys_lane.py --vehicle-id <uuid> --user-id <uuid> --photos 1 --write    # lands
```

### The three values a stored reading already holds

Rust severity, paint stage and assembly state each have a registered property, and a deep reading already stores a
value for each beside its statements (`state_observations.rust_severity`, `paint_state`, `completeness`). Their owner
is the existing projection, `scripts/deep-image-analysis-byok.mjs project-cached`
(`scripts/lib/image-property-projection.mjs`): it copies the reader's own value, calls no model and keeps the source
row's id and a hash of it in every claim. So when the keys role places a sentence on one of these properties, the
lane does not land it: that would be a second owner of the same property on the same photo, derived a second way.

The projection had never run on an owner's own photos. Its batch intake takes a public vehicle's listing photos only
(`20261004064216`). `--single` sends one claim at a time through `ingest-observation` and reads each row and its
witness back. Beside that one rule it keeps what the batch intake checks: a photographed paper is deferred, the
reading must pass the database's own `observation_is_public` (asked by RPC; no answer defers it), and a claim that a
row already holds, current or superseded, is not sent again, so a second run goes on where the first stopped.
`--pages` walks more than one window, by `(ingested_at, id)`, so readings stored at one instant are not skipped.
The same workflow runs it with `step=properties`:

```bash
gh workflow run photo-keys.yml -f step=properties -f vehicle_id=<uuid> -f user_id=<uuid> -f photos=99 -f pages=10              # dry run: counts
gh workflow run photo-keys.yml -f step=properties -f vehicle_id=<uuid> -f user_id=<uuid> -f photos=1 -f pages=1 -f write=true  # one reading
```

**No reader shows these rows on a private vehicle yet.** The reader the properties were registered with,
`get_field_provenance`, returns a projected row only when its vehicle is public (`20261109203000`). On an owner's
private vehicle the rows land, each with its property and its photo as witness, and that reader returns none of
them, to the owner either. Opening that gate to the owner is a migration and has not been written.

Measured in production on 2026-11-11, before any run (reader: the vehicles' current `image_deep_byok` condition
rows): one vehicle has 74 such readings, each with at least one of the three values, none marked for review; the
proof vehicle has 470, of which 225 are marked `needs_clarification` and are deferred by the projection's own rule.
Neither vehicle had a row on any of the three properties.

What the lane does not do:

- No schedule. Nothing starts it but a person, one photo first.
- **No check that a statement supports the key it was given.** Code checks that the quoted words are in the
  statement, nothing more: a statement that denies a flaw can still be placed on that flaw's key and land. In the
  dry run the skeptics refuted 9 of 70 sampled states (one vehicle, 2026-11-10,
  [`image-keys-test.md`](../../../docs/ledger/theory/image-keys-test.md)). A landed row is agent testimony and its
  `limitation` says so. Closing this needs a refuting pass, or a second independent keying with only the claims
  both agree on landed; neither is built.
- No per-photo receipt yet. A photo is passed over as soon as it has one row from this lane. So a photo with
  nothing landable is taken again on a later run, and a photo that landed only some of its claims (the writer
  refused one after the re-sends, or the run was stopped between two claims) is **not** taken again. The run that
  leaves one counts it ("photos left partly landed") and exits 1; a later run cannot tell, and says only that the
  photo has a row. Keying such a photo again is not a repair: the run date and the model are in the hashed body,
  so its landed claims would land a second time. Each run prints a cursor; `--after <cursor>` moves past it.
- No place for the part. A claim lands on its condition key, and the part still rides in `structured_data`.
- No proposal and no approval. A state with no registry key is counted and left out.

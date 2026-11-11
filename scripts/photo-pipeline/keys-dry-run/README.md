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

# scripts/stacks

Local stack generator: asks the free local model (the Odysseus workspace with Qwen 3.5 9B on this Mac, no API spend) for new data stacks in the nine-layer grammar of `docs/ledger/theory/data-machine-cases.md` section 13.2, measures each proposal read-only against the live data model, and writes `~/nuke-logs/stacks/proposals/<UTC>.jsonl` and a ranked `~/nuke-logs/stacks/INDEX.md`; review by reading INDEX.md (sorted by coverage) and opening the JSONL line of any proposal worth a look, where every need carries its verdict and evidence.

```bash
dotenvx run -q -- node scripts/stacks/propose.mjs       # STACKS_N proposals (default 10) through `ody ask`; the Odysseus workspace must be running
STACKS_ASKER=auto node scripts/stacks/propose.mjs       # ody first, then the running Ollama (same model) if ody is down or answers empty; ollama alone: STACKS_ASKER=ollama
node scripts/stacks/propose.mjs --dry-run               # print the prompt it would send; asks nothing
node scripts/stacks/measure.mjs --in stacks.json        # measure hand-written or earlier proposals (JSON array or JSONL)
node scripts/stacks/check-registry-parity.mjs           # do the local verdicts equal the live stack_coverage() verdicts? (read-only)
node --test scripts/stacks/stacks.test.mjs              # offline tests, no database and no model
```

`ag.nuke.stack-generator.plist` runs it nightly at 03:30 with `STACKS_N=20`, `STACKS_ASKER=auto` and a 30 minute cap; it is not loaded by default (see the comments inside it). The registry (`stacks`, `stack_needs`, `stack_substrates`) has no runtime writer, its writer is a migration, so `--registry` writes `registry-<run>.sql` into the run folder: the INSERTs for review, never applied. Tables and columns are measured with the registry's own rules (row estimate, fill of at least 0.9, a foreign key on a key), and a stack's needs are only what it stands on, never its own fold, baseline, residual, feature or prediction.

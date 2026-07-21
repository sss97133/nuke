# foundation check

**Type:** artifact + discipline
**Extends:** `.claude/rules/library.md` (exists-but-incomplete → complete it) · `progressive-extraction`
**Instance:** `scripts/entity/foundation-check.mjs` (`npm run foundation:check`)

**A finding is not DONE when it works. It is DONE when a future agent cannot redo it by accident — when it is an executable check, a registry row, or a column, not a paragraph.** Prose gets skipped because reading ten docs costs more than re-deriving; a failing exit code does not. A foundation check is **one runnable command that exits non-zero when any known-settled fact regresses.**

## Anatomy

- **HARD assertions** — settled STRUCTURAL invariants that only a real regression can break. They exit 1. (e.g. 0 pages orphaned inside a spined issue; no cross-title story match; no schema placeholder stored as page content.)
- **REPORT assertions** — measurements that must stay VISIBLE so they are not misread, printed every run, tripping only a growth-guard, never a spurious red. (e.g. "33% of the corpus is extracted" is a SCOPE fact — the two focus titles are ~99%; a `page_type` column-vs-blob divergence count; a presence-axis inflation.)
- **Registry rows** — the baselines (`BASELINE` object) are dated facts, measured once, changed only with a reason in the diff. A live value crossing one trips a guard.
- Every assertion prints **the defect it prevents and the date it was measured**, so the next agent reads WHY, not just WHAT.

## The distinction that keeps it green-on-truth

A foundation check guards the **settled invariant**, not the **aspirational goal**. `npm run spine:validate` exits 1 today because it treats the lone un-joined publication (`lofficiel-stbarth-23`, an AMTD print master) as a hard failure — that is aspirational (join everything). `foundation:check` instead asserts "every page *inside* a spined issue resolves" and reports stbarth-23 as an exception. A check that ships already-red is noise the next agent learns to ignore; the HARD/REPORT split is how it stays trustworthy.

## Verification is part of the artifact

A check that cannot fail is theater. Prove the tripwire fires: tighten a baseline to an impossible value, confirm a non-zero exit, revert. (Done 2026-07-20: `resolved_lo_pubs_min:42` and `no_model_completed_max:0` each produced the expected HARD failure and exit 1.)

## Siblings in the L'Officiel corpus

`spine:validate` (`mag-spine-validate.mjs`) · `folio:check` / `folio:validate` (`folio-extract.mjs`, `--check` fails if a staged folio moved). All read-only, all reuse `canonOf()`/`storyFor()` from `mag-spine-join.mjs` rather than re-deriving the join.

## See also

`progressive-extraction` · `presence-axis` · TOOLS.md "L'Officiel Magazine Corpus — foundation checks".

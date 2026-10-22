# Contribution pattern: an agent finding becomes four changes on one branch

When an audit finds that data the sources contain never reaches structured fields (example: Porsche 356 chassis
numbers, Kardex/COA and body style living only in description text), the fix ships as one branch merged to main:

1. **Schema**: an additive migration for the missing fields, keys and labels (here `vehicle_identifiers`,
   `identifier_rules`, `canonical_body_styles` rows, `vehicles.is_replica` / `numbers_state`). Reuse existing stores
   (`canonical_body_styles`, `superseded_rows`) instead of parallel tables.
2. **Extractor**: change the source-to-structured transform so new rows arrive typed and quoted
   (`_shared/identifierClaims.ts` via `landIdentifierClaims`), with tests built on real listing text.
   Listing text and photo/capture reads share one rule set (`identifier_rule_for`).
3. **Backfill**: a dry-run file first (quote, source, confidence per claim), then an apply script that writes a
   pre-image to `superseded_rows` and tags every row with a `run_id`, plus a revert script for that run id.
4. **Check**: a scorecard measured against listings as ground truth (precision/recall per field), kept in the PR and
   re-run when the extractor changes.

Prod writes (migration apply, backfill) happen only after review and the owner's explicit go-ahead.

# Supabase SQL Conventions

This directory standardizes how we store and run SQL outside of migrations.

- supabase/migrations/: The authoritative schema history. Always use migrations for schema changes.
- supabase/sql/helpers/: One-off admin operations, diagnostics, and utility functions. Run intentionally.
- supabase/sql/seeds/: Seed datasets for development/testing only unless explicitly vetted.
- supabase/sql/test_*.sql: Database contracts (below).

## Database contracts

Each `test_*.sql` runs alone, as `psql -X -v ON_ERROR_STOP=1 -f <file>` from the repo root, in an empty disposable
PostgreSQL 17 database whose name starts with `dm_refinement_`. CI runs every one in the `db-contracts` job of
`.github/workflows/frontend-tests.yml`, each in a fresh database, so a new contract needs only its file, not a job.
A file that needs other setup runs in a job that names it, or is listed with its reason in
`scripts/ci/db-contracts-skip.txt`. To run them locally on a throwaway server:
`scripts/ci/run-db-contracts.sh [test_x.sql ...]`.

## Safety model

- Never run helpers on production unless a helper explicitly states it is safe.
- Seeds are dev-only by default. Assume destructive.
- Prefer migrations for any schema changes. Helpers are for maintenance, diagnostics, and operational tasks.
- Idempotency should be documented per file (safe to re-run or not).

## How to run

Choose one approach:

1) Supabase SQL Editor (recommended for remote)
- Open your Supabase project's SQL editor
- Paste the SQL from a helper file
- Execute and verify results

2) psql (local or remote)
- Requires `psql` installed and a connection string with appropriate role
- Example (dev):
  psql "$SUPABASE_DB_URL" -f supabase/sql/helpers/your_helper.sql

- Example (seed):
  psql "$SUPABASE_DB_URL" -f supabase/sql/seeds/test_sample_data.sql

3) Agent workflow (npm scripts)
- Use the npm scripts provided in `nuke_frontend/package.json`
- These scripts add guardrails and consistent entry points for automation

## Conventions

- File names are descriptive, snake_case, and include intent (e.g., `fix_remote_auth_trigger.sql`)
- Each file should start with a brief comment describing purpose, risk level, and idempotency
- Dangerous operations should require explicit confirmation variables

## When to promote to a migration

- Any change that modifies schema permanently
- Any helper that will be used more than once across environments
- Anything that must be replayable and tracked in version control history

## Environment variables

- SUPABASE_DB_URL: PostgreSQL connection string with appropriate permissions
- ALLOW_PROD=true: Explicitly allow execution against production (use with caution)
- I_KNOW_WHAT_IM_DOING=true: Required for helpers marked destructive

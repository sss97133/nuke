-- Reviewed-source candidate bundle, executable only in a disposable PG17 DB.
-- No runtime installation until the existing schema proposal is approved and
-- applied through the normal reviewed migration/deployment workflow.
\set ON_ERROR_STOP on
\i supabase/sql/harness_operating_case/recipe.sql
\i supabase/sql/harness_operating_case/compile.sql
\i supabase/sql/harness_operating_case/results.sql
\i supabase/sql/harness_operating_case/worker_lifecycle.sql
\i supabase/sql/harness_operating_case/tick_phase.sql
\i supabase/sql/harness_operating_case/worker_preparation.sql
\i supabase/sql/harness_operating_case/worker_recovery.sql
\i supabase/sql/harness_operating_case/worker_consumers.sql
\i supabase/sql/harness_operating_case/worker_callers.sql
\i supabase/sql/harness_operating_case/worker_prepared_commit.sql
\i supabase/sql/harness_operating_case/metadata.sql

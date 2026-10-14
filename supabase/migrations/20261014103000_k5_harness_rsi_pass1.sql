-- Superseded by 20261014113000_k5_harness_rsi_pass1_reissue.sql. This migration failed on apply on 2026-10-14 at 09:21Z
-- (stack_needs_substrate_fkey: an abstract need's text was not a declared substrate) and rolled back, so it never wrote
-- anything anywhere. Kept as a no-op so a replay from an earlier point does not fail here.
SELECT 1;

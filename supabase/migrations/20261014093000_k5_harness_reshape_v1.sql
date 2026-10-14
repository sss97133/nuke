-- Superseded by 20261014101500_k5_harness_reshape_v1_reissue.sql. This migration failed on apply on 2026-10-14 at
-- 08:15Z (duplicate signal key: the slug folded ETH_TX+ and ETH_TX- together) and rolled back, so it never wrote anything
-- anywhere. Kept as a no-op so a replay from an earlier point does not fail here.
SELECT 1;

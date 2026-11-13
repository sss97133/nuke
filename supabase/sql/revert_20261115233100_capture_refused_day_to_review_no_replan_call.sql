-- Revert 20261115233100. Leaves the fixed function in place: restoring the
-- 233000 body would call capture_day_replan_state and time out on the live
-- library. Drop the producer with revert_20261115233000 after all runs are reverted.
SELECT 1;

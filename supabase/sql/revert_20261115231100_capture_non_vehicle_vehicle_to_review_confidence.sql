-- Revert 20261115231100. Leaves the fixed function in place: restoring the
-- 231000 body would insert NULL into capture_set_review.confidence (NOT NULL).
-- Drop the producer with revert_20261115231000 after all runs are reverted.
SELECT 1;

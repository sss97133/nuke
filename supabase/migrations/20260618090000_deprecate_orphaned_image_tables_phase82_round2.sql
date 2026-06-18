-- Phase 8.2 subtractive cleanup (round 2) — mark remaining truly-orphaned empty image/observation tables DEPRECATED.
-- Adversarial re-verification 2026-06-18: each table below was confirmed at execution time to have
--   n_live_tup=0 AND n_tup_ins=0 (zero rows AND zero inserts EVER, per pg_stat_user_tables)
--   AND zero code references in scripts/ + supabase/functions/ + nuke_frontend/src (broad grep, no word boundary).
-- This corrects the 2026-06-17 round-1 migration, which deprecated only 5 tables and left these live on the
-- claim that they were "accumulating rows mid-audit" (e.g. image_camera_position "~692K"). That claim is FALSE
-- at this date: image_camera_position and all peers below show n_tup_ins=0 — no writer has ever touched them.
-- Marked via the existing COMMENT convention, NOT dropped — DROP needs owner sign-off (destructive op).
-- None of these are on the protected testimony DELETE-list (agent-trust-invariants.md rule #1).
comment on table auction_image_backfill_status is 'DEPRECATED 2026-06-18: empty, zero code refs (Phase 8.2). DROP after owner signoff.';
comment on table auction_listing_images is 'DEPRECATED 2026-06-18: empty, zero code refs (Phase 8.2). DROP after owner signoff.';
comment on table image_camera_position is 'DEPRECATED 2026-06-18: empty, zero code refs (Phase 8.2). DROP after owner signoff.';
comment on table image_coordinate_observations is 'DEPRECATED 2026-06-18: empty, zero code refs (Phase 8.2). DROP after owner signoff.';
comment on table image_forensic_metadata is 'DEPRECATED 2026-06-18: empty, zero code refs (Phase 8.2). DROP after owner signoff.';
comment on table image_pose_observations is 'DEPRECATED 2026-06-18: empty, zero code refs (Phase 8.2). DROP after owner signoff.';
comment on table image_question_answers is 'DEPRECATED 2026-06-18: empty, zero code refs (Phase 8.2). DROP after owner signoff.';
comment on table image_vehicle_mismatches is 'DEPRECATED 2026-06-18: empty, zero code refs (Phase 8.2). DROP after owner signoff.';
comment on table observation_half_lives is 'DEPRECATED 2026-06-18: empty, zero code refs (Phase 8.2). DROP after owner signoff.';
comment on table patient_zero_image_pool is 'DEPRECATED 2026-06-18: empty, zero code refs (Phase 8.2). DROP after owner signoff.';
comment on table photo_inbox is 'DEPRECATED 2026-06-18: empty, zero code refs (Phase 8.2). DROP after owner signoff.';
comment on table photo_work_clusters is 'DEPRECATED 2026-06-18: empty, zero code refs (Phase 8.2). DROP after owner signoff.';

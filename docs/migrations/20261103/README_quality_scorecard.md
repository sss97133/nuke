Scorecard + fixes (2026-11-03). Apply order: 210000 scorecard_v1, 210100 timeout, 210200 scorecard_v2, 210300 fix functions + synth patch, 210400 timeouts, 210500 review_resolve_v2 (batch cap), 210600 hourly cron.
Runs: before 94bf5d1f-a09c-4937-abc7-987589e0346d | after eca93255-d64c-4dcb-9960-edd766f35bf2.
Fix runs (revert with select profile_fix_revert('<run>')): ...0004 photo approvals (+refresh_derived), ...0005 min-evidence, ...0006 junk values/evidence.
Backups: backup_20261103_pq_vehicles, _pq_images_rn, _pq_fn_defs (old synthesize_profile_from_vision).

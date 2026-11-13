# Visual verification is a hard pre-step (since 2026-11-03)

Any run that files or repoints photos (capture_sets_apply / capture_sets_landing_run apply mode / _pf_update on vehicle_images.vehicle_id)
is BLOCKED by trigger trg_filing_gate unless filing_run_gate.passed = true for that run id.

Procedure for every landing / repoint run:
1. Dry run -> proposed items [{image_id, vehicle_id}].
2. select filing_gate_enqueue('<run>', '<items json>');   -- queues min(10, n) random items (source='pre_gate')
3. Look at every queued image with vision against the target vehicle; set auto_filing_audit_queue.status = correct|wrong|unclear (+reason).
4. select filing_gate_eval('<run>');   -- passes only if all required verified, at least one correct/wrong, wrong/(correct+wrong) <= 5%
5. Apply with the SAME run id. If eval fails: ABORT, do not apply; fix scorer/inputs, new run id.
Unfiling (vehicle_id -> null) and profile_fix_revert are not gated.
Note: with n=10, one wrong sample = 10% -> abort.
Daily: auto_filing_audit_daily samples 10/run/vehicle of the last day's filings into the same queue for post-hoc checks.

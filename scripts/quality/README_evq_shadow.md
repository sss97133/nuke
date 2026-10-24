# Evidence-weighted shadow quality score (v1, 2026-10-24)
Shadow only: `vehicle_evq_shadow` + `compute_vehicle_evq_shadow(uuid)`; live `data_quality_score`/`quality_grade` untouched.
Note: a separate pre-existing view `vehicle_quality_shadow` (shadow_quality_weights) exists; this is distinct.

score = 100 * Σ w_t * trust_t * (1 - exp(-eff_n_t / sat_t)) / Σ w_t (applicable), eff_n = Σ 0.5^(age/half_life).
Trust/decay per source type with citations: `vehicle_evidence_source_types`. Estimates have weight 0.

Run batches: `select vehicle_evq_shadow_refresh(array(select id from vehicles tablesample bernoulli(0.04) limit 450),'<run_id>');` (~35s/500)
Test: scripts/quality/evq_shadow_test_rollback.sql (begin…rollback). Revert: supabase/rollbacks/20261026230000_vehicle_evq_shadow_v1_down.sql (renames tables to retired_*).

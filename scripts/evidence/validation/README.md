# Evidence validation artifacts (2026-10-23)
- recall_v2/: blind recall sample (n=50 whole descriptions, seed in draw.json), frozen labels (FROZEN.sha256), score.py. -> evidence_field_validations ids 17-22 (metric=recall, never pass).
- mileage_xcheck/: INDEPENDENT cross-check of graded-v2 BaT mileage vs other-platform listings (Mecum odometer, PCarMarket text). Rule pre-registered in RULE.md. 383/409 = 0.936 -> validation id 23 (passed). Gates graded-v2 mileage fill run ee6d30a3-1601-4e10-b883-92089e6d7fa3 (revert: supabase/sql/evidence_runs/revert_graded_v2_mileage_fill.sql).
- No independent source at n>=200 found for condition_grade, repaint, ownership_duration, documented_work, numbers_matching (see notes).
- ../aed_rundate/: Barrett-Jackson / Mecum per-lot run_date fetchers (auction_end_date backfill v3; revert in supabase/sql/evidence_runs/).

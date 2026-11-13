Phase 2 proposed migrations (already applied to prod via Supabase apply_migration as the listed names; NOT committed to git).
Run ids (profile_fix_revert(run_id) undoes data changes): c0de2026-1103-4000-8000-000000000001 (Mustang), ...0002 (Firebird).
Backups: backup_20261103_pf_* tables, /workspace/backups/backup_20261103_*.sql
Note: m2b/m1 files contain the final (fixed) function bodies; prod got them via m2a/m2c CREATE OR REPLACE.


## Visual gate (2026-11-03)
See README_visual_gate.md: every apply run must pass filing_gate_eval first; enforced by trigger trg_filing_gate.

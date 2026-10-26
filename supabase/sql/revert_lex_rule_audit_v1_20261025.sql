-- Revert: lex rule audit retirement (2026-10-25). Un-retires the 25,421 identity_lex_v1_backlog_20261025
-- rows retired by rule class (T_emb, T_num, T_make, T_word_panel/semi/dump, M_neon/display/toy/bench/cabinet/carousel/cooler/globe).
-- Optional rule filter: add  and t = 'retired:lex_rule_audit_v1_20261025:T_num'  to revert one class only.
-- No COMMIT: run inside your own transaction.
set local statement_timeout = '55s';
update vehicle_identity_evidence e
   set retired_at = null,
       issues = array(select t from unnest(e.issues) t where t not like 'retired:lex_rule_audit_v1_20261025:%')
 where e.run_id = 'identity_lex_v1_backlog_20261025'
   and e.retired_at is not null
   and exists (select 1 from unnest(e.issues) t where t like 'retired:lex_rule_audit_v1_20261025:%');
insert into vehicle_category_change_log(run_id, phase, counts)
select 'lex_rule_audit_v1_20261025', 'revert',
       jsonb_build_object('active_backlog', count(*)) from vehicle_identity_evidence
 where run_id = 'identity_lex_v1_backlog_20261025' and retired_at is null;

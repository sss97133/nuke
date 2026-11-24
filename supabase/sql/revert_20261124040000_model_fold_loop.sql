-- Revert 20261124040000_model_fold_loop.
-- Stops and removes the loop. Folds already made stay (they are ordinary run-stamped producer output); to undo them too,
-- first run: SELECT public.model_fold_revert_since('<first tick time>');  (newest ticks first, loop disabled).
begin;
set local lock_timeout = '3s';
do $$ begin
  if to_regnamespace('cron') is not null then
    perform cron.unschedule(jobid) from cron.job where jobname in ('model-fold-tick','model-fold-watch');
  end if;
end $$;
drop trigger if exists model_fold_signal_ins on public.vehicles;
drop trigger if exists model_fold_signal_upd on public.vehicles;
drop trigger if exists model_fold_signal_ins on public.auction_comments;
drop trigger if exists model_fold_signal_upd on public.auction_comments;
drop trigger if exists model_fold_signal_del on public.auction_comments;
drop trigger if exists model_fold_signal_ins on public.auction_events;
drop trigger if exists model_fold_signal_upd on public.auction_events;
drop trigger if exists model_fold_signal_ins on public.vehicle_observations;
drop trigger if exists model_fold_signal_upd on public.vehicle_observations;
drop trigger if exists model_fold_signal_upd on public.field_evidence;
drop trigger if exists model_fold_signal_ins on public.field_evidence;
drop trigger if exists a09_model_fold_signal on public.vehicle_images;
drop view if exists public.model_fold_freshness;
drop procedure if exists public.model_fold_tick();
drop function if exists public.assay_model_fold();
drop function if exists public.model_fold_revert_since(timestamptz);
drop function if exists public.model_fold_revert_v1(uuid);
drop function if exists public.model_fold_backpressure(jsonb);
drop function if exists public.model_fold_one(uuid, uuid, jsonb, uuid[]);
drop function if exists public.model_fold_invalidate_readings(uuid, uuid[]);
drop function if exists public.model_fold_sweep(text, jsonb);
drop function if exists public.model_fold_absorb_signals(integer);
drop function if exists public.model_fold_logic_key();
drop function if exists public.model_fold_image_signal();
drop function if exists public.model_fold_origin_update_signal();
drop function if exists public.model_fold_rows_signal();
drop function if exists public.model_fold_vehicles_signal();
drop function if exists public.model_fold_signal_ids(uuid[], text);
drop function if exists public.model_fold_in_scope(text, text, text, integer, uuid);
drop function if exists public.model_fold_signals_on();
drop function if exists public.model_fold_scope_make(text);
drop function if exists public.model_fold_scope_of(text, text, text, integer);
drop function if exists public.model_fold_config();
drop table if exists public.model_fold_tick_runs, public.model_fold_ticks, public.model_fold_cursor,
  public.model_fold_scope_members, public.model_fold_work, public.model_fold_signal;
delete from public.platform_config where config_key = 'model_fold';
commit;

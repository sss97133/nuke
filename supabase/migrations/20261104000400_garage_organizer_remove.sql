-- Removes the parallel garage organizer (no filings were ever applied; profile_fix_log has 0 garage_org rows).
drop function if exists public.garage_org_run_v1(uuid,boolean,int);
drop function if exists public.garage_org_propose_v1(uuid,uuid);
drop function if exists public.garage_org_apply_v1(uuid,uuid,numeric,numeric,numeric,int,boolean);
drop function if exists public.garage_org_backtest_v1(uuid,uuid);
drop function if exists public.garage_org_visual_v1(uuid,uuid);
drop function if exists public.garage_org_score_v1(uuid,uuid,text);
drop function if exists public.garage_org_stage_v1(uuid);
drop function if exists public._go_vf(jsonb,text);
drop function if exists public._go_n(text);
drop table if exists public.garage_org_image_backup, public.garage_org_proposal, public.garage_org_score,
  public.garage_org_photo, public.garage_org_vehicle, public.garage_org_run;

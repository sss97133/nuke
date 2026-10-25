-- Retire-only revert for one page-evidence run. Set :run, review counts, then COMMIT by hand.
begin;
-- rows inserted by the run
update public.listing_page_photo_evidence set retired_at = now(), retired_reason = 'revert', retired_run_id = :'run'
 where run_id = :'run' and retired_at is null;
-- fields filled on earlier rows: restore the empty value, keep an audit trail
update public.listing_page_photo_evidence set
    page_end_at = case when 'page_end_at' = any(filled_fields) then null else page_end_at end,
    gallery_keys = case when 'gallery_keys' = any(filled_fields) then '{}' else gallery_keys end,
    outcome = case when 'outcome' = any(filled_fields) then null else outcome end,
    outcome_amount = case when 'outcome' = any(filled_fields) then null else outcome_amount end,
    outcome_quote = case when 'outcome' = any(filled_fields) then null else outcome_quote end,
    retired_reason = coalesce(retired_reason, '') || ' fill reverted ' || :'run', fill_run_id = null, filled_fields = null
 where fill_run_id = :'run';
-- typed outcomes staged from it: select public.revert_sale_outcome_sweep_v1('<sale outcome run>');
-- no COMMIT here

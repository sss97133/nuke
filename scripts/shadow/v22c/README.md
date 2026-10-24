# v22: condition claims split by source (description / seller comment / commenter)

- Extractor: `mine_bat_text_claims(..., include_comments=true)` over 49,761 training-era BaT vehicles.
  - Run `7e1d0c24-2026-4a10-9e00-0000000c2201`, 332 calls, 488,290 claims, $0 (SQL regex).
  - Logged in `evidence_extractor_runs` with revert SQL: `UPDATE public.evidence_claims SET status='superseded' WHERE run_id='7e1d0c24-2026-4a10-9e00-0000000c2201';`
- Features (`feat22.py`): 9 condition columns, {description, seller_comment, commenter} x {pos, neg, hedge}, all pre-close. Comment claims come only from runs c2201 and c2301.
- Selection (`sel22.py`): forward rolling-origin on training rows only, same rule as v21. Pick: G3_seller + G1d_cond_desc. All comment-sourced groups were rejected.
- Gate: identical to v21 on all 4 splits, passes.
- Fresh hold-out (`reportH22.py`): beats v13b but not v21, so it was not registered.

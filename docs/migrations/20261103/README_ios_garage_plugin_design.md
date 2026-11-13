# iOS photos -> ONE garage (design, no parallel structures)
Removed: garage_org_* tables/functions (migration 20261104000400). 0 filings applied, 0 crons left.
Backtest kept (run 9a7a0000-...0001): 11,559 confirmed photos; session(20min/300m)+classifier+cell signals:
 score>=2.5 & margin>=1 -> precision 0.994 recall 0.669; photos with no session signal: top-1 only 13%.
Plug-in point: ingest_image_observation(role='subject') -> trg enqueue_vehicle_image_attribution (>=0.85)
 -> vehicle_image_attribution_queue -> cron derive-vehicle-image-attribution (*/5) -> derive_vehicle_image_attribution.
Session filing: capture_sets_build -> record_capture_set_candidates -> capture_sets_apply (p_min_conf>=0.5) /
 capture_set_review; owner confirm: attribute_image_session. Revert: capture_sets_revert / capture_set_*_revert.
See final report for ranked changes.

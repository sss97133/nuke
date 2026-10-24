# evq shadow v2 + calibration (2026-10-24)
- Wiring fix: odometer now reads auction_event_listing_mileage (~252k cited) via auction_events.vehicle_id. Receipts 0 is real (327 receipts with a vehicle, 22 vehicles).
- As-of evidence: vehicle_evq_components_v2(v, sale_date) excludes events/odometer after the sale; listing-content sources are not time-filterable (ingestion timestamps).
- Calibration: fit weight + saturation per type (trust/half-life stay cited priors, L2 prior on log ratios) so score predicts v21 forward OOS |log err|.
  Sample: vehicle_evq_calib_sample (run evq_calib_sample_v2_20261024), 5,100 vehicles, 1,700/fold (2024H2, 2025H1, 2025H2+); rows from /workspace/v21 pred_v21_<cut>.npz.
  Rolling origin: fit fold<k, test fold k. Prior strength chosen on fold 1 only; fold 2 is the clean test.
- Stored: vehicle_evq_calibration run evq_calib_v2_20261024 (evq_calib_v2_20261024_insert.sql). Revert data: rename via supabase/rollbacks/20261026233000_vehicle_evq_shadow_v2_down.sql.
- Run: python3 evq_calibrate_sweep.py (needs comps.json, calib_rows.json, priors.json), ~4 s, <300 MB.

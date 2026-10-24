# houselot v15 / v16 (2026-10-24)

**v15**: runs the v7 matcher (h01–h18, engine rule, same_lot guard, ECB sale-date FX within 7 days for non-USD) on the 666 events routed in v13, against houses with held lot data (mecum, rm, bonhams, gooding, gaa).
- Attached 6 (all Mecum): F106, F163, S155.1, S58, S98.1, S93.
- Held: h00 no lot data 320, h01 277, h02 24, h03 5, h07 3, h08 1, h13 5, h15 25.
- GAA lots have no sale dates, so there are 0 usable rows.
- Backup: backup_agg_houselot_v15_20261024. Revert with revert_v15.sql.

**v16**: covers the 9 B-J "gap" events. All three sales (scottsdale-2014, palm-beach-2004, petersen-museum-2004) were already in bj_results_stage_v1_20261024. The gap came from the v10 sale windows, so matching now uses the sale slug cited on the conceptcarz page.
- 6 have a lot and 3 have none.
- The v9 VIN gate attached 0: no lot VIN matches a live, pre-run vehicle. The Firebird VIN's only match has status=duplicate.
- No vehicles were created. The scripts are idempotent; revert with revert_v16.sql.

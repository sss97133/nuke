Run agg_houselot_v8_20261024 (2026-10-24): 2,236 flagged conceptcarz events with no B-J match in the snapshot, rematched against live B-J sold
events (bjlive.sql -> agg_houselot_v1_20261024_bjlive, 55,034 rows; no B-J event was created after 2026-10-22, so the windows are still largely not ingested).
cand8_build.sql.tmpl (`:B` = first hex digit) -> agg_houselot_v1_20261024_cand8: 16 unique under both rules.
Applied 3 (3 moved, 1 untrusted mark). Held: 10 price >20% apart in USD, 2 target vehicle deleted/merged, 1 target vehicle row missing.
A B-J source_listing_id holding a URL is not used as a lot; the cited lot_number is. Revert: revert_agg_houselot_v8_20261024.sql.
2026-10-24 08:50 PT: Road Runner f21bc105 (cc "Road Runner Coupe" vs lot "Hemi Road Runner") restored from backup (revert script scoped to that
event; mark retired). The apply script now requires identical engine words (hemi, sohc, dohc, boss, supercharged, NNN ci, N.Nl) on both sides.
Net v8: 2 attached.

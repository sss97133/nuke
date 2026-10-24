# v16 (shadow, NOT registered)
Each target's mileage comes from its own sale event (`rows_v16.json` carries `a` = auction_event_id). There is no ±3-day window.
- Dump: `dump_events_v16.sql`, 16 vehicle-id chunks → `mkev.py`. 539,205 dated events, 220,921 with own mileage.
- `maprows.py` uses a rule fixed before any results were seen: same vehicle, then the event on the row's sale day, else hammer within 1% within 14 days, else the nearest event within 3 days. Results: 50,119 day / 7 price14 / 4 near3 / 2,695 unmapped.
- TMISS 2,414 (v15 2,172). The window had been borrowing readings from neighbouring sales of the same car.
- Selection used the pre-registered rule (`sel_v16.json`, `sel.log`) and picked no-family (fwd L2 .4071 vs s0.5_swap .4114).
- Eval, all-level, v16 vs v13b: random .2592 vs .2577; fwd 2024-07 .2705 vs .2683; 2025-01 .2917 vs .2865; 2025-07 .2505 vs .2434.
- v16 lost on all 4 splits, so it is not registered and no shadow rows were written.

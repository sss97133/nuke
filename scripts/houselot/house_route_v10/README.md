# House routing v10 (run agg_houseroute_v10_20261024) + engine rule v2

## Routing the 1,299 "no B-J auction in window" events
Each conceptcarz event URL carries the conceptcarz auction id (`conceptcarz://event/<id>/...`); one id = one auction.
Rule (`route_cand.sql`): route an event to house H only when ≥2 sibling sales from the same conceptcarz auction are already
attached `same_lot` to H lots (each with a cited lot URL), every cited lot is dated inside the event's sale window, no sibling
cites another house, and the B-J results API shows no B-J auction in that window. Otherwise hold.
`apply_route_v10.sql` relabels `source_platform` and writes `metadata.house_route` (rule + 3 cited lot URLs). No vehicle changes.
Result: 425 routed (mecum 394, rm-sothebys 28, bonhams 3); held 846 no cited sibling, 28 only one cited sibling.
Revert: `revert_route_v10.sql` (backup `backup_agg_houseroute_v10_20261024`). Rolled-back test: 425 → 0.

## Engine rule v2
An engine word present on only one side is a conflict only if that engine was one of several options for the model/year.
Not a conflict when (a) the cited house lot page states the same engine, or (b) a cited source shows it was the model-year's only engine.
Uncited → hold. Re-check of the 4 v7 attaches (all kept):
| event | cc words | evidence |
|---|---|---|
| 02438677 2011 Infiniti G37 conv. | 3.7L | only engine for G37/370GT, all VQ37VHR 3.7L https://en.wikipedia.org/wiki/Nissan_Skyline_(V36); lot page engine "3.7L" https://www.mecum.com/lots/180679/2011-infiniti-g37-convertible/ |
| 86f1ad49 2002 Jaguar Vanden Plas | 4.0L | US cars were 4.0L only (3.2L elsewhere) https://en.wikipedia.org/wiki/Jaguar_XJ_(X308); lot page "4.0L" https://www.mecum.com/lots/124878/2002-jaguar-vanden-plas/ |
| 1ecf95fd 1981 Pontiac Trans Am | 301 CI | options 301/301T/305 → would conflict, but lot page engine "301 CI" https://www.mecum.com/lots/152901/1981-pontiac-trans-am/ |
| f8f587d4 1964 Chrysler Newport | 361 CI | options 361/383 → would conflict, but lot page engine "361 CI" https://www.mecum.com/lots/152589/1964-chrysler-newport/ |

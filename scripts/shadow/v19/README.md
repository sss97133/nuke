# v19: per-level blend of v13b and v18 (NOT registered); v13b registered

Fallback levels: L0 = model, L1 = family, L2 = same make and decade. v19 log-blends the v18 prediction (gross) with
v13b's (hammer, converted to gross with the BaT fee): `s = v18^w * v13b^(1-w)`. The weight w is set separately for
L0, L1 and L2, and rows with no v13b prediction (Mecum or new) use v18 alone.

Both models were refit at each forward cut on training rows only (sale date before the cut, f5!=0) by
`sel19_v13b.py` (run in v17/) and `sel19_v18.py`. `sel19.py` picks w from {0,.25,.5,.75,1} with the pre-set rule:
lowest mean forward median abs % error per level, ties going to the smaller w.

Picked v18 weights: **L0 .25, L1 .75, L2 .5**. L2 validation has only 108–143 rows per cut, and the L2 means differ
by less than .001 between w=.5 and w=1, which is the instability.

## Gate (old test set, 100% coverage)
| split | v19 gross | v13b gross | v19 hammer-eq | v13b registered | result |
|---|---|---|---|---|---|
| random | .2550 | .2579 | .2553 | .2577 | win |
| fwd 2024-07 | .2653 | .2669 | .2663 | .2683 | win |
| fwd 2025-01 | .2787 | .2844 | .2802 | .2865 | win |
| fwd 2025-07 | .2448 | .2436 | .2444 | .2434 | **lose** |

v19 is not registered. v13b had never been registered (it was waiting on the odometer scrape), so it is now
registered as `shadow-v13b-pit-family`: one registry row (`reg_v13b.sql`), no estimate rows, nothing live.
Revert with `revert_reg_v13b.sql`.

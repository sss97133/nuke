# v21 fresh hold-out re-score with claims extracted (shadow only)
- Extractor: existing `public.mine_bat_text_claims(uuid[], uuid, true)` (SQL patterns; no paid API), run `7e1d0c24-2026-4a10-9e00-0000000c2301`, 125 calls x 150 vehicles over the 18,603 fresh BaT vehicles (sales 2026-05-01..2026-10-23). 155,518 claims.
- Pre-close only: feat21.py keeps comment claims linked to a non-bid comment posted strictly before the sale day, and description claims dated on/before it; price/sale/reserve quotes dropped.
- Training-row features frozen to the earlier fit (225 earlier sales of the same vehicles would otherwise change); only fresh rows changed.
- Then `evalH.py v21base nofam claims` (same refit on <2026-05-01, no tuning) and `reportH.py`; v13b predictions reused (it uses no claims).
- Revert: `UPDATE public.evidence_claims SET status='superseded' WHERE run_id='7e1d0c24-2026-4a10-9e00-0000000c2301';`

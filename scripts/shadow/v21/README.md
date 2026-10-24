# shadow v21: v20 + pre-close claim features (registered shadow-only)

Inputs (BaT only; Mecum rows are NaN):
- evidence_claims listing_description claims (stamped on the sale day, written before bidding), plus seller/commenter claims linked to a non-bid comment posted strictly before the sale day. Claims whose quote matches the price/sale/reserve regex are dropped (6,881), plus 1 whose text contains the hammer digits by coincidence.
- auction_comments seller comments: is_seller, not a bid, bid_amount null, posted_at < auction_end_date, no price/sale/reserve text. answers = those with '@'.
- No comment_discoveries, no bids, no post-close text. `test_leak21.py` asserts this; the DB checks it records are in leak21.json.

Selection (sel21.py): rolling-origin on training rows only (f5!=0, sale < 2024-07-01). Greedy over groups. Picked G3 seller + G1 condition (mean val MdAPE .2647 -> .2581).
Gate (eval21.py + eval21b.py, frozen v19 weights): see eval_v21_blend.json. Registration: reg_v21.sql (revert_reg_v21.sql).
Run: python3 feat21.py; python3 test_leak21.py; bash guard.sh python3 sel21.py; bash guard.sh python3 eval21.py v21 nofam; python3 eval21b.py (in a dir holding the v20 inputs).

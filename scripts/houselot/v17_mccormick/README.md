# houselot v17: McCormick matcher (2026-10-24)

- **Fee conversion:** McCormick's cited buyer fee from each Auction-N page (5% for auctions 47–66, 6% for 67–79) converts gross to net in `price_net_usd`, with `fee_source_url` on each row. Auctions 48, 62, 76 and 80 cite no fee, so they are held as h14.
- **55 held McCormick events:** h01 no lot 18, h02 >1 lot 18, h14 no cited fee 1, h08 identity not confirmed 18. Attached: 0.
  - h08 applies because McCormick results (list and lot detail) carry no VIN, and no vehicle has a McCormick house event, so no target identity can be confirmed.
- **Other McCormick events:** 51 more conceptcarz events (48 flagged). 10 have a single lot and 2 have a single exact-price lot, all held at h08. Exact-VIN sale history: 0, because the source has no VINs.
- **No writes:** no vehicles or events were written. Revert with revert17.sql (retires the gate table and nulls the fee columns).

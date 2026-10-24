# McCormick Palm Springs results staging (mccormick_results_v1_20261024)
Source: the cited per-auction results pages at https://www.classic-carauction.com/auction-results?auctionnbr=N (auctions 47–80, Nov 2009 through Feb 2026). Each row stores its source_url.
- Staged: 11,859 lots in public.mccormick_results_stage_v1_20261024, of which 6,565 sold.
- Prices include the 5–6% buyer fee. For no-sale lots, the price is the high bid.
- sale_month: odd auction numbers are November sales and even numbers are February. Where the Auction-N page states the sale dates, they are cited in sale_dates_text.
- Staging only: no vehicles or events were created. Revert with revert.sql (drop table).

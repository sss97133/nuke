-- Bonhams joins the live auctions board: its reader now writes only lots that carry a live bid.
--
-- sync-live-auctions (sync-live-auctions-houses, every five minutes) classifies each open Bonhams motoring sale from the
-- house's own index: an online sale with bidding open (Typesense auctionType ONLINE, biddingStatus IP; the bidding
-- platform's sale type 'timed') is live-bid, and each of its lots' leading bid, bid count and own close (moved later by
-- every extension) is read from the bidding platform (live.bonhams.com, the call the lot page's bid box makes). Only
-- those lots are written auction_live. Lots of in-room catalog sales (auctionType PUBLIC; platform sale type 'live')
-- have estimates and a sale date only: they are written 'upcoming' and never reach the board (they stay on the auction
-- calendar, which reads vehicle_events). A Bonhams lot on the board is therefore biddable now; one with no bid yet shows
-- no current bid (its opening bid is kept in origin_metadata, not presented as a bid).
-- Measured 2026-10-20 ~19:45Z: four open motoring sales, none online with bidding open (31858 in-room, 22 car lots, all
-- GBP; 32555 and 32784 in-room; 32060 Motorcycles Online opens 2026-12-04). The same reader against the one online
-- sale open that day (31998, silver) read 321 open lots, 170 with a bid, 321 distinct closes.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

INSERT INTO public.live_board_houses (house, label, host_pattern, enabled, note)
VALUES ('bonhams', 'Bonhams', '^https?://([a-z0-9-]+\.)*bonhams\.com/', true,
        'sync-live-auctions-houses, every five minutes: online sales with bidding open, bids from live.bonhams.com; '
        'in-room catalog lots are written upcoming, never live')
ON CONFLICT (house) DO UPDATE SET enabled = true, note = excluded.note;

COMMIT;

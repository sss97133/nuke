# Browse — Make → Model → Vehicles Explorer

## Purpose
Alternative to the feed for people who want to explore by taxonomy. Not a search, not a feed — a directory. Like browsing folders on a hard drive.

## Layout

### Level 0: All Makes (`/browse`)

```
┌─────────────────────────────────────────────────────────┐
│ [search filter...]                                      │
│                                                         │
│ ALL MAKES                                               │
│                                                         │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│ │ [C]      │ │ [P]      │ │ [F]      │ │ [B]      │   │
│ │CHEVROLET │ │ PORSCHE  │ │   FORD   │ │   BMW    │   │
│ │ 41,283   │ │  39,043  │ │  22,127  │ │  19,801  │   │
│ │ $38K med │ │  $52K med│ │  $28K med│ │  $31K med│   │
│ │Corvette  │ │ 911      │ │ Mustang  │ │ 3 Series │   │
│ │C10, Camaro│ │Cayenne  │ │ Bronco   │ │ M3       │   │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘   │
│ ... (4-6 columns, sorted by vehicle count)              │
└─────────────────────────────────────────────────────────┘
```

- Searchable filter at top
- Each cell: initial square, make name, count, median price, top 3 models
- Click → drills to Level 1

### Level 1: Models for a Make (`/browse?make=Porsche`)

```
┌─────────────────────────────────────────────────────────┐
│ ALL MAKES / PORSCHE                                     │
│                                                         │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│ │   911    │ │ CAYENNE  │ │ BOXSTER  │ │ CAYMAN   │   │
│ │  8,412   │ │  3,201   │ │  2,876   │ │  1,930   │   │
│ │$52K-$3.5M│ │$18K-$180K│ │$12K-$95K │ │$22K-$120K│   │
│ │ 78% sold │ │ 62% sold │ │ 71% sold │ │ 68% sold │   │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘   │
└─────────────────────────────────────────────────────────┘
```

- Breadcrumb: ALL MAKES / PORSCHE
- Each cell: model name, count, price range, sold ratio
- Click → Level 2 (filtered feed)

### Level 2: Vehicles (`/browse?make=Porsche&model=911`)

- Breadcrumb: ALL MAKES / PORSCHE / 911
- Infinite scroll vehicle grid (same as feed cards)
- Sort options: price, year, recent

### Source level (`/browse?source=<slug>`)

The Sources board's "Browse vehicles" link (`/browse?source=ebay_motors`, for one) opens that source's own holdings, not the all-sources sold-make grid above. `BrowseVehicles` reads the `source` parameter (a blank one is no source); when it is present `pages/browse/SourceBrowse.tsx` renders the three levels below, and without it the page is unchanged. `make` and `model` still deepen the path (`&make=Porsche`, `&make=Porsche&model=911`); the year, body style and era filters belong to the all-sources page and are ignored here. Only a market source has this page: an auction house, dealer, classifieds site, marketplace or aggregator.

```
┌──────────────────────────────────────────────────────────────────┐
│ [mark] Source name                                 LISTINGS HELD │
│ Category                                                   7,896 │
│                                                    counted <day> │
│   of <N> the source lists · how counted · 98% confidence · <day> │
│     (an estimate reads: an estimate of <N> (…, not a count) · …) │
│                    (no total on the board: source total unknown) │
│      Sources board counts <N> matched to Nuke's own list · <day> │
│      <N> listings recorded from this source in the last 24 hours │
├──────────────────────────────────────────────────────────────────┤
│ SOURCES / SOURCE / MAKE / MODEL          n of N listings · day * │
├──────────────────────────────────────────────────────────────────┤
│ WHAT THIS SOURCE CARRIES (makes level only)                      │
│ SOLD · LIVE AT LAST CHECK · UPCOMING · ENDED                     │
│ STATUS NOT RECORDED · WITH PHOTOS · MAKES · MODELS               │
│ (status blocks and With photos: "n of N listings · day")         │
│ Listings dated 2005–2026 · model years … · N of M listings read  │
│ from saved copies of the source's pages · first recorded … ·     │
│ last recorded …                                                  │
├──────────────────────────────────────────────────────────────────┤
│ MAKES | <MAKE> MODELS | <MAKE> <MODEL>                count line │
│ [filter, or sort]                                                │
│ grid of cells (makes, models) or cards (listings)                │
│ card: photo · year make model · price line · status · place      │
│       Listed / Starts / First recorded · Ends / Ended            │
│       Open the saved page | Open the listing                     │
└──────────────────────────────────────────────────────────────────┘
```

\* The trail carries "n of N listings · day" from the models level down. At the makes level everything the source holds is in scope, so the only fraction would be n of n, which says nothing, and the trail stands without one.

**The masthead says what the page counts, and when.**

- **A counted source** (`status` ok, `holdings.episodes` above zero): "listings held" (lots, vehicles or posts for the species; an aggregator says the registry's own unit, "pages read, not listings held", and counts pages), the figure, and "counted <day>", the day of the daily count ("count date unknown" when the reader sends none). Under it, one caption for the source's own total, the number the Sources board holds with how it was measured, how sure that is and when, each part left out when unknown.
  - A count reads "of N the source lists · counted from its own listings · 98% confidence · <day>". The method is said in plain words (counted from its own listings, from its search results, from its sitemap, from the total it reports, or counted from its sale catalogues and broadcasts); the method's own name is never printed.
  - An estimate says so, and that it is not a count: "an estimate of N (a reference figure, not a count) · 40% confidence · <day>" (also: from its catalogue, an earlier figure, within a range, extrapolated from its recent listings, modeled from its live listings or from how fast Nuke records them).
  - A method this page has no words for, or none, is not printed, and its total is not worded as a count: "a total of N, unknown whether counted or estimated". With no total on the board it reads "source total unknown".
  - A percent is the confidence in the total and always carries the word. It is never the share of the source's listings that Nuke holds, which the page does not state as a percent anywhere.
  - When the Sources board has a count for the source, one more caption: "Sources board counts N listings matched to Nuke's own list · <day>" (in the species' noun), with a hover that says the board counts the source's lots matched to Nuke's collection list while this page counts every listing the source put on a public vehicle with a make and a model. The two are shown side by side and never as one number.
  - Last, the live count: "N listings recorded from this source in the last 24 hours, whether or not they are counted above". It counts every row Nuke recorded from the source in the last 24 hours, on a public vehicle with a make and a model or not, so it is a count of its own and is never worded as a part of the figure above it (it can be larger than that figure).
- **Only the Sources board knows it** (`status` ok, `holdings.episodes` 0, `holdings.board` present): the figure is the board's, labelled "listings on the Sources board" (in the species' noun) and captioned "board count · <day>", with the same source-total caption, and the line "No listing recorded under this name is on a public vehicle with a make and a model, so there is nothing to browse here." The line says only what the read knows: a cohort of one venue's lots, or a dealer whose lots the registry keys to a venue, can have those lots on public vehicles under the venue's name. No makes are listed.
- **Registered, nothing yet, no board count**: the figure 0 and "No vehicles are recorded for this source yet."
- **Not counted yet** (`not_folded`, the first deploy): the identity and "Nuke has not counted this source's listings yet. It counts once a day." No clock time, no figure.
- **Not a market source** (`unknown_source`: unregistered, an owner's private source, a media source, one with no species): "Nothing to browse", "Only market sources have a browse page: auction houses, dealers, classifieds, marketplaces and aggregators. Nothing is published under <slug>.", and a link to `/sources`. Nothing else about the slug is named.
- **While reading**: "Reading…", or "Reading <name>…" once an earlier read named the source; never the slug from the address bar.

**The levels.**

- **Makes** (`?source=<slug>`): every make the source holds, most first. "What this source carries" shows a block each for Sold, Live at last check, Upcoming, Ended and Status not recorded (only when above zero, each "n of N listings · <day>"), With photos ("n of the vehicles · <day>"), Makes and Models. The day is the day of the daily count the block was read from, so "Live at last check" is live as of that day's count, and a listing the source called live that has no end clock only as of the last time Nuke wrote its row; the cards at the listings level work their status out when they are read, so a card can have moved on since. Then one history line, each part only when known: "Listings dated 2005–2026" (the years of the earliest and latest listing clock, one year when they are the same), "model years 1932–2026", "N of M listings read from saved copies of the source's pages" ("a saved copy of the source's page" for one; hover: "Pages the source no longer serves, read from an internet archive"), "first recorded <day>", "last recorded <day>" (hover on the last two: "The days Nuke recorded these listings. The listings themselves can be older."). A cell is the make's emblem where one is catalogued, its name, its count in the source's own unit (listings, lots, posts, vehicles or pages), the sold count (only when above zero), its years, and its top three models. A filter narrows the list; the count line says "N makes".
- **Models** (`&make=`): the same cells without the top models; the count line says "N models · N listings". The trail ends with "n of N listings · <day>" from here down.
- **Listings** (`&make=&model=`): a card per listing: photo (`image_url`, see Photos below), year make model, one price line, its status, place, its clocks, a link to `/vehicle/<id>` and one outside link. Sort: newest, price high, price low, year new, year old.
  - **Price line.** "Sold $X" when a sale price is recorded, else the shown price in the source's words: "Buy it now $X"; for a bid, the source's own label when it sent one ("Starting bid $X", with "· N bids" when bids were recorded), else "Bid $X · N bids" while the listing is open, or "Last bid $X · N bids" once it is over (ended, or sold with no sale price recorded), so an ended auction never reads like a bid still open; a bid with no count says "Bid shown $X · bid count not recorded" ("Last bid shown $X · …" when over), never "a bid" and "no bids" together; for the rest "High bid $X · N bids" (the auction species, the count when one is recorded) or "Asking $X". Bids null or 0 mean none recorded, never that none were made, and a count of 0 alone never becomes "Starting bid". Dollars are whole, except cents under $100 ($7.99 is not $8). With no price to show the card says "No price shown": the reader sent none, which is not the same as the source having none (an ended lot can carry a final bid the reader does not send).
  - **Status.** Live, Upcoming, Sold, Ended or Status not recorded. An ended listing says how it ended in the source's own word when that word says more: Bid goes on, Reserve not met, Unsold, Withdrawn, Cancelled, Expired. The word is left off a card whose price line already says "Sold $X".
  - **Clocks.** "Listed <day>" is the seller's own date and is left out when the source gave none; then "First recorded <day>" says when Nuke first recorded the listing, so the day Nuke captured it never passes for the day it was listed. A lot still to come says "Starts <day>" when its date is ahead of the page's clock. "Ends <day>" while the end is ahead, "Ended <day>" after. A listing the source called live that has no end clock says "last checked <day>", the last time Nuke wrote its row: the only evidence it was still alive, so the card never says "now".
  - **Links.** "Open the saved page" when the listing was read from a saved copy of its page (the source no longer serves the live address), else "Open the listing" when it has a web address; only one.
  - **A new order.** Choosing another sort reads page 1 again. The cards of the order before stay on screen, dimmed and with only their grid marked busy, until the new order lands, so the sort control is never unmounted and keyboard focus stays on it. When the new order lands the status region says so, out of sight ("Sorted by Price high, showing 24 of 36"). The last choice wins; a read that fails says "Source holdings could not be read." with Try again.
  - **More.** "More" reads the next page of 60 and appends it; the total line says "showing N of TOTAL" and never reads under the rows shown (a count that shrank between two pages is raised to them). More retires with the pages read: it is gone once `page × page_size` reaches the total, and a page that comes back empty makes what is shown the total. While a page is read More is marked busy (`aria-disabled`) and not disabled, so it keeps keyboard focus, and a second press is ignored. What it added is said in the page's status region, out of sight ("60 more listings, showing 120 of 130"); if More retires while it has focus, focus moves to the first card it added.

**For a keyboard and a screen reader.** The trail is a navigation landmark ("Where you are"). Each card is named by its title, its photo has no alt of its own (the title beside it names it), and its outside link is named for its card ("Open the listing: 1969 Chevrolet Camaro", "Open the saved page: …"), with the words it shows inside the name. The page has one status region for its whole life, holding the visible "Reading…" line and, out of sight, what More added. Only the content region is marked busy while it reads, never an ancestor of the status; while a new order is read only the grid is.

**One read.** `browse_source_read(p_source, p_make, p_model, p_page, p_page_size, p_sort, p_status)` returns one jsonb for the whole page. `sourceBrowseRead.ts` types and decodes it (a missing list is empty, a number sent as text is a number, a null never throws; `p_status` is sent only when a status is asked for) and holds the plain words: `labelsFor` picks them by the source's species group and never by its name (the timed and block auction species show a high bid and count lots; dealers, classifieds and marketplaces show an asking price and count vehicles, posts or listings; an aggregator counts pages read, and its headline is the registry's own unit, "pages read, not listings held", as the Sources board words it).

```
{ as_of, status: 'ok' | 'not_folded' | 'unknown_source', median_floor: 5,
  source:   { slug, name, category, species, species_label, unit, logo_url, base_url },
  holdings: { episodes, vehicles, active, upcoming, sold, ended, unknown, with_image, archived,
              shown_n, shown_median, active_n, active_median, ended_n, ended_median, sold_n, sold_median,
              makes, models, year_min, year_max, dated_min, dated_max, first_seen, last_seen, folded_at,
              landed_24h, last_landed,
              board: null | { day, lots, landed_at, population, population_method, population_confidence, population_at } },
  level: 'makes' | 'models' | 'listings',  scope: { make, model, status },
  makes:  [ { make, episodes, vehicles, active, upcoming, sold, ended, shown_n, shown_median, active_n, active_median,
              ended_n, ended_median, sold_n, sold_median, with_image, year_min, year_max, top_models: [ { model, episodes } ] } ],
  models: [ the same keys without top_models, keyed by model ],
  listings: { total, page, page_size,
              rows: [ { event_id, vehicle_id, year, make, model, trim, status: 'active' | 'upcoming' | 'sold' | 'ended' | 'unknown', status_raw,
                        shown_price, sold_price, price_kind, price_label: 'Starting bid' | null, bids,
                        listed_at, recorded_at, first_seen_at, checked_at, ends_at, location, image_url, listing_url, archive_url } ] } }
```

- `unknown_source`: the slug is not a browsable source (unregistered, an owner's private source, a media source, one with no species). Nothing is named; `source.slug` and `source.name` echo the slug asked for.
- `ok` with `holdings.episodes` 0: a registered source with no public listings yet, or a source only the Sources board knows; `holdings.board`, when present, is the board's own count. `board.lots` counts the source's lots matched against Nuke's target list (a coverage measure; the page's words for that list are "Nuke's own list" and, in the hover, "collection list"), not `holdings.episodes` (every listing the source put on a public vehicle with a make and a model). The page shows both, never as one number.
- `not_folded`: the daily count has not run yet; nothing is counted.
- Status words: `active` is alive now by the source's own word with its end clock ahead (or touched within 14 days); `upcoming` is a catalogued lot whose sale is ahead; `ended` includes bid-goes-on, unsold, reserve_not_met, withdrawn, expired, closed and cancelled (`status_raw` carries the source's own word); `unknown` is no word, or alive by word with no clock and idle for 14 days. `p_status` filters the listings level only, and `scope.status` echoes it.
- Clocks, all ISO with a `+00:00` offset: `listed_at` is the seller's own date only (null when the source gave none); `recorded_at` (the same as `first_seen_at`) is when Nuke first recorded the row; `checked_at` is when Nuke last wrote it, the only evidence a listing alive by the source's word with no end clock was still alive; `ends_at` is the source's end. `event_id` is the event row the listing is, and the page keys its rows by it. `dated_min` and `dated_max` are the earliest and latest listing clock (end, else start) among the source's listings; `archived` is how many listings were read from a saved copy of their page (`archive_url` present).
- `holdings.landed_24h` counts every row the source landed in the last 24 hours, on a public vehicle with a make and a model or not, and `last_landed` is the latest. The page words the count as one of its own, never as a part of `holdings.episodes`.
- `bids` is the count behind a current-bid price; null or 0 means none recorded. `price_label` is "Starting bid" only when the source itself labelled the price that way.
- **Photos.** `image_url` is the vehicle's primary image as the reader sends it. The reader's part of the contract is to send only a photo the photo gate allows (`vehicle_card_images`), else null; a photo the gate holds is not shown. The page draws what it is sent, a web address or an app path and nothing else, and says "no photo" for none or for one that does not load. It does not decide which photos are public.

**The daily count.** The counts and the makes-and-models lists are not counted when a page opens (the events table is large and `vehicles.source` has no index): a scheduled job, `source-holdings-refresh`, counts them every day at 03:35 Pacific (`35 10 * * *` UTC, so 02:35 once clocks go back), and `holdings.folded_at` dates every one. How many rows Nuke recorded from the source in the last 24 hours, and when the last one arrived, are read live from the events index. Each count of listings on the page carries its denominator and its day: the status blocks, With photos and the saved copies are n of the source's listings (or vehicles) on the day of the daily count, the trail's n of N carries that day, and the live count says its window, "in the last 24 hours". The Makes and Models blocks count kinds, not listings, so they carry no fraction; the masthead's "counted <day>" dates them.

**No median, no completeness %.** The page shows no median price (owner, 2026-10-16: "median doesnt matter"): one over every model year and listing date of a source mixes different cars, so price discovery is the card sort at the last level. The reader still sends a median per status (active, ended and sold; `shown_*` repeats the active one), each null under five values (`median_floor`), and the decoder floors them a second time, so a median under the floor could not reach a screen even if a page showed one. No percentage of completeness is shown anywhere on the page: the source's total is a number with its method in plain words, its confidence (a percent that always says so) and its day, or it is "source total unknown".

# Feed Review: Why It Sucks and What Would Make It Not Suck

**Reviewer:** Feed Director (design-review team)
**Date:** 2026-04-05
**Source files reviewed:** FeedPage.tsx, VehicleCard.tsx, SignalCard.tsx, ReturnVisitBanner.tsx, FreshFindsStrip.tsx, FeedToolbar.tsx, feed-query/index.ts, feed types, field note (2026-04-03-feed-dopamine-gap-analysis.md)
**Data queried:** vehicles table, portfolio_stats_cache, vehicle_events

---

## Executive Summary

The feed is an impressive piece of engineering with genuine intelligence behind it -- ML ranking, deal/heat scores, signal cards, interest memory, find scoring, return-visit personalization. None of that matters because **the feed has an identity crisis**: it was built as a Bloomberg Terminal for cars but the user wants a slot machine for trucks. The architecture is sound. The experience is wrong.

**Verdict: The feed is a real product feature built for the wrong user at the wrong time.** It is not a premature social layer -- it is a premature *research* layer on a platform with 7 users and 529K vehicles. The data is rich. The dopamine loop is broken.

---

## Part 1: What Exists (The Architecture)

The feed is technically sophisticated. A summary of what's built:

### Data Pipeline
- **529K vehicles** total, 398K with photos, 417K with prices, 335K with Nuke Estimates, 39K with deal scores
- **3,066 vehicles added in last 24h**, 23,745 in last 7d -- the pipeline is alive
- **46 active auctions** with live end dates
- **13,522 for-sale vehicles** flagged
- **263K with location data** (city/state)
- Sources: BaT (81K+44K), Mecum (71K), FB Marketplace (54K), Barrett-Jackson (37K), Cars & Bids (31K), Craigslist (7K), Gooding, PCarMarket, Bonhams, and more
- **Materialized view** (`vehicle_valuation_feed`) with pre-joined images, descriptions, valuations -- fast server-side query

### Feed Components (top to bottom)
1. **FeedStatsStrip** -- Clickable metrics (total vehicles, value, today, for sale, live). Each metric applies a filter preset.
2. **FeedToolbar** -- 10 sort options (RANK, NEWEST, OLDEST, FINDS/FOR YOU, DEALS, HEAT, PRICE, YEAR, MILES), 3 view modes (grid/gallery/technical), density slider (3-12 columns), font size slider, image fit toggle, scores toggle.
3. **HeroPanel** -- Dimension visualization on sort-button double-click (expandable panels for each sort dimension).
4. **ReturnVisitBanner** -- "SINCE YOUR LAST VISIT" with new vehicle count, interest-matched new arrivals, price drops on viewed vehicles, top find.
5. **FreshFindsStrip** -- Horizontal scrollable strip of 10 thumbnails matching user interests, added since last visit.
6. **InterestsBar** -- Learned interest chips (makes/models) as quick-filter buttons.
7. **RecentlyViewed** -- Horizontal strip of 20 recently-viewed vehicles.
8. **FeedFilterSidebar** -- Full filter panel (makes, models, body styles, year range, price range, drivetrain, sources, etc.).
9. **FeedLayout** -- Virtualized grid with infinite scroll, stat/signal card injection every 5 rows.
10. **VehicleCard** -- 3 view modes: grid (image + identity + info line), gallery (row with image + stacked metadata), technical (spreadsheet row).
11. **SignalCards** -- 5 types injected between vehicle rows: LIVE_AUCTION (countdown timer), DEAL_ALERT (below-market badge), PRICE_DROP (viewed + price decreased), NEW_FROM_SOURCE (batch arrival), COMMENT_HIGHLIGHT (bid count invitation).

### Intelligence Layer
- **Feed rank score** -- ML-computed composite ranking for default sort
- **Deal score** -- Below-market pricing signal with labels (STEAL/GREAT/GOOD/ABOVE/OVER/WAY+)
- **Heat score** -- Market interest signal (VOLCANIC/FIRE/HOT/WARM)
- **Find score** -- Multi-signal scoring (deal + heat + rarity + condition + red flags + mods + cross-platform)
- **Interest memory** -- Tracks user's make/model engagement, boosts matching vehicles in FOR YOU sort
- **View history** -- Tracks which vehicles user has seen, shows VIEWED badge, enables price-drop detection
- **Return visit tracking** -- Detects returning users, counts new vehicles since last visit

---

## Part 2: What's Wrong (The Diagnosis)

### PROBLEM 1: The feed is a research tool pretending to be a discovery tool

The default sort is `feed_rank` (ML-ranked), not `newest`. The default grid density is 6 columns. The card design prioritizes data density (source badge, deal score, heat score, transmission, drivetrain, mileage, VIN) over visual impact. The design book explicitly calls for 8-11px fonts, zero border-radius, Bloomberg Terminal aesthetics.

This serves The Archivist perfectly. But the user who said the feed "sucks ass" is The Browser -- the FB Marketplace scroll addict who wants one thing big, recency prominent, and a dopamine loop that completes in 5 seconds.

**The feed defaults to the wrong persona.**

### PROBLEM 2: No temporal urgency

The field note nailed this. Time is buried in 8px grey Courier New at the bottom of the info line. A truck listed 5 minutes ago and a truck listed 5 months ago are visually identical. There is no "JUST LISTED" badge. There is no "12m ago" in prominent position. There is no time-decay visual treatment (muting old cards).

The `vehicleTimeLabel()` function produces labels like "2h ago" or "sold 3d ago" -- but they're rendered as metadata noise, not as the primary urgency signal.

With 3,066 new vehicles in the last 24h, there IS genuine freshness. The feed just doesn't celebrate it.

### PROBLEM 3: No refresh ritual

The feed loads once via React Query infinite scroll. There is no pull-to-refresh. No "12 NEW" badge. No polling. No "NEW LISTINGS ABOVE" sticky banner. The variable-reward loop (the slot machine pull) does not exist.

The `useFeedQuery` hook uses React Query's `useInfiniteQuery` with standard stale/cache times. There is no subscription, no polling interval, no WebSocket for live updates.

### PROBLEM 4: Cards are too small in default view

At 6 columns (the default `cardsPerRow`), each card is approximately 250px wide. The hero image at 75% aspect ratio is 187px tall. That's a thumbnail, not a hero. The user needs to identify a vehicle in 0.3 seconds during a speed-scroll. At 250px, you're squinting at what might be a truck.

The density slider goes from 3 to 12. The user can manually set 3 columns for bigger cards. But the default is wrong for The Browser.

### PROBLEM 5: No save/watch/favorite mechanism

The `VehicleCard` has an `isFollowing` prop and a `CardActions` component with a follow toggle -- but `showActions` defaults to `false` and is never set to `true` in FeedPage. The follow/watch button is implemented but hidden.

There is no "SAVED" page. There is no "3 price drops on your watched vehicles" notification. The design book specifies a watchlist in the Finder model -- it's designed but not wired up.

### PROBLEM 6: No path from discovery to action

Click a card -> opens a VehiclePopup. The popup shows vehicle details. There is no "MESSAGE SELLER" button. There is no "VIEW LISTING" CTA (the card has `listing_url` and `discovery_url` data but the popup doesn't prominently surface them as action buttons). The SignalCard LIVE_AUCTION type does link out ("BID NOW"), but regular cards are dead ends.

The popup is read-only. You discover, you evaluate, you... close the popup. The dopamine loop starts (discover) but never completes (act).

### PROBLEM 7: Location is present but not prominent

263K vehicles have location data. The VehicleCard shows location in the gallery view (7px font, `var(--text-disabled)` color) and in the expanded grid card content (extra specs section). But it's not on the default collapsed grid card. A truck 8 miles away and a truck 2,000 miles away look identical in the default view.

There's a zip+radius filter in the sidebar, but no geolocation auto-detect, no "NEAR ME" quick filter, no distance badge on cards.

### PROBLEM 8: The tab architecture hides the feed

The feed lives behind a tab on the HomePage (`?tab=feed`). The default tab is `feed` but the tab bar itself is hidden when on the feed tab (`activeTab !== 'feed'` conditionally renders the tab bar). This means: when you're on the feed, you don't see the tabs -- which is fine. But navigating to other tabs requires going to `/?tab=garage` or `/?tab=map`.

For logged-out users, they first see the TreemapHomePage. They have to click "Browse" to reach the feed. The treemap is a visualization of the data, not a marketplace entry point. The first impression is "academic data viz," not "here are trucks you can buy."

### PROBLEM 9: 7 users, 0 social signals

The platform has 7 registered users. There are no social signals: no "3 people watching," no "seller usually responds in 1 hour," no user-generated content in the feed, no comments visible, no community activity.

The feed is entirely system-generated content (vehicle listings from crawled sources). This is fine for a data platform, but it means the feed has no social proof, no competition anxiety, no community warmth.

The COMMENT_HIGHLIGHT signal card is clever -- it generates synthetic "from the comments" content from bid counts. But the comment text is fabricated client-side ("47 bids and counting...") because the feed-query endpoint doesn't return actual comments. It's theater, not real social signal.

### PROBLEM 10: Signal cards are approximations, not real signals

- **PRICE_DROP**: Uses nuke_estimate as proxy for "old price" since actual price history isn't tracked in the feed data. The price didn't really drop -- the current price is just below the estimate.
- **COMMENT_HIGHLIGHT**: Fabricated text from bid counts. No real comments in the feed data.
- **DEAL_ALERT**: Legitimate -- derived from actual deal_score computations.
- **LIVE_AUCTION**: Legitimate -- derived from actual vehicle_events with end dates.
- **NEW_FROM_SOURCE**: Legitimate -- groups vehicles by discovery_source.

3 of 5 signal types are genuine. 2 are approximations that could feel hollow if a user investigates.

---

## Part 3: What's Right (Don't Break These)

1. **The data pipeline is genuinely alive.** 3K+ vehicles/day flowing in from 15+ sources. This is not a dead catalog. The freshness is real -- the feed just doesn't celebrate it.

2. **The intelligence layer is real.** Deal scores, heat scores, find scores, feed rank -- these are computed from actual market data, not hand-waved. The valuations have confidence intervals. This is genuine alpha over FB Marketplace.

3. **The interest memory system is elegant.** It silently learns from filter interactions, boosts matching vehicles, and surfaces personalized fresh finds on return. No explicit "what do you like?" prompt needed (though one would help for first visit).

4. **The ReturnVisitBanner is a good idea.** "SINCE YOUR LAST VISIT: +187 new vehicles, 3 price drops on your watched vehicles, TOP FIND: 1973 K10 $14,500" -- this is the right emotional hook for a returning user.

5. **The SignalCard injection creates variety.** Breaking up a uniform grid with LIVE AUCTION countdown timers and DEAL ALERT badges is exactly what makes a feed feel alive vs. a catalog.

6. **The view mode flexibility is powerful.** Grid/gallery/technical with adjustable density is genuinely useful for different tasks. The technical view is a spreadsheet -- perfect for The Archivist.

7. **The zero-click-anxiety popup model is correct.** Click card -> popup -> Escape to dismiss. No page navigation, no lost scroll position, no back-button anxiety. This is a design book win.

---

## Part 4: Recommendations (Priority-Ordered)

### TIER 1: Fix the defaults (low effort, high impact)

**1. Default to "HUNT" mode for new/anonymous users**
- 3 columns (not 6), bigger cards, bigger hero images
- NEWEST sort (not RANK) -- recency IS the product for The Browser
- Time label promoted to prominent position on card (not buried in info line)
- "JUST LISTED" red badge on cards < 1 hour old, "TODAY" orange badge on < 24h
- Keep RANK/RESEARCH mode as an explicit toggle for The Archivist

**2. Enable the follow/watch button**
- `showActions` is hardcoded to `false` in FeedPage's `renderCard`. Change it to `true`.
- Wire up the actual follow state (it's already designed in the component props)
- Add a "SAVED" page or sidebar section
- This is likely a 10-line change that unlocks a retention loop

**3. Add "VIEW LISTING" CTA to cards and popup**
- The data exists: `discovery_url` and `listing_url` are populated for most vehicles
- A button that opens the original BaT/Craigslist/etc listing in a new tab
- Closes the gap between discovery and action

### TIER 2: Build the dopamine loop (medium effort)

**4. Refresh mechanism**
- Poll every 60s, show "X NEW ABOVE" sticky banner (like Twitter)
- Pull-to-refresh on mobile
- Count badge on feed tab: "12 new"

**5. Location awareness**
- Browser geolocation on opt-in
- Distance badge on cards (or city/state prominently displayed)
- "NEAR ME" quick filter button in toolbar
- Sort by distance option

**6. Recency celebration**
- Time-decay visual: cards > 7 days slightly muted
- Minute-level granularity for fresh listings ("12m ago" not "1h ago")
- FreshFindsStrip count: "47 NEW SINCE YESTERDAY" not just 10 thumbnails
- Animated "NEW" indicator on just-loaded vehicles

### TIER 3: Build competitive advantage (higher effort)

**7. Real price tracking (not estimate-based proxy)**
- Track asking_price at time of first observation
- Detect actual price changes between observations
- Show real "was $X, now $Y" on PRICE_DROP signals

**8. Onboarding intent capture**
- "What are you looking for?" on first visit
- Make/body/era/budget quick-select
- Instant personalized feed from first interaction
- Skip the treemap entirely for new users

**9. Human-readable scarcity signals**
- "Only 3 similar trucks listed this month"
- "Last one sold in 2 days"
- Translate heat_score from "VOLCANIC" to "7 people are watching"
- Production numbers for rare vehicles

**10. Map view as first-class feed mode**
- Location data exists for 263K vehicles
- Map with vehicle pins, click for popup
- Filter by draw-on-map region
- This is a genuine differentiator over FB Marketplace

---

## Part 5: The Core Tension

The design book describes a Bloomberg Terminal for cars. The user wants a slot machine for trucks. These are not incompatible -- they are modes. The feed already has 3 view modes (grid/gallery/technical). What it needs is 2 *persona* modes:

- **HUNT mode** (The Browser): 2-3 columns, big photos, minimal text, newest-first, recency badges, save button, distance, "VIEW LISTING" CTA. Optimized for the 5-second discover-evaluate-act loop.
- **RESEARCH mode** (The Archivist): 5-8 columns, full data density, deal/heat scores, technical specs, RANK sort. The current feed, essentially.

The current feed is RESEARCH mode with no way to switch to HUNT mode. The default density slider (3-12) is a layout control, not a persona control. Setting it to 3 gives you bigger cards but still shows 8 data points per card in 7px font. HUNT mode needs 3-4 data points per card in 11-14px font.

---

## Part 6: The "Should the Feed Even Exist?" Question

Yes. Emphatically.

The feed has 529K vehicles, 3K+ added daily, from 15+ sources, with AI-computed valuations and deal scores. This is not a premature social layer on a data platform. This is a genuine marketplace feed with more intelligence than any competitor.

The problem is not the feed's existence. The problem is that the feed was designed by The Archivist for The Archivist, and the user is The Browser. The data is there. The intelligence is there. The dopamine loop is not.

The feed should be the default homepage. The treemap should be an Easter egg or a "Market Overview" secondary page. When someone opens Nuke, they should see trucks they can buy, sorted by freshest, with big photos and prominent recency badges. Not a squarified treemap visualization of makes by count.

---

## Appendix: File Reference

| File | Purpose | Lines |
|------|---------|-------|
| `src/feed/components/FeedPage.tsx` | Main feed orchestrator | ~460 |
| `src/feed/components/VehicleCard.tsx` | Card component (3 view modes) | ~610 |
| `src/feed/components/SignalCard.tsx` | 5 signal card types + useSignalCards hook | ~810 |
| `src/feed/components/FeedToolbar.tsx` | Sort/view/density controls | ~280 |
| `src/feed/components/ReturnVisitBanner.tsx` | "Since your last visit" banner | ~380 |
| `src/feed/components/FreshFindsStrip.tsx` | Interest-matched new vehicles strip | ~315 |
| `src/feed/api/feedApi.ts` | API client for feed-query | ~35 |
| `src/feed/types/feed.ts` | All feed types | ~240 |
| `supabase/functions/feed-query/index.ts` | Server-side feed endpoint | ~555 |
| `src/pages/HomePage.tsx` | Tab host (treemap/feed/garage/map) | ~1445 |

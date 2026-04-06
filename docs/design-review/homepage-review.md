# Homepage Review -- Design Review Task #4

**Reviewer:** Homepage Director
**Date:** 2026-04-04
**File:** `nuke_frontend/src/pages/HomePage.tsx` (1,445 lines)

---

## WHAT THE PAGE DOES TODAY

HomePage.tsx is two completely separate applications sharing one file:

### Path A: Logged-out user (TreemapHomePage)
A full-viewport treemap visualization of the entire vehicle database, organized by make. The treemap fills the screen edge-to-edge. Users drill down: Makes -> Models -> Years -> Individual Vehicles -> Vehicle Profile. Color encodes median price (6 heat tiers). Area encodes vehicle count (or sale price at vehicle level). Includes its own header bar, search bar, breadcrumb nav, and footer. This is ~900 lines of the file.

### Path B: Logged-in user
A tab bar with three tabs: Feed (default), Garage, Map. The tab bar is 30px tall. Below it, the entire viewport is handed to whichever lazy-loaded component corresponds to the active tab. There is also an onboarding slideshow for first-time users. This is ~100 lines of the file.

The tab system (Feed/Garage/Map) has no homepage content of its own -- it is purely a tab router. The "homepage" for a logged-in user is whichever tab they last used, stored in localStorage.

---

## SECTION-BY-SECTION ANALYSIS

### The Treemap (logged-out landing)

**What it shows:** A squarified treemap (Bruls-Huizing-van Wijk 2000 algorithm, implemented from scratch) displaying vehicle makes sized by count and colored by median price. Drills into models, years, then individual vehicles.

**Data queries:**
- `treemap_by_brand` RPC -- all makes with counts, values, median/min/max prices, sell-through rates
- `treemap_models_by_brand` RPC -- models within a make
- `treemap_years` RPC -- years within a make+model
- Direct `vehicles` table query -- individual vehicles within make+model+year, limited to 200

**Technical quality:** The treemap algorithm is well-implemented. Hover-prefetch on 200ms debounce eliminates load flash on drill-in. Zoom transitions animate from click origin point. Representative images load for aggregate cells. Tooltips show sell-through rate, bid averages, value ranges. The code is ~500 lines of solid visualization engineering.

**The problem:** It answers a question nobody asked.

A visitor arrives at nuke.ag. They see a wall of colored rectangles. The largest one says "PORSCHE" (or whatever make has the most auction volume). The visitor has no idea what they are looking at or what to do with it. The footer says "AREA = VEHICLE COUNT / COLOR = MEDIAN PRICE" in 8px text. Even if you read that, the response is "so what?"

The treemap is a data exploration tool designed for someone who already understands the dataset. It is not a landing page. It does not communicate what Nuke is. It does not direct the visitor to do anything. There is a search bar, but it competes with the visual density of the treemap for attention. There is a "FEED" button in the header and a "BROWSE ALL" button in the footer, but neither is the obvious action.

**Who it serves:** An analyst who wants to explore auction market structure. This is approximately 0% of potential visitors.

**Who it fails:** Anyone trying to understand what Nuke is, anyone trying to search for a specific vehicle, anyone who just landed from a link and wants to know if this site is relevant to them.

### The Stats Bar

There is no stats bar visible to logged-in users. The treemap's breadcrumb bar shows `{count} vehicles / {total value} total value` for the current drill level. This is contextual metadata for the treemap, not a standalone stats bar.

The PRODUCT_AUDIT references a stats bar showing "SHOWING 100, VALUE $17.1B, TODAY +3465, FOR SALE 49K, LIVE 3" -- this likely lives in the Feed component (FeedStatsStrip), not on the homepage itself.

### The Tab System (logged-in)

Three tabs: Feed, Garage, Map.

**Feed (default):** A full browsing/filtering experience with toolbar, sidebar filters, vehicle cards, signal cards, hero panel, interests bar, recently viewed, return visit banner, and fresh finds strip. This is a substantial component (`FeedPage.tsx`) with its own query engine, URL-driven state, and virtualized rendering. It is effectively a standalone application.

**Garage:** Shows vehicles the user has a relationship with (owner, co-owner, consigned, contributor). Data comes from 5 parallel queries across `ownership_verifications`, `vehicle_user_permissions`, `vehicle_contributors`, `discovered_vehicles`, and `vehicles` (filtered by `profile_origin`). Supports grid/list/compact view modes, sort by recent/value/health/name, filter by owned/contributed.

**Map:** A full deck.gl/choropleth map with county-level data, business pins, collection pins, timeline scrubber, search, and vehicle/org detail panels. A heavyweight visualization component.

**The problem with tabs:** There is no "homepage." There is a tab switcher. A logged-in user does not land on "the homepage" -- they land on whichever tab they were last using. If they have never been here before, they land on Feed.

This means:
1. There is no single logged-in landing experience to optimize
2. There is no "welcome back" moment
3. There is no answer to "what happened since you were last here?"
4. The user's first impression is the Feed, which is a browse tool with no personalization context (their interests have not been learned yet)

### The Onboarding Slideshow

Fires once for new users via `OnboardingSlideshow`. Stored in `localStorage('nuke_onboarding_seen')`. This is the only first-use experience. After dismissal, the user is dumped into the Feed tab with no further guidance.

### The Search Bar (treemap version)

The treemap has its own search bar that queries the vehicles table directly (not the `universal-search` edge function). It does simple `ilike` matching on make, model, and VIN, limited to 5 results. This is a degraded version of the real search -- different code path, fewer capabilities, no thumbnail, no type-ahead richness.

---

## EVALUATION

### 1. First impression: what does a logged-in user see?

The Feed tab. A toolbar, a filter sidebar, and a grid of vehicle cards. If they have no interests yet, it shows everything (unfiltered). If they are a returning user, they might see a return visit banner. There is no "hello, here is what matters to you" moment.

**Verdict:** Functional but impersonal. It is a browse tool, not a homepage.

### 2. The tab system -- is it justified?

Each tab (Feed, Garage, Map) renders a full-page application. They share zero UI. They share zero state. They are three separate products behind a 30px tab bar.

- **Feed:** Has enough content and complexity to be a standalone page. Justified.
- **Garage:** Only useful if the user has vehicle relationships. For 99.99% of users (who have none), this is an empty page. Not justified as a default tab.
- **Map:** Heavyweight visualization that loads deck.gl. Cool but niche. Not justified as a default tab.

**Verdict:** The tab system exists because there are three things that needed a home, not because users need to switch between them. The tabs should be pages (routes), not tabs on the homepage. The homepage should be the homepage.

### 3. The treemap -- is this useful or is it a demo?

It is a demo. A beautifully engineered demo.

The treemap answers: "What is the distribution of collector vehicles across makes, models, and years, sized by volume and colored by median price?" This is an interesting analytical question. It is not a question any user brings to a vehicle data platform.

Nobody opens a car website thinking "I want to understand the compositional breakdown of the BaT auction universe." They think "I want to find a 1973 911" or "what is my car worth" or "what sold at BaT this week."

The treemap should live at `/explore` or `/admin/treemap` as a data exploration tool. It should not be the front door.

### 4. Recently viewed -- is this placed correctly?

Recently viewed lives inside FeedPage, not on the homepage directly. It appears as a horizontal strip above the feed grid. Placement within Feed is reasonable. But it is buried -- a returning user has to scroll or already be on the Feed tab to see it.

### 5. The stats bar -- is it meaningful?

The stats (vehicle count, total value, today's additions, for sale count, live auctions) live in FeedStatsStrip, not on the homepage. They are platform vanity metrics. "VALUE $17.1B" tells the user nothing about their experience. "TODAY +3465" is impressive infrastructure data but not actionable.

**Verdict:** Vanity metrics for the platform, not useful to the user. The only useful stat would be personal: "3 price drops on vehicles you watched" or "your K10 just got a new comp sale."

### 6. What should this page ACTUALLY be for each user type?

**New user (just signed up):**
They need to answer: "Does this platform have my kind of vehicle?" The right experience is a search prompt -- "What are you into?" -- that immediately shows they are in the right place. Find-your-car flow. Taste signals. Not a treemap, not an unfiltered feed of 843K vehicles.

**Returning user (checking on their vehicles):**
They need to answer: "What happened since I was last here?" Activity feed: price drops on watched vehicles, new auction results for their makes/models, new photos added to their vehicles. A personalized digest. Not a browse tool.

**Power user / founder:**
They need the command center -- extraction pipeline status, queue health, recent ingestion activity. This is the admin dashboard, not the homepage. It should live at `/admin`.

**Casual browser (no account):**
They need to understand what Nuke is and search for something. A hero section with search and 3-4 impressive vehicle profiles showing the depth of data. Not a treemap.

### 7. Is there a version of this page that is both simple AND powerful?

Yes. The homepage should be a search bar and a personalized feed.

**Logged-out:** Search bar (prominent, centered), a few curated vehicle cards showing data depth, and a clear value proposition sentence. No treemap. No tabs. Just: "search for any collector vehicle" with proof that it works.

**Logged-in, first visit:** Search bar + "What are you into?" maker/interest picker. As soon as they pick Porsche, show them every Porsche. Get them to a vehicle profile in 2 clicks. That is where the magic is.

**Logged-in, returning:** Search bar (always available at top) + personalized activity stream. "Since you were last here: 3 new 911s listed, your K10 got a comp sale at $47K, price drop on that Blazer you viewed." Below that: the feed, pre-filtered to their interests.

---

## THE ONE-THING QUESTION

> If you could only show ONE thing to a logged-in user, what would it be?

**A personalized activity stream showing what changed since their last visit, on vehicles and market segments they care about.**

Not a treemap (data exploration tool). Not a generic feed (browse tool). Not tabs (navigation pattern). A stream of things that are relevant to *this person* right now.

If their interests are not yet known: the search bar, front and center, with "Find your vehicle" as the only call to action.

---

## STRUCTURAL PROBLEMS IN THE CODE

### 1. Two apps in one file
The treemap (logged-out) and the tab router (logged-in) share a file but share zero code. `TreemapHomePage` is 900 lines of self-contained visualization. The logged-in homepage is 100 lines of tab switching. These should be two files.

### 2. Duplicate search implementation
The treemap has its own search bar that does direct Supabase queries (`vehicles` table, `ilike` matching, limit 5). The global header (elsewhere in the app) presumably uses `universal-search`. Two search implementations means two codepaths to maintain, different result quality, and inconsistent UX.

### 3. Tab state in localStorage
The active tab is persisted in localStorage (`nuke_hub_tab`). This means the "homepage" is whatever the user last clicked. There is no concept of "the homepage" as a distinct experience -- it is a three-way switch.

### 4. Treemap queries with no caching strategy
Four hooks (`useTreemapBrands`, `useTreemapModels`, `useTreemapYears`, `useTreemapVehicles`) all use raw `useState`/`useEffect` with Supabase `.rpc()` or `.from()` calls. No React Query. No stale-while-revalidate. No cache. Every mount refetches. The prefetch cache is a `useRef<Map>` that does not survive navigation.

### 5. The garage query fires on every homepage mount
`useVehiclesDashboard(user?.id)` runs on line 1343 -- outside any tab guard. This means the 5-query parallel fetch (ownership_verifications, vehicle_user_permissions, vehicle_contributors, discovered_vehicles, vehicles) runs every time a logged-in user loads the homepage, even if they never click the Garage tab. For the founder with 11 vehicles, this is trivial. For a future user with 0 vehicles, this is 5 wasted queries per page load.

---

## RECOMMENDATIONS

### Immediate (this sprint)

1. **Kill the treemap as the logged-out landing.** Replace with: search bar, value proposition, 3-4 curated vehicle cards. The treemap can live at `/explore` if someone wants to keep it.

2. **Split HomePage.tsx into two files.** `LandingPage.tsx` (logged-out) and `AppHome.tsx` (logged-in). The current file does two unrelated jobs.

3. **Remove the duplicate search bar.** Use the same search component everywhere.

4. **Lazy-load the garage query.** Only run `useVehiclesDashboard` when the Garage tab is active.

### Near-term (next sprint)

5. **Replace tabs with a real homepage.** The logged-in experience should be: search bar + personalized activity stream + quick links to Feed/Garage/Map as secondary navigation. Not a tab bar that makes one of three apps "the homepage."

6. **Build the "what changed" feed.** Surface: new listings matching interests, price changes on viewed vehicles, new comp sales for owned vehicles. This is the hook that brings users back.

7. **Move Feed, Garage, Map to their own routes.** `/feed`, `/garage`, `/map`. The homepage becomes a lightweight hub, not a tab container.

### Strategic

8. **Build the claim-your-vehicle flow.** This is the bridge between data engine and user product. User searches -> finds their car -> claims it -> Garage has value. Without this, Garage is empty for every user except the founder.

9. **Invest in the vehicle profile, not the homepage.** The profile is where the data shines. The homepage's job is to get people there as fast as possible. Every pixel on the homepage that is not search, not personalized activity, and not a link to a vehicle profile is a distraction.

---

## SUMMARY

The homepage is currently two things and neither of them is a homepage.

For logged-out users: it is a treemap data visualization that does not communicate what Nuke is or what the visitor should do. Beautiful engineering, wrong location.

For logged-in users: it is a tab switcher between three separate applications (Feed, Garage, Map), with no actual homepage content. No personalization, no "what happened since you left," no guidance.

The fix: make the homepage a homepage. Search bar at the top. Personalized activity below. Everything else is a link to a page, not a tab on this page.

# Search + Filters Findings (Cursor Homepage) and Next Session Plan

Date: 2025-12-14  
Scope: `nuke_frontend/src/pages/CursorHomepage.tsx`, `nuke_frontend/src/components/vehicles/VehicleCardDense.tsx`

## What we found (root causes of “clanky” search/filters)

### 1) There was no real “search”
- The homepage had filters (year/price/make/etc) but **no global search input**.
- The only text input was a **“Make”** field inside the filter panel, which forces extra clicks and doesn’t match how users expect to search cars (year/make/model/VIN/title).

### 2) The filter state and indicators were misleading
- The top “Filters ●” indicator was effectively always on because it treated defaults (like `hasImages: true`) as “active”.
- The minimized filter bar “Active (N)” count used a generic `Object.values(filters)` heuristic, so it counted **non-filter toggles** (display toggles) and default values in unintuitive ways.
- Result: the UI never felt trustworthy; users couldn’t tell if they were “filtered” or not.

### 3) Filtering felt slow because it re-ran too often while typing
- Recomputing filters on every keystroke is fine for small lists, but feels rough once you hit hundreds of vehicles and additional derived fields.
- We saw the filtering pipeline was synchronous in React and triggered frequently; without debouncing, typing “feels heavy”.

### 4) Schema drift can break the entire feed (and make filters feel “broken”)
- The homepage query previously included a column that didn’t exist in prod (`vehicles.listing_status`), which caused the fetch to fail.
- When the feed errors, the UI shows an error card; at that point the filter UI feels “broken” because it is operating on no data.

## What we already fixed (in this session)

### A) A real search box that feels immediate
- Added a top-level global search input that matches **year/make/model/title/VIN**.
- Debounced search by 150ms so typing doesn’t feel laggy.
- Added a keyboard shortcut: **press `/`** to focus search (when not already typing in an input).
- Added a “Clear” button when search text is present.

### B) Fixed “filter active” indicators so they reflect reality
- Added `DEFAULT_FILTERS` and derived `activeFilterCount` that only counts *actual filtering controls* (plus search), excluding purely visual toggles.
- Updated:
  - “Filters ●” dot to reflect `activeFilterCount`
  - minimized header “Active (N)” to use `activeFilterCount`

### C) Reset now resets to sane defaults
- Replaced “Clear All” behavior with **Reset**:
  - resets filters back to `DEFAULT_FILTERS`
  - clears search text

### D) Pricing clarity on cards
- `VehicleCardDense` price overlays now show a badge label (ex: **ASKING**, **SOLD**, **EST**) above the price so tiles are self-explanatory.

### E) Sold handling on homepage without schema drift
- Added “Hide Sold” toggle (default on).
- Uses safe sold indicators: `sale_price`, `sale_date`, `sale_status`.
- Removed `listing_status` from homepage query after it broke production.

## Remaining pain points (what still “sucks” today)

### 1) Search is still “literal substring” only
- Current search is AND-of-terms substring match on a concatenated string.
- It does not handle:
  - typos (chevy vs chev, gmc vs g.m.c.)
  - token normalization (k10 vs k-10)
  - partial VIN matching beyond substring
  - synonyms (c10 vs c-10, “silverado” vs “c/k”)

### 2) Search has no ranking
- Results are only sorted by whatever sort setting is active.
- Search should ideally boost:
  - exact matches (VIN exact/last-6)
  - exact year matches
  - exact make/model tokens
  - for-sale vehicles (if browsing for inventory)

### 3) Filter panel is still “wide and busy”
- It’s improved, but still a lot of controls.
- Users want “one box + a couple obvious toggles”, and the rest should be “Advanced”.

### 4) Performance and data loading strategy is still brute-force
- Feed loads up to 500 vehicles and then filters client-side.
- This is okay short-term, but the long-term approach should be:
  - server-side filtering for expensive filters
  - server-side search/ranking (or a search index)
  - pagination / infinite scroll

## Next concentrated session: agenda + decisions we need

### Session goal
Make search feel “fast, obvious, and fun”:
- 1) type what you think
- 2) results are instantly relevant
- 3) refinement is chip-based and reversible

### Decisions to make first (10 minutes)
- **Search scope**: homepage feed only, or cross-entity (orgs, parts, receipts)?
- **Primary use case**: browse hype feed vs find a specific VIN vs find inventory for sale.
- **Target behavior**: strict matching vs fuzzy matching vs ranked search.

### UX deliverables (frontend)
1) **Search bar as primary control**
   - tokenize terms and show “smart hints” (ex: `vin:`, `year:`, `make:`)
2) **Active filter chips row**
   - shows: search terms, year range, price range, make list, for sale, hide sold, has images
   - click chip “x” to remove that constraint
3) **One-click presets**
   - examples: “For sale”, “Newest”, “Most photos”, “Live auctions”
4) **Empty state that helps**
   - “No results” should suggest actions: clear search, relax filters, show sold, etc.

### Data/ranking deliverables (backend or client)
Option A (quick win, client-side):
- Improve tokenization and normalization:
  - normalize punctuation: `k-10` == `k10`
  - strip repeated spaces, lower-case
  - handle make synonyms (chevy/chevrolet)
- Add a simple scoring function for search matches.

Option B (correct long-term, server-side):
- Implement a Postgres-backed search RPC:
  - input: search string, filters
  - output: vehicles + score + pagination
- Use Postgres text search (`tsvector`) and/or trigram index for fuzzy match.

### Performance goals (measurable)
- Typing should not drop frames.
- Filtering/search should feel < 100–150ms for common cases.
- Avoid loading 500 records if we only need 50 ranked results.

## Files touched in this round (for reference)
- `nuke_frontend/src/pages/CursorHomepage.tsx`
  - Added global search + debounce
  - Added `DEFAULT_FILTERS`, `activeFilterCount`, “Reset”, “Hide Sold”
  - Fixed query drift (removed missing columns)
- `nuke_frontend/src/components/vehicles/VehicleCardDense.tsx`
  - Price overlay label badge (ASKING/SOLD/EST)
  - Removed emoji fallback (“CAR” instead of icon)



# FINDER ARCHITECTURE — How Nuke Should Work

**Status**: Working spec — this is a living document for reshaping the frontend.
**Date**: 2026-03-22

---

## The Thesis

Nuke is a finder. Not a dashboard. Not a social feed. Not an app with pages.

A finder is a tool that helps you explore a data topology. The topology is the product. The UI is just a lens. The same topology surfaces through the web frontend, MCP tools, CLI, browser extensions, npm packages, GitHub integrations, Shopify plugins, and every other platform that can call a function.

**Data leads. Design follows. Features are just views.**

---

## What Changes

### Current Architecture (Page-Centric)

```
Router → Page → Components → Data
        ↑
  User picks a page
```

The user navigates to a *page* (HomePage, Search, BrowseVehicles, AuctionMarketplace, Portfolio, PhotoLibrary). Each page is a silo with its own data-fetching, its own layout, its own empty states. The pages share the header and not much else.

The problem: when you're truck-shopping, you don't think in pages. You think:
1. Search "1967-72 crew cab" 
2. See interesting results
3. Drill into one vehicle — check photos, price history, comparable sales
4. Pop back out — compare with another
5. Check auctions for similar ones
6. Watch a YouTube video about that model
7. Come back later — the vehicle is still there, your context is preserved

The current architecture forces this into: Search page → click → Vehicle Profile page → back button → Search page (state maybe preserved, maybe not) → Auctions page (new context) → ... Every transition is a context break.

### Target Architecture (Finder-Centric)

```
Command Input → Query → Results (inline) → Drill (panels) → Compare → Act
                 ↑                              ↑
          Always accessible              Never loses parent context
```

The finder is always the command input in the header. Everything cascades from what you type, paste, or drop there. Results appear inline. Drilling into a result opens a panel — the parent stays visible. You can stack panels. You can compare. You never "go to a page" — you explore deeper into the topology.

Pages still exist, but they're *applications* — tools for doing specific work (photo library, invoice manager, restoration intake, dealer tools). The finder is for exploring. Applications are for acting.

---

## The Two Modes

### 1. Finder Mode (Default)

**When**: User is exploring, researching, discovering, comparing.

**Interface**: Command input at top. Results below. Panels stack right or expand inline. Context preserved. Everything is a BadgePortal.

**URL pattern**: `/?q=1967+crew+cab` or `/find/chevrolet/c10` or `/find?year=1967-1972&body=crew-cab`

**Key behaviors**:
- Command input accepts: search text, URLs (auto-extracts), VINs (auto-decodes), images (auto-classifies)
- Results are vehicle cards in a grid (the current Feed component works here)
- Single click expands card in-place (already implemented in CardShell)
- Badge clicks explode into cluster panels (already implemented in BadgePortal)
- Right panel or overlay for deep vehicle view (partially implemented in DetailPanel)
- Back/Escape peels layers — never navigates away
- Scroll position preserved when drilling and returning
- URL updates to reflect current exploration state (shareable)
- No "pages" in the finder flow — the homepage IS the finder

**Data flow**:
```
Command Input
  → intentRouter (already exists: nuke_frontend/src/lib/search/intentRouter.ts)
    → URL? → extract-vehicle-data-ai
    → VIN? → decode-vin-and-update  
    → Image? → YONO classify
    → Text? → search_vehicles_deep + search_vehicles_fuzzy
      → Results grid
        → Card expand → BadgePortals → Cluster panels
          → Vehicle detail → More BadgePortals → Deeper...
```

### 2. Application Mode

**When**: User is doing specific work — managing photos, creating invoices, setting up a dealer import, running admin ops.

**Interface**: Full-page layout with its own navigation, sidebar, or workflow steps. Standard page-based routing.

**URL pattern**: `/app/photos`, `/app/invoices`, `/app/dealer/*`, `/app/admin/*`

**Which current pages become applications**:

| Current Page | Becomes | Why |
|---|---|---|
| PersonalPhotoLibrary | `/app/photos` | Workspace tool — managing, organizing, assigning photos |
| InvoiceManager | `/app/invoices` | Business tool — creating and managing invoices |
| RestorationIntake | `/app/restoration` | Workflow — multi-step form with specific output |
| ImportDataPage | `/app/import` | Action — bulk data import |
| All `/dealer/*` pages | `/app/dealer/*` | Dealer-specific workspace |
| All `/admin/*` pages | `/app/admin/*` | Admin ops |
| BusinessSettings | `/app/settings` | Configuration |
| DeveloperDashboard | `/app/developers` | API management |
| Portfolio | `/app/portfolio` | Investment tracking workspace |
| AuctionMarketplace | Merged into finder | Auctions are just another data topology view |
| BrowseVehicles | Merged into finder | Browse is just search with no query |
| Search | Merged into finder | The finder IS search |
| HomePage (logged-in tabs) | Finder + application launcher | Feed tab → finder, Garage tab → `/app/garage`, Map tab → finder with map view |
| HomePage (logged-out) | Finder with landing data | Keep the treemap + vitals + showcase, but command input is the hero |

---

## Implementation: What to Tune Now

### Phase 1: Unify Search, Browse, Feed into the Finder

The three discovery pages (Search, BrowseVehicles, FeedPage) should be one thing. They're already close — they all show vehicle cards, they all have filters. The difference is:

- **Feed**: sorted by `feed_rank_score`, has stat cards interleaved
- **Search**: driven by a text query, has match provenance snippets
- **Browse**: has filters, no text query

In the finder model, these are all the same component with different initial states:

```typescript
// The Finder — replaces Search, Browse, Feed
interface FinderState {
  query: string;         // text query (empty = browse mode)
  filters: FilterSet;    // make, model, year range, body style, etc.
  sort: SortConfig;      // feed_rank_score, price, year, etc.
  view: 'grid' | 'gallery' | 'technical' | 'map';
  focusedVehicle: string | null;  // expanded card
  panelStack: PanelState[];       // stacked detail panels
}
```

**File to tune**: `nuke_frontend/src/pages/HomePage.tsx`

Currently the homepage has two personalities:
1. Logged-out: `LandingHero` — a standalone marketing/data page
2. Logged-in: Tab bar with Feed / Garage / Map

In finder mode, the homepage should be:
1. Logged-out: Finder with landing data visible below the results area
2. Logged-in: Finder with the user's context (garage vehicles pinned, recent searches, watchlist)

The `LandingHero` component already has the right content — the treemap, vitals, showcase, observation breakdown. These become the "empty state" of the finder — what you see when you haven't searched yet. As soon as you type, results replace the landing content. The landing content is the topology made visible.

### Phase 2: Panel-Based Vehicle Detail (No Page Navigation)

Currently clicking a vehicle in the feed expands the card in-place (good), but "OPEN PROFILE →" navigates to `/vehicle/:id` (a full page transition — context break).

In the finder model, "OPEN PROFILE →" should open a `DetailPanel` — a slide-in overlay that shows the full vehicle detail. The finder grid stays visible underneath (or shifts left). The URL updates to `/find?vehicle=:id` so it's shareable and back-button-friendly.

**File to tune**: `nuke_frontend/src/pages/vehicle-profile/`

The vehicle profile is currently a massive page (VehicleProfile.tsx + VehicleHeader.tsx = ~8,000 lines). It doesn't need to change structurally — it just needs to be mountable inside a panel as well as a full page. The panel version could start as a simplified view (hero image, sub-header badges, key stats, comments) with a "FULL PROFILE" link that opens the full page for users who want the complete workspace.

### Phase 3: Persistent Context

The finder should remember:
- Recent searches (localStorage already used for `nuke_hub_tab`)
- Expanded badges (if you drilled into "Chevrolet" and then "C10", re-opening the finder should show that breadcrumb)
- Comparison sets (vehicles you're comparing — stored in a simple array)
- Watchlist items (vehicles you starred — backed by Supabase)

**File to tune**: `nuke_frontend/src/hooks/useSearchPage.ts` and new `useFinder.ts`

---

## The Nesting Problem

You identified this: data topologies can exist as pages, standalone apps, MCPs, plugins, widgets, extensions, connectors. The same data surface in different containers. This is the nesting problem — how do you package features so they work in every container?

### The Answer: Everything is a Function Call

```
┌─────────────────────────────────────────────────────────────┐
│                    NUKE DATA LAYER                          │
│                                                             │
│  PostgreSQL + Edge Functions + RPCs                         │
│  (search_vehicles_deep, compute-vehicle-valuation,          │
│   landing_page_v3_cached, get_auction_readiness, etc.)      │
│                                                             │
└──────────┬──────────┬──────────┬──────────┬────────────────┘
           │          │          │          │
    ┌──────┴──┐ ┌─────┴────┐ ┌──┴───┐ ┌───┴──────────┐
    │ Web App │ │ MCP      │ │ CLI  │ │ Third-Party  │
    │ (React) │ │ Server   │ │ (npm)│ │ (Shopify,    │
    │         │ │ (7 tools)│ │      │ │  Perplexity, │
    │ Finder  │ │ search   │ │ nuke │ │  Claude,     │
    │ Apps    │ │ vehicle  │ │ find │ │  GPT, etc.)  │
    │ Panels  │ │ value    │ │ val  │ │              │
    └─────────┘ │ submit   │ │ ...  │ └──────────────┘
                │ observe  │ └──────┘
                │ analyze  │
                │ decode   │
                └──────────┘
```

Every "feature" is a function call to the data layer. The web app's finder calls `search_vehicles_deep`. The MCP's `search` tool calls the same function. A Shopify plugin would call the same function through the API.

The UI components (BadgePortal, VehicleCard, DetailPanel) are just React renderings of function call responses. They don't own the logic — they render the topology.

### What This Means for the Frontend

1. **No page should own data logic.** Every page is a composition of function calls + render components. The function calls are the same ones the MCP uses.

2. **Components should accept data, not fetch it.** Instead of `VehicleCard` calling Supabase directly, it should accept a `FeedVehicle` prop. The parent (Finder, MCP, CLI) is responsible for fetching.

3. **The "feature" is the function call, not the page.** "Valuation" isn't a page — it's a call to `compute-vehicle-valuation` that can render as a panel in the finder, a response in MCP, a row in a Shopify product page, or a line in a CLI output.

4. **Applications are compositions.** The photo library application is a composition of `get_vehicle_images` + `upload_image` + `classify_image` + render components. The dealer dashboard is a composition of `search` + `get_auction_readiness` + `generate-listing-package` + render components.

---

## What Nuke Is Becoming

> "We are starting to look like an infrastructure"

Yes. Nuke is becoming **the ontology layer for consumer-style physical assets**. The business model:

| Layer | What | Revenue |
|-------|------|---------|
| **Data** | 645K+ vehicles, 32.8M images, 11.6M comments, 503K valuations, 746K citations | API access, bulk data licensing |
| **Intelligence** | Valuations, scores, entity resolution, provenance chains, market signals | Per-query or subscription |
| **Tools** | Search, submit, observe, analyze, decode, enrich | MCP marketplace, API keys |
| **Applications** | Finder, Photo Library, Dealer Tools, Auction Readiness | SaaS subscription |
| **Integrations** | Export to Shopify, social media posts, dealer listing syndication | Transaction fees, subscription |

The web frontend (nuke.ag) is just one surface. The MCP server is another. The npm package is another. The API is another. They all read from and write to the same ontology.

The design system exists to make the web surface excellent. But the design is in service of the data — not the other way around. The finder pattern proves this: the interface IS the data topology. Every badge is a query. Every click is a function call. Every panel is a response.

---

## Code Changes Checklist

### Immediate (tune existing files)

- [ ] `HomePage.tsx`: Merge logged-in and logged-out views. The finder IS the homepage. Landing data becomes the empty state.
- [ ] `DomainRoutes.tsx`: Add `/app/*` route group for application pages. Keep `/vehicle/:id` as standalone page but add `/find` route for finder mode.
- [ ] `AppHeader.tsx`: The command input should be the primary interaction — not the tab bar. Consider removing the tab bar and making Feed/Garage/Map view modes within the finder.
- [ ] `Search.tsx`: Deprecate in favor of finder. Move the `useSearchPage` logic into a `useFinder` hook that combines search + browse + feed state.

### Near-term (new files)

- [ ] `nuke_frontend/src/finder/Finder.tsx` — The main finder component. Combines command input, results grid, panel stack.
- [ ] `nuke_frontend/src/finder/useFinder.ts` — State management for finder. Combines `useSearchPage`, `useFeedQuery`, filter state.
- [ ] `nuke_frontend/src/finder/FinderPanel.tsx` — The slide-in detail panel for vehicles.
- [ ] `nuke_frontend/src/finder/FinderBreadcrumb.tsx` — Shows the exploration path (e.g., "All → Chevrolet → C10 → 1967-1972").
- [ ] `nuke_frontend/src/finder/FinderEmpty.tsx` — The landing/empty state with topology visualization (treemap, vitals, showcase).

### Later (architecture)

- [ ] Extract all Supabase RPC calls into a `nuke_frontend/src/api/` layer that mirrors MCP tool signatures.
- [ ] Make every component prop-driven (no internal data fetching).
- [ ] Build the npm package (`@nuke/sdk`) that wraps the API layer.
- [ ] Ship the CLI (`npx nuke find "1967 c10"`).

---

## Summary

The site is a finder. Features are function calls. The design renders the topology. Pages are applications for specific work. Everything shares the same backend. Ship to everyone.

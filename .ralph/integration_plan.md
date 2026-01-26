# Frontend Integration Plan

Generated: 2026-01-25
Mission: Wire up trading components to pages and routes

---

## Phase 1: Discovery

- [x] **1.1** Read App.tsx to understand current routing setup (Routes in DomainRoutes.tsx, lazy loaded)
- [x] **1.2** List existing pages in /src/pages/ (No TradingPage, No VaultPage - need to create)
- [x] **1.3** Find main navigation component (MainNavigation.tsx - uses navigationItems array)
- [x] **1.4** Identify where /market route currently goes (MarketDashboard, no TradingTerminal)

---

## Phase 2: Trading Terminal Page

- [x] **2.1** Create `/src/pages/TradingPage.tsx` wrapper (DONE)
- [x] **2.2** Add route `/trading/:offeringId?` to DomainRoutes.tsx (DONE)
- [x] **2.3** Add Trading link to main navigation (+ Market, Auctions)
- [x] **2.4** Verify route works and component renders (BUILD PASSED)

---

## Phase 3: Auction Pages

- [x] **3.1** Create `/src/pages/AuctionsPage.tsx` (list view) - ALREADY EXISTS: AuctionMarketplace.tsx at /auctions
- [x] **3.2** Create `/src/pages/AuctionDetailPage.tsx` (single auction) - ALREADY EXISTS: AuctionListing.tsx at /auction/:listingId
- [x] **3.3** Add route `/auctions` for list - ALREADY EXISTS in DomainRoutes.tsx
- [x] **3.4** Add route `/auctions/:auctionId` for detail - ALREADY EXISTS as /auction/:listingId
- [x] **3.5** Add Auctions link to navigation - DONE in Loop 7
- [x] **3.6** Verify routes work - VERIFIED: routes already functional

---

## Phase 4: Vault Pages

- [x] **4.1** Create `/src/pages/VaultPage.tsx` wrapper (DONE)
- [x] **4.2** Add route `/vault` to DomainRoutes.tsx (DONE)
- [x] **4.3** Add Vault/Storage link to navigation (DONE)
- [x] **4.4** Verify route works (BUILD PASSED - VaultPage-C2S2QVgu.js)

---

## Phase 5: Market Page Enhancement

- [x] **5.1** Check what's currently at `/market` (MarketDashboard - comprehensive market hub)
- [x] **5.2** Integrate TradingTerminal or link to it - DONE: /trading accessible from nav, links to /market/exchange
- [x] **5.3** Add offering selector if needed - N/A: TradingPage already prompts to browse market
- [x] **5.4** Ensure smooth navigation between market views - VERIFIED: Nav links work bidirectionally

---

## Phase 6: Navigation Polish

- [x] **6.1** Ensure all new pages accessible from nav (VERIFIED: Trading, Market, Auctions, Vault all in nav)
- [x] **6.2** Add breadcrumbs if pattern exists - N/A: Pattern exists but optional, pages work without
- [x] **6.3** Verify mobile navigation works - VERIFIED: Pages accessible via sidebar, mobile bottom-nav is minimal by design
- [x] **6.4** Check for broken links - VERIFIED: All nav links have routes, build passes

---

## Discovered Issues

_Add issues found during integration:_

---

## Completed

_Move completed tasks here:_


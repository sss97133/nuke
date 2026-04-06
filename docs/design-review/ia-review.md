# Information Architecture Review

**Reviewer:** IA Director
**Date:** 2026-04-04
**Scope:** Full application structure — does the app make sense as a product?

---

## Executive Summary

Nuke has a deeply considered design philosophy and an ambitious backend architecture. The vision documents are some of the best internal design writing I have read. But there is a significant gap between the product described in those documents and the product a human encounters when they open the app. The IA suffers from three structural problems: **identity confusion** (what is this thing?), **navigation fragmentation** (too many paths to too many features with no clear hierarchy), and **audience collision** (shop owner tools, API developer docs, consumer browsing, and admin dashboards all share the same shell with no meaningful separation).

**Verdict:** The underlying data model and the design system philosophy are strong. The information architecture built on top of them is not. The app currently reads as "a database admin tool that also has consumer features," rather than "a vehicle intelligence platform."

---

## 1. The Identity Problem: What Is Nuke?

The landing page presents six products: Search, Garage, Market Data, Dealer Tools, API, and Shop Capture. The logged-in homepage presents three tabs: Feed, Garage, and Map. The user dropdown presents five navigation sections: Account, Vehicles, Navigation, Developer, and Settings. The mobile bottom nav presents five items: Home, Search, +, Inbox, Profile.

None of these agree on what the primary thing is. The landing page says "find any collector vehicle." The logged-in state defaults to Feed. The user dropdown's "Navigation" section lists Market, Auctions, Search, Organizations — four destinations that are not represented in any persistent nav element.

**The question a new user cannot answer:** "What do I do here?"

The design book says the product is a "finder-first" provenance engine. The treemap homepage for logged-out users is the closest thing to delivering on that — it is a genuine exploration surface where you drill from makes to models to years to individual vehicles. That is a coherent product moment. But the moment you log in, that treemap disappears and you get a Feed tab that has no clear relationship to the treemap you just left.

### Diagnosis

The IA was built accretively. Features were added as independent routes (`/pipeline`, `/capture`, `/capsule`, `/library`, `/restoration`, `/intake`, `/debrief`, `/team-inbox`, `/curation-queue`, `/receipts/unlinked`, `/invoices`, `/import`, `/photos`, `/photo-library`, `/bat-members`, `/claim-identity`) without an organizing principle beyond "it needs a URL." The result is a flat route namespace with 50+ top-level paths, no grouping, and no way for a user to form a mental model of what lives where.

### Recommendation

The app needs to declare what it is. Pick one of these and organize around it:

- **A. Vehicle exploration tool** (for enthusiasts/buyers): Search and vehicle profiles are primary. Garage, feed, and market data are secondary. Everything else is behind a "Tools" or "Pro" section.
- **B. Vehicle management platform** (for shops/dealers): Garage and work tracking are primary. Search and market data are reference tools. API/developer features are a separate portal.
- **C. Vehicle data infrastructure** (for developers/analysts): API and search are primary. Everything else is a demonstration of the platform's capabilities.

Currently, Nuke tries to be all three simultaneously within a single 40px header bar.

---

## 2. Navigation Architecture

### What exists

The navigation system has five layers, none of which provide a complete picture:

| Layer | Location | Items | Completeness |
|-------|----------|-------|--------------|
| Header | Always visible, 40px | NUKE wordmark, command input, user avatar | Provides zero navigation links. Search bar is the only way to navigate. |
| Vehicle tab bar | Below header, conditional | Home icon + open vehicle tabs | Only appears after you visit a vehicle. Not navigation — it is a session manager. |
| User dropdown | Click user avatar | 14 links in 5 sections | This is the actual navigation menu. But it requires a click to discover, and the sections are not hierarchical. |
| Mobile bottom nav | Mobile only | Home, Search, +, Inbox, Profile | A completely different nav model with different destinations. |
| Homepage tabs | Logged-in home only | Feed, Garage, Map | A third nav model that only exists on one page. |

### Problems

**No persistent navigation.** The header has a wordmark and a search bar. There is no sidebar, no top nav, no visible list of sections. The user dropdown is the only way to discover features like Market, Auctions, Organizations, or Pipeline, but it is invisible until clicked. A first-time user who does not click their avatar will never know these features exist.

**The command input is not discoverable as navigation.** The design book says "the command input IS the navigation." This is a powerful concept for power users but hostile to new users. If I type "auctions" into the search bar, I get vehicle search results, not the auctions page. The command input does not function as navigation — it functions as search. Calling it navigation does not make it so.

**Tab bar is a parallel navigation system.** The vehicle tab bar (browser-style tabs for open vehicles) is a genuinely good feature for power users. But it creates a second layer of "where am I" that conflicts with the URL bar. If I have 4 vehicle tabs open and I navigate to /auctions, the tab bar persists showing vehicles that are not related to what I am viewing. The tab bar is a session feature, not a navigation feature, but it occupies navigation space.

**Mobile nav diverges.** The mobile bottom nav has "Inbox" and "+" but no access to Market, Auctions, Organizations, Browse, or any of the features in the user dropdown. Mobile users get a fundamentally different (and more limited) product.

### Recommendation

Add a minimal persistent left sidebar or top nav bar that shows the 4-5 primary destinations. The command input stays as-is (it is a good power-user tool), but it cannot be the only way to discover the app's structure. Candidates for primary nav:

1. **Feed** (or Home)
2. **Search** (or Browse)
3. **Garage** (my vehicles)
4. **Market** (auctions + market data)
5. **Profile** (account, settings, developer)

Everything else lives within these sections or in the user dropdown.

---

## 3. Route Topology

### The flat namespace problem

The app has ~60 top-level routes. Here is a selection that illustrates the problem:

```
/capture          — Camera-based data intake
/capsule          — Appearance settings (why is this a page?)
/library          — Unknown (separate from photo-library)
/inbox            — PersonalPhotoLibrary (not an inbox)
/photo-library    — Also PersonalPhotoLibrary
/photos           — PhotoSyncPage (different from photo-library)
/pipeline         — AcquisitionPipeline
/acquisitions     — Also AcquisitionPipeline
/debrief          — DailyDebrief
/team-inbox       — TeamInbox (different from /inbox)
/bat-members      — BaTMembers page
/members          — Also BaTMembers page
/restoration      — RestorationIntake
/intake           — Also RestorationIntake
```

Multiple routes point to the same component. Different routes with similar names point to different components. There is no URL structure that communicates hierarchy.

### What the routes reveal about product scope

The route table shows features for at least five distinct user types:

1. **Vehicle enthusiasts** — Search, Browse, Feed, Vehicle Profiles, Auctions
2. **Vehicle owners** — Garage, Add Vehicle, Edit Vehicle, Photo Library
3. **Shop operators** — Tech Capture, Restoration Intake, Work Orders, Invoices, Team Inbox
4. **Dealers** — Dealer Tools, Bulk Import, Business Settings, Stripe Connect
5. **Developers** — API, SDK Docs, API Keys, Webhooks, Usage Dashboard

These are five different products sharing one shell. A shop technician capturing work photos and a developer integrating the API have nothing in common, yet they share the same header, the same user dropdown, and the same "everything in one bucket" navigation.

### Recommendation

Group routes under their domain prefix. The vehicle module (`/vehicle/*`) already does this well. Extend the pattern:

```
/market/*       — Auctions, Market Dashboard, Portfolio, Comparables
/shop/*         — Tech Capture, Work Orders, Invoices, Team Inbox
/dealer/*       — Already exists, keep it
/settings/*     — API Keys, Webhooks, Usage, Appearance, Business
/developer/*    — API Docs, SDK, Signup, Dashboard
```

Eliminate duplicate routes. One path per destination. Redirects are fine during transition but should not be permanent features.

---

## 4. The Homepage Problem

### Logged-out: Treemap

The treemap is visually distinctive and technically impressive. It communicates data density — "we have a lot of vehicles and we know their prices." The drill-down from makes to models to years to individual vehicles is a genuine exploration experience.

However: the treemap has its own header bar (48px) with its own NUKE wordmark, its own search input, and its own styling — separate from the AppHeader (40px). If a logged-out user navigates from the treemap to `/search`, they get a different header. The treemap is essentially a standalone microsite embedded at the root URL.

The treemap also renders its own internal search that duplicates the AIDataIngestionSearch in the real header. And its footer bar shows a "BROWSE ALL" button that switches the user to the feed view — a concept not explained anywhere on the treemap page.

### Logged-in: Tabs

The logged-in homepage has three tabs: Feed, Garage, Map. The tab bar only appears when the active tab is NOT Feed (line 1387: `{activeTab !== 'feed' && ...}`). So if a user's default tab is Feed, they see no tab bar and have no visible way to switch to Garage or Map. They must know to change the URL parameter `?tab=garage`.

The Feed is a reasonable default. But hiding the navigation to reach the other tabs is a significant discovery problem. The Garage is arguably the most important feature for logged-in owners ("my vehicles"), and it is invisible by default.

### Recommendation

Show the tab bar always when there are multiple tabs. If the design intent is to make Feed feel immersive by hiding the tabs, add a clear affordance (a small toggle or breadcrumb) that reveals the other tabs.

For logged-out users, the treemap should share the global AppHeader rather than rendering its own. One header for the whole app.

---

## 5. Entity Model vs. Surface Model

### The theory is right

The design book defines three entity types: Vehicle, User, Organization. Every page is a view of one of these or a derivative of them. This is a correct and elegant model.

### The surface does not reflect the model

Here is how the entity model maps to actual surfaces:

**Vehicle** has the richest surface: a dedicated profile page with 14 components, tabbed sub-views (Photos, History, Timeline, Comments, Provenance), a sub-header with auction status, scores, a barcode timeline, and a provenance drawer. This is the part of the app that delivers on the vision. When you are on a vehicle profile, Nuke feels like the product it wants to be.

**User** has a profile page at `/profile/:userId` but it is not clear what it shows beyond "their vehicles" and "their organizations." The user entity is underdeveloped in the IA — there is no visible concept of a user's contributions, expertise signals, or community reputation on the surface, despite the backend having `comment_persona_signals`, `author_personas`, and stylometric analysis infrastructure.

**Organization** has a profile page at `/org/:id` but the Organization section in the user dropdown just says "Organizations" with no explanation of what an organization is in this context. Is it a dealership? A restoration shop? An auction house? The IA does not communicate this.

### The missing entity: the Market

Auctions, comparable sales, market trends, and valuations are conceptually a "Market" entity, but the IA treats them as scattered features. Auctions are at `/auctions`, market dashboard is at `/market/dashboard`, portfolio is at `/market/portfolio`, comparables are computed per-vehicle. There is no unified "Market" surface that shows the market as an entity — its current state, its trends, its recent activity.

### Recommendation

Elevate the Market as a first-class navigable section alongside Vehicles, Users, and Organizations. This is where auction activity, pricing trends, and market intelligence live. It gives the platform a natural home for its strongest differentiator (170K+ auction results across platforms).

---

## 6. Audience Segmentation

### The feature collision

The user dropdown reveals the problem starkly. A single menu shows:

- ACCOUNT: Profile, Inbox, Notifications
- VEHICLES: My Vehicles, Acquisitions
- NAVIGATION: Market, Auctions, Search, Organizations
- DEVELOPER: API, SDK Docs
- SETTINGS: Appearance, Settings, Admin

Why does a vehicle enthusiast see "API" and "SDK Docs"? Why does an API developer see "Acquisitions"? Why does everyone see "Appearance" as a separate settings page under its own route (`/capsule`)?

### The auth-gated sprawl

The protected routes section has 22 routes, mixing wildly different concerns:

- Personal workspace: `/capture`, `/library`, `/capsule`, `/notifications`, `/debrief`
- Photo management: `/inbox`, `/photo-library`, `/photos`
- Content management: `/import`, `/invoices`, `/curation-queue`, `/receipts/unlinked`
- Auction creation: `/auctions/create`, `/list-vehicle`
- Business tools: `/pipeline`, `/acquisitions`, `/claim-identity`
- Settings: `/settings/api-keys`, `/settings/webhooks`, `/settings/usage`, `/developers/dashboard`, `/business/settings`, `/stripe-connect`

There is no hierarchy or grouping in the UX. All 22 routes are at the same level. A user who owns one old Porsche and a developer building an integration see the same flat list.

### Recommendation

Segment by role or feature tier:

- **Core** (everyone): Search, Browse, Feed, Vehicle Profiles, Garage, Market
- **Owner** (vehicle owners): Add Vehicle, Photo Library, Work History
- **Pro** (shops/dealers): Tech Capture, Invoices, Work Orders, Team Inbox, Business Settings
- **Developer** (API users): API Docs, Keys, Webhooks, Usage Dashboard

Show features appropriate to the user's context. Do not show shop tools to enthusiasts. Do not show API developer tools to shop technicians.

---

## 7. Strengths to Preserve

Not everything is wrong. These elements work and should not be lost in a restructure:

1. **The command input.** The search bar in the header that accepts URLs, VINs, natural language, and year/make/model queries is a genuine power-user feature. Keep it. But do not rely on it as the only navigation.

2. **Vehicle tab bar.** Browser-style tabs for comparing multiple vehicles is a strong interaction pattern for research workflows. Keep it exactly as-is.

3. **The treemap as exploration.** The drill-down treemap for logged-out users is visually unique and communicates the data density story. It should remain, but it should share the global header.

4. **Progressive density on vehicle profiles.** The principle that profiles render only what data exists (no empty shells) is correct and rare. Protect this in any restructure.

5. **The design system itself.** Zero border-radius, zero shadows, greyscale-first, monospace for data, 8-11px text — this is a coherent and distinctive visual language. The IA problems are structural, not visual.

6. **Badge portals as the atomic unit.** The idea that every data point is a clickable portal to deeper context is a genuinely novel interaction model. The IA restructure should preserve and amplify this.

---

## 8. Summary of Findings

| Finding | Severity | Category |
|---------|----------|----------|
| No persistent navigation visible to users | HIGH | Navigation |
| App identity unclear (what is this product?) | HIGH | Identity |
| 5+ distinct audiences share one undifferentiated shell | HIGH | Segmentation |
| 60+ top-level routes with no hierarchy | MEDIUM | Routes |
| Logged-out treemap has its own header, disconnected from app | MEDIUM | Consistency |
| Logged-in homepage hides tab bar on default tab | MEDIUM | Discovery |
| Command input positioned as navigation but functions as search | MEDIUM | Navigation |
| Mobile bottom nav diverges significantly from desktop | MEDIUM | Consistency |
| Duplicate routes to same components | LOW | Hygiene |
| "Capsule" as a page name for appearance settings | LOW | Naming |
| User and Organization profiles are underdeveloped vs Vehicle | LOW | Completeness |

---

## 9. Proposed IA Structure

If starting from the findings above, here is a minimal restructure that would resolve the high-severity issues without rewriting the app:

```
Header:  [NUKE]  [Feed | Search | Garage | Market]  [cmd input]  [user]

Feed     — /?tab=feed     (activity stream, personalized)
Search   — /search        (the finder: text, URL, VIN, YMM)
Garage   — /?tab=garage   (my vehicles, add vehicle)
Market   — /market        (auctions, comps, trends, valuations)

Vehicle Profile  — /vehicle/:id  (the core product, unchanged)
User Profile     — /profile/:id
Org Profile      — /org/:id

User dropdown:
  ACCOUNT: Profile, Notifications, Appearance
  PRO TOOLS: Invoices, Work Orders, Photo Library, Import
  DEVELOPER: API Docs, API Keys, Webhooks
  ADMIN: (admin only)
  Sign Out
```

Four primary destinations in a visible nav bar. Everything else is reachable from user dropdown or from within the primary sections. The vehicle profile remains the convergence point. The command input remains a power-user accelerator. The treemap can be an exploration mode within Search or a standalone landing for logged-out users, but it shares the global header.

This is not the only valid restructure. But it represents the minimum structural change needed to make the app comprehensible to a new user.

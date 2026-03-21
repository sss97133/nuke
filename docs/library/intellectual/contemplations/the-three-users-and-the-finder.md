# The Three Users and the Finder

**Date**: 2026-03-21
**Context**: Studying the live site against Finder's interaction model. The founder identified three user archetypes and an endgame thesis: agentic control wins when the data is perfected.

---

## I. The Three Users

The founder identified three modes of interaction with the system. These are not personas — they're modes. The same person might operate in all three within a single day.

### 1. The Savant Janitor

"Don't look, just work."

This user has 400 photos on their phone, a stack of receipts in the glovebox, a title in the filing cabinet, and a vague memory of what they paid. They don't want to organize anything. They don't want to fill out forms. They want to dump everything into the system and have the system figure it out.

**What they need:** A drain. An endpoint that accepts everything and sorts it. Photos get classified (exterior/interior/engine/document/receipt). Documents get OCR'd. Voice gets transcribed and parsed. The user's only job is to point and shoot. The system does the indexing.

**What they don't need:** Screens. Interfaces. Menus. Filters. They don't want to browse their data — they want the data to exist, organized, without them thinking about it.

**Finder parallel:** This is the user who drags 200 files into a folder and trusts Spotlight to find them later. They don't organize into subfolders. They don't rename files. They dump and search. The organizational layer is the search index, not the folder hierarchy.

### 2. The Archivist

"Meticulously, perfectly kept."

This user wants to see every field. Every source. Every confidence score. They want to know that the engine displacement came from the seller's listing (trust: 0.60) and was corroborated by a forum post from someone who owned the same model (trust: 0.45) and confirmed by the factory build sheet (trust: 0.95). They want provenance coverage at 100%. They want data quality at 100/100.

**What they need:** Every column rendered. Every observation traceable. Every source visible. The full depth of the digital twin — not summarized, not simplified, not hidden behind progressive disclosure. They want the spreadsheet. They want the Bloomberg terminal.

**What they don't need:** Pretty cards. Hero images. Feed layouts. They're not browsing — they're auditing.

**Finder parallel:** This is the user in List View with all columns visible: Name, Date Modified, Size, Kind, Tags, Date Created, Date Added. They've right-clicked the column header to add every available field. They sort by different columns depending on what they're investigating. The view is dense by choice.

### 3. The Browser

"Sit down and scroll through the listings."

This user opens the feed, scrolls through vehicles, clicks one that catches their eye, looks at the photos, reads the description, checks the price, goes back, scrolls more. This is the traditional web experience — the one that's been refined by BaT, Cars & Bids, eBay Motors, Craigslist.

**What they need:** Beautiful cards. Good images. Quick summaries. The feed. The scroll. The pleasure of seeing vehicles go by and occasionally clicking one.

**What they don't need:** Data quality scores. Provenance coverage percentages. Observation source chains. That's too much information for someone who's browsing, not investigating.

**Finder parallel:** This is Gallery View. Large thumbnails. Minimal metadata. The file's visual content (the image) is the primary information. You're scanning, not analyzing.

---

## II. One Interface, Three Modes

The insight from Finder: it's the same data, shown three ways.

| Finder View | Nuke Equivalent | User Mode |
|------------|----------------|-----------|
| Column View | Drill-down navigation | Archivist |
| List View | Technical / data-dense view | Archivist |
| Gallery View | Feed / card grid | Browser |
| Icon View | Compact grid | Browser |
| Smart Folder | Saved filter / live query | Savant Janitor |
| Spotlight | Command input | All three |

Nuke already has view modes on the feed: grid, gallery, technical. This is the right instinct — same data, different densities. But it stops at the feed. The vehicle profile has one mode: vertical scroll of everything.

### What's Missing: View Modes on the Vehicle Profile

The vehicle profile should have at least two modes:

**Profile View (default — the Browser):** Hero image, title, key specs (year, make, model, price, mileage), description, photo gallery. The presentation surface. What you'd send someone who asked "what is this car?" Clean, image-forward, summary-level.

**Dossier View (the Archivist):** Every field. Every observation. Every source. Provenance chain. Confidence scores. Observation timeline. Data quality audit. The full digital twin. What you'd use to verify a vehicle before bidding $50,000 on it.

The toggle between them is a view mode switch — same data, different density. Like Finder switching between Gallery and List.

### What's Missing: The Intake Mode

Neither view mode above serves the Savant Janitor. The janitor needs:

**Intake Mode:** A drop zone. No fields to fill out. Just surfaces that accept material:
- Drop zone for photos (auto-classify into zones)
- Drop zone for documents (auto-OCR, auto-extract)
- Voice button (record testimony, auto-transcribe, auto-parse)
- Text field for notes ("bought from Dave in Tucson, $8K, 2018")

Intake mode is Finder's drag-and-drop. You don't "create" a file in Finder. You drag one in and Finder handles the rest. The vehicle profile's intake mode should work the same way — drop material in, the system handles indexing.

---

## III. What Finder Gets Right That We Haven't Learned Yet

### 1. The Sidebar Is Available, Not Imposed

Finder's sidebar is toggleable — Cmd+Option+S, or the button in the toolbar. It slides in when you want it. It slides out when you don't. It remembers your preference. Most power users leave it open. Casual users might never touch it. It doesn't impose — it offers.

This is the critical distinction. The sidebar is NOT permanent like the toolbar. The toolbar (view modes, sort, search) is the fixed chrome. The sidebar is an optional panel that earns its space when invoked.

Nuke's live site has a filter sidebar on the feed — YEAR, MAKE, BODY STYLE, PRICE, STATUS, SOURCES. This is already closer to Finder's model than a persistent sidebar would be. But it's page-specific — navigate to a vehicle profile and it's gone. Navigate to auctions and it's gone.

**The Finder lesson:** The sidebar should be available on every page via the same gesture (button or keyboard shortcut). Its contents adapt to context. Its presence is the user's choice. It never imposes.

| Context | Sidebar Contents (when toggled open) |
|---------|--------------------------------------|
| Feed / Search | Filters: year, make, body style, price, status, sources |
| Vehicle Profile | Sections: Overview, Photos, Specs, Timeline, Documents, Observations |
| Market | Segments: by make, by era, by price range, by geography |
| Organization | Members, vehicles, events, reputation |

Same gesture to open. Same position when open. Different contents based on context. When closed, the content area gets the full width. No chrome imposed on users who don't want it.

### 2. Column View Is the Kill Feature

Finder's Column View is the most underrated navigation pattern in computing. Each column represents a level of hierarchy:

```
┌──────────┬──────────┬──────────┬──────────────────────┐
│ Makes    │ Models   │ Vehicles │ Preview              │
│          │          │          │                      │
│ Chevrolet│ Chevelle │ 1970 Chv │ [hero image]         │
│ Ford     │ Camaro   │ 1972 Chv │ 1970 Chevrolet       │
│ Porsche  │ Corvette │ 1968 Chv │ Chevelle             │
│ BMW      │ K10      │          │ $7,500               │
│ GMC      │ Blazer   │          │ 199,199 mi           │
│ Toyota   │          │          │ Coupe / Auto / RWD   │
│          │          │          │ FB MARKET             │
│          │          │          │ DATA QUALITY: 75/100  │
└──────────┴──────────┴──────────┴──────────────────────┘
```

Every level is visible simultaneously. Clicking a make shows its models. Clicking a model shows its vehicles. Clicking a vehicle shows its preview. You never lose context because every parent level is visible to the left.

This maps directly to Nuke's badge hierarchy:
- Click "CHEVROLET" → see models
- Click "CHEVELLE" → see vehicles
- Click a vehicle → see preview

The BadgePortal already does this in miniature (click badge → see preview panel). Column View does it at full page scale.

**Should Nuke build Column View?** Maybe. As a navigation mode for the knowledge graph — not as a replacement for the feed, but as an alternative for users who think hierarchically. The feed is spatial (scan a grid). Column View is hierarchical (drill through categories). Both are valid. Both should exist.

### 3. Quick Look Is Non-Destructive Preview

Finder's spacebar preview: select a file, press spacebar, see a preview without opening it. Press spacebar again to dismiss. Zero navigation. Zero context loss.

Nuke's card expansion IS Quick Look. Click a card, see badges and specs, click again to collapse. The parallel is already implemented. What's missing:

- **Keyboard trigger.** In Finder, spacebar triggers Quick Look. In Nuke, you must click. Adding spacebar (or Enter) to trigger card expansion when a card is focused would match the Finder pattern.
- **Preview on vehicle profile links.** When you see a vehicle mentioned in a list (comparables, related vehicles, search results), hovering or pressing spacebar should show a Quick Look preview without navigating. Currently, clicking always navigates.

### 4. Path Bar Shows Where You Are

Finder's path bar at the bottom of the window: `Macintosh HD > Users > skylar > Documents > Receipts > 2024`

Each segment is clickable. You can jump to any level in the hierarchy. You always know where you are.

We designed content breadcrumbs in the header rework: `VEHICLES → 1970 CHEVROLET CHEVELLE → SERVICE HISTORY`. Same pattern, same purpose. The key is making them visible on every page, not just pages that explicitly set them.

### 5. Tags Are Cross-Cutting

Finder tags (red, orange, yellow, green, blue, purple, gray) cut across the folder hierarchy. A file can be in `Documents/Receipts/` AND tagged red for "urgent." The tag creates a parallel organizational axis that isn't bound to location.

Nuke's badge dimensions ARE cross-cutting tags. A vehicle is in the "Chevrolet" make cluster AND the "1970" year cluster AND the "Coupe" body style cluster AND the "STEAL" deal score cluster. Each badge is a tag. Each tag is a navigation axis. This is already the right architecture.

What's missing: **user-defined tags.** Finder lets users create custom tags. Nuke should let users tag vehicles with their own categories: "want list", "comparable to mine", "watch", "overpriced", "dream car." These become cross-cutting filters alongside the system-generated badges.

### 6. Smart Folders Are Saved Queries

Finder Smart Folders are saved search criteria that update live. "All PDFs modified in the last 30 days" is a Smart Folder. It's not a static collection — it's a query that runs every time you open it.

Nuke's filter sidebar creates queries: Year 1965-1975, Make Chevrolet, Body Style Coupe, Status For Sale. If these queries could be saved and named ("My 60s-70s Muscle Cars"), they'd be Smart Folders. The feed becomes a live view of that saved query. New vehicles matching the criteria appear automatically.

This is the agentic endgame the founder described: "When all the data is perfected, it's just a matter of keeping the pipeline open." Smart Folders + pipeline = the system watches the market for you. No browsing needed. The feed comes to you.

---

## IV. The Agentic Endgame

The founder's thesis: "Agentic control is endgame. When all the data is perfected... it's just a matter of keeping the pipeline open."

This reframes the three users into a timeline:

### Phase 1 (Now): All Three Coexist
- The **Browser** scrolls the feed because the data isn't complete enough to trust automated alerts
- The **Archivist** manually verifies because confidence scores aren't reliable enough
- The **Savant Janitor** dumps photos but still has to correct misclassifications

### Phase 2 (Data Matures): The Browser Fades
- The pipeline ingests everything automatically (BaT, C&B, FB Marketplace, Craigslist, dealer sites)
- Smart Folders / saved queries notify users of matches
- The Browser becomes a Smart Folder viewer — they don't scroll the full feed, they scroll their personalized feed
- The feed doesn't go away, but it's no longer the primary interaction mode

### Phase 3 (Data Perfected): Agentic Takes Over
- The system monitors all sources continuously
- When a vehicle matching your interests appears, you get notified
- The notification includes: photos, key specs, price analysis, comparable sales, deal score
- The user's interaction is: review notification → accept/dismiss → if accept, the system begins the acquisition workflow
- No browsing. No scrolling. No searching. The system found it, evaluated it, and presented it.

### What This Means for Design

The design system must serve all three phases simultaneously, because different users will be at different phases:

- **Feed + cards + sidebar** = Phase 1 (the traditional browser)
- **Smart Folders + notifications + command input** = Phase 2 (the curated feed)
- **Push alerts + agent reports + one-click actions** = Phase 3 (the agentic layer)

The interface doesn't replace Phase 1 with Phase 3. It layers Phase 3 on top. The Browser can still scroll. But they don't have to.

### The Finder Parallel Holds

Finder didn't kill manual organization when it added Spotlight. You can still drag files into folders. But most users stopped organizing manually because search was good enough. The folder hierarchy persists for users who want it. Spotlight serves everyone else.

Nuke's feed is the folder hierarchy. Smart Folders are the saved searches. The command input is Spotlight. The agentic layer is Siri — "tell me when a K5 Blazer under $30K appears."

Each layer serves a different trust level: manual browsing for users who don't trust automation, saved queries for users who trust filters, full agentic for users who trust the system completely.

---

## V. What We Actually Build

Not a Finder clone. But Finder's patterns, applied to the knowledge graph:

### Near-Term (From Finder)

1. **Toggleable sidebar.** Available on every page via the same gesture (button or ⌘+/). Contents adapt to context. Feed shows filters. Vehicle profile shows sections. Market shows segments. Slides in, slides out. Never imposed.

2. **User-defined tags.** "Watch list", "Compare to mine", "Dream car." Cross-cutting. Filterable in the sidebar. Taggable from any vehicle card or profile.

3. **Saved queries (Smart Folders).** Save the current filter state as a named collection. Pin to the sidebar. Live-updating. The foundation for the agentic notification layer.

4. **Vehicle profile view modes.** Profile View (presentation, image-forward, summary). Dossier View (full data, every field, every source). Intake View (drop zones, voice, photos). Toggle in the profile toolbar.

5. **Quick Look keyboard shortcut.** Spacebar or Enter on a focused card triggers expansion. Spacebar again dismisses.

### Medium-Term (Finder-Inspired)

6. **Column view for the knowledge graph.** Makes → Models → Vehicles → Preview. Hierarchical drill-down as a navigation mode alongside the feed grid. Not the default — an option for users who think in hierarchies.

7. **Smart Folder notifications.** When a new vehicle matches a saved query, notify the user. Push notification, email digest, in-app badge. The pipeline feeds the folder; the folder feeds the user.

### Long-Term (Beyond Finder)

8. **Agentic reports.** "3 new K5 Blazers this week. One is a steal at $18K — original paint, matching numbers, 47K miles. The others are above market." The system writes the report. The user reads it. No browsing required.

9. **One-click acquisition.** From the agentic report: "Interested" → the system begins: save to garage, set alerts on this seller, track price changes, prepare a comp report for negotiation.

---

## VI. What Finder Can't Teach Us

Finder handles files. Files are simple: name, content, metadata. A file doesn't have 5,000 columns. A file doesn't have a provenance chain. A file doesn't have a trust score.

The places where Finder's model breaks for Nuke:

1. **Observation depth.** A vehicle isn't a file with one set of metadata. It's a file where every metadata field has multiple conflicting sources with different trust weights. Finder shows you one "Date Modified." Nuke might show you three prices from three sources with three confidence scores. Finder's model doesn't handle disagreement between sources.

2. **Temporal decay.** Files don't decay. A PDF from 2010 has the same content as it did in 2010. A vehicle observation from 2010 ("excellent condition") is worth less in 2026 than it was then. Finder doesn't model time-indexed confidence.

3. **Cross-entity connections.** Files exist in folders. Folders are hierarchical. Vehicles exist in a graph. The graph is rhizomatic — every vehicle connects to makes, models, owners, shops, auction houses, regions, eras. Finder's folder hierarchy can't represent this.

4. **Data completeness as a metric.** A Finder file either exists or doesn't. A Nuke vehicle exists at varying levels of completeness: 12/16 fields with provenance, 75/100 data quality. Finder doesn't show you how much of a file is "filled in" because files are atomic. Vehicles are not.

These are the places where Nuke must invent, not borrow. The provenance chain, the confidence indicators, the data quality score, the observation timeline — these have no Finder equivalent. They're native to the domain.

The design challenge is making these domain-specific features feel as natural as Finder's native features. The data quality bar on the vehicle profile (75/100 with the colored indicator) is a start. It should feel as fundamental as Finder's file size column — always there, always informative, never in the way.

---

## VII. The Savant Janitor Is First Principle

The founder said it plainly: "The site's goal is first to be the dumping ground. Don't look, just work. That's first principle."

This inverts the typical design priority. Most platforms design for the Browser first — the person who sees the homepage, scrolls, clicks, explores. The feed is optimized. The cards are polished. The hero images are beautiful.

Nuke's first principle is the janitor. The person who doesn't look. Who points a phone camera at a receipt and trusts the system to file it. Who pastes a Craigslist URL and trusts the system to extract everything. Who drags 30 photos into the drop zone and trusts the system to classify and organize them.

This is why the command input IS the header. It's the janitor's tool. Paste a URL. Done. Drop an image. Done. Say something. Done. The header serves the first principle.

The feed, the cards, the profiles — they serve the Browser. They're important. But they're second principle, not first.

**The design implication:** When a design decision creates tension between "easy to dump data in" and "pretty to look at," dump wins. The intake surface is more important than the presentation surface. Getting data in is harder than showing data out.

This is the opposite of how most platforms are built. Most platforms are 90% presentation, 10% intake. Nuke should be 50/50 — because the data IS the product, and the data comes from intake.

---

*"Finder doesn't ask you to organize your files. It asks you to find them. The organizational layer is computational — Spotlight, Smart Folders, tags — not hierarchical. Nuke's organizational layer should be the same: computational. The user dumps. The system organizes. The interface reveals."*

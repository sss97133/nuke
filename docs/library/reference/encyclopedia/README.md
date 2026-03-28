# NUKE ENCYCLOPEDIA
## The Universal Provenance Engine for Physical-World Assets

> Nuke is not a car database. Nuke is not an art platform. Nuke is a provenance engine that builds knowledge graphs from the traces physical assets leave as they move through networks of people and organizations.

> A big enough database just turns into AI at one point.

> The "I just know" people... OK prove it. Show us your records. It will light the way.

---

## HOW TO READ THIS DOCUMENT

This is both a specification and a generation prompt. Every section describes what the system IS at sufficient detail that implementation is deterministic. The schema IS the prompt. The documentation IS the system. At sufficient resolution, the spec and the code converge.

Sections 1-8: Domain model
Sections 9-11: Design philosophy
Sections 12-16: Domain-specific features
Sections 17-21: Technical foundation
Section 22: Expansion plan
Section 23: Migration reality

---

# PART I: DOMAIN MODEL

---

## Section 1: Unified Asset Layer

The system manages three entity types. These are universal across all verticals.

### USER (artist, collector, driver, dealer, curator, handler, technician)
- Never an asset. Always an actor.
- Owns, creates, restores, sells, curates, transports, insures, and authenticates assets through organizations.
- Has a profile that accumulates reputation from traced actions, not from declared identity.
- May operate personal business entities (LLC, GmbH, estate) — those are organizations, not users.

### ORGANIZATION (gallery, auction house, museum, magazine, shop, foundation, estate, studio, publisher, racing team, dealer, freeport, university, shipping company)
- CAN become an asset (a magazine's archive has value; a gallery's roster is intellectual property; an auction house's records are historical documents).
- Accumulates value through the assets it touches and the actors it connects.
- Is the connective tissue between users and assets.
- Has staff with roles and date ranges — the hidden power structure. The people who actually do the work (the handlers, the deal makers, the directors) are users with roles at organizations. This is the graph edge nobody else captures.

### ASSET (vehicle, artwork, magazine issue, photograph, garment, watch, bottle, building)
- Immutable in identity. Accumulates data forever.
- Provenance = the chain of actors who touched it, through which organizations, at what times.
- Value is a function of the accumulated data — more data, more trusted data, higher value confidence.
- Assets don't change. They accumulate observations.

### The `assets` Registry Table

A thin universal registry sits above all domain-specific tables. Every vehicle, artwork, and future asset type gets an entry.

```
assets (id, type, display_title, created_at, status)
  ├── vehicles (asset_id FK) ← existing tables, untouched
  ├── artworks (asset_id FK) ← new
  └── [future verticals] (asset_id FK)
```

Shared infrastructure references `asset_id`:
- Provenance entries
- Observations
- Actor relationships
- Evidence chains
- Condition reports
- Auction results
- Image collections

Domain-specific tables reference their own ID (vehicle_id, artwork_id) which foreign-keys up to `assets.id`. Existing vehicle queries continue working unchanged. Cross-domain queries ("show me everything this collector owns") go through the asset layer.

### Networks Are Derived, Not Declared

Connections between actors emerge from collaborative traces — usually financially linked. Two actors are connected because:
- They both touched the same asset (co-ownership, collaboration, transaction)
- Money moved between them (auction sale, commission, publishing deal, restoration invoice)
- An organization links them (both showed at the same gallery, both published in the same magazine, both consigned to the same auction)

These traces are permanent. A 1967 transaction is still a node in the graph in 2026. The relationship didn't "unfollow." Social media builds graphs from declared intent that changes daily. Nuke builds graphs from evidence that compounds forever.

---

## Section 2: Art Ontology — Core Entities

An artwork is a vehicle. The mapping is direct:

```
vehicle.vin                → artwork.catalogue_raisonne_number
vehicle.year               → artwork.date_executed
vehicle.make               → artwork.artist (user_id FK)
vehicle.model              → artwork.title
vehicle.trim               → artwork.medium_and_dimensions
vehicle.build_sheet         → artwork.certificate_of_authenticity
vehicle.status             → artwork.location_status (private/museum/market/freeport/unknown)
vehicle.auction_result     → artwork.auction_result (same pattern)
vehicle.mileage            → artwork.exhibition_count (measure of exposure/use)
vehicle.description        → artwork.catalog_essay
```

### `artworks` Table — The Shell

Core fields: asset_id (FK to assets), artist_id (FK to users), title, date_executed, date_precision (exact/year/decade/circa), medium, support, dimensions_height, dimensions_width, dimensions_depth, dimensions_unit, edition_parent_id (FK for multiples), edition_number, edition_total, signed (boolean), signed_location, inscribed, inscription_text, catalogue_raisonne_ref, current_location_org_id, current_owner_id (if known), creation_location, creation_context.

### `artwork_components` — Material Resolution

Just as a vehicle has engine, transmission, body, interior — an artwork has physical components that matter for condition, authentication, and conservation:

- **Primary support**: canvas (linen, cotton, synthetic — weave type, weight, preparation), panel (wood type, construction), paper (type, weight, watermark), metal, found object
- **Ground/preparation**: gesso, sizing, primer type
- **Media**: oil, acrylic, watercolor, gouache, ink, pastel, charcoal, graphite, mixed — with specifics (cadmium red, ivory black, etc. when known)
- **Surface treatment**: varnish (type, date applied, condition), wax, fixative
- **Support structure**: stretcher (fixed/expandable, wood type, cross bars), frame (period, style, maker, material), mat, backing board
- **Inscriptions**: signature (location, medium, authenticity assessment), date, dedication, title, stamps, labels (gallery, exhibition, collection, customs, shipping)
- **Verso**: labels, stamps, inscriptions, stencils, exhibition tags — often the richest provenance data

Component resolution means: "what size paintbrush did Picasso use?" is a valid query. The system should be able to answer it when the data exists, or know that it doesn't.

### `artwork_images` — Same Pattern as vehicle_images

Zone classification for artworks:
- Full front (recto)
- Full back (verso)
- Detail: signature
- Detail: surface/texture (brush strokes, impasto, cracking)
- Detail: edges/corners
- Detail: frame
- Detail: labels/stamps (verso)
- Conservation documentation (UV, infrared, X-ray)
- Installation view (in situ)
- Historical photograph (provenance documentation)

---

## Section 3: Actor Layer

### Artist = User Profile + Artist Extension

The artist IS the user. Not a separate entity. A user profile with an `artist_profiles` extension containing:

- Birth date, death date (if applicable), birth location, death location
- Nationality (can be multiple, with date ranges for citizenship changes)
- Active periods (date ranges)
- Primary media (painting, sculpture, photography, printmaking, etc.)
- Movements/schools (Abstract Expressionism, Pop, Minimalism, etc. — with date ranges)
- Education (institution, program, years)
- Awards/honors
- Estate/foundation (org_id FK — the legal entity managing the legacy)

An artist's reputation is not a profile field. It's computed from the graph — exhibition density, auction results, museum holdings, literature citations, magazine features. The data IS the reputation.

### Organization Types and Their Roles

| Type | Role in Graph | Examples |
|------|---------------|----------|
| gallery | Primary market, artist representation, exhibition | Perrotin, Gagosian, Pace |
| museum | Validation, permanent collection, exhibitions | MoMA, Tate, Pompidou |
| auction_house | Secondary market, price discovery | Christie's, Sotheby's, Phillips |
| foundation | Legacy management, authentication, catalogue raisonné | Warhol Foundation, Mapplethorpe Foundation |
| estate | Post-mortem management, authentication | Basquiat Estate, Haring Estate |
| studio | Production, fabrication (especially for sculptors, printmakers) | Koons Studio, Gemini G.E.L. |
| publisher | Books, catalogues, magazines — validation layer | Phaidon, Taschen, Rizzoli, Powerhouse Books |
| university | Education, MFA programs, student shows, faculty | Yale MFA, RISD, CalArts |
| art_fair | Market event, gallery showcase | Art Basel, Frieze, FIAC |
| conservator | Condition assessment, restoration, authentication support | Independent or institutional |
| shipping_handler | Logistics, crating, installation | Cadogan Tate, Atelier 4 |
| freeport | Storage, tax-free holding — the black zones | Geneva, Luxembourg, Singapore, Delaware |
| insurance | Valuation, loss records | AXA Art, Hiscox |
| publisher_magazine | The validation layer — see Section 15 | System, Purple, V Magazine, Artforum |

### `org_staff` — The Hidden Power Layer

The people who actually run the art world are not the artists or the collectors. They're the gallery directors, the art handlers, the curators, the registrars, the private advisors. Peggy at Perrotin. The unnamed woman who decides which artist gets a booth at Basel. The shipper who knows which collector's warehouse holds what.

```
org_staff (
  id, user_id FK, org_id FK,
  role (director, curator, registrar, handler, advisor, sales, preparator, archivist),
  start_date, end_date,
  is_public (boolean — some roles are deliberately hidden)
)
```

This table is the power map of the industry. When someone moves from Gagosian to Hauser & Wirth, that's a data point. When the same advisor appears connected to three major private sales in a year, that's signal.

### `artist_representation` — Gallery Relationships

```
artist_representation (
  id, artist_id FK (user), gallery_id FK (org),
  representation_type (exclusive, non-exclusive, project, estate),
  start_date, end_date,
  territory (global, north_america, europe, asia),
  source_id FK (observation_sources — where we learned this)
)
```

When a gallery picks up an artist, that's public information. When they drop one, that's signal. The date-ranged representation history is one of the most valuable datasets in the art world and it's scattered across press releases, website updates, and industry gossip. Nuke structures it.

### Artist Business Entities

Artists at any level of success tend to create legal entities — LLCs, foundations, estates. These are organizations owned by users.

```
user_org_ownership (
  user_id FK, org_id FK,
  ownership_type (founder, beneficiary, director, trustee),
  start_date, end_date
)
```

Jeff Koons is a user. Jeff Koons LLC is an organization. The studio that fabricates the work is another organization. The transactions flow through the org, the creative credit belongs to the user. The graph distinguishes.

---

## Section 4: Provenance Chain

Provenance is the backbone. For vehicles it's the chain of ownership and restoration. For art it's the chain of custody that determines authenticity, legality, and value.

### `provenance_entries` — Unified Across Domains

```
provenance_entries (
  id, asset_id FK,
  owner_user_id FK (nullable — owner may be an org),
  owner_org_id FK (nullable),
  owner_description (text — "Private collection, New York" when identity unknown),
  acquisition_method (purchase, gift, bequest, commission, inheritance, seizure, restitution, found, unknown),
  acquisition_source (from whom — user_id, org_id, or text),
  acquisition_date, acquisition_date_precision,
  disposition_method (sale, gift, bequest, seizure, loss, destruction, unknown),
  disposition_date, disposition_date_precision,
  disposition_to (user_id, org_id, or text),
  location_during (city, country, specific venue if known),
  price_at_acquisition (nullable),
  price_currency,
  source_id FK (observation_sources — where this provenance claim comes from),
  confidence_score (0-1),
  notes,
  sort_order (for display sequencing)
)
```

### Provenance Gaps and Red Flags

A gap in provenance is data. The system automatically flags:
- 1933-1945 gaps (Holocaust-era — potential restitution claims)
- Freeport periods (Geneva, Luxembourg, Singapore, Delaware) — the "black zones" where assets disappear from public record
- Rapid transfers (asset changing hands multiple times in short period — potential money laundering signal)
- Unnumbered periods (time with no documented owner — potential theft or loss)

These flags don't moralize. They're metadata on the provenance chain. The system sees the world as it is.

### `exhibition_history` — Where the Asset Was Shown

```
exhibition_history (
  id, asset_id FK,
  exhibition_id FK,
  catalog_number (the work's number in the exhibition catalog),
  was_for_sale (boolean),
  sale_price (if sold during exhibition),
  installation_notes,
  source_id FK
)
```

### `exhibitions` — The Events

```
exhibitions (
  id, org_id FK (hosting institution),
  title, subtitle,
  start_date, end_date,
  venue_name, venue_city, venue_country,
  exhibition_type (solo, group, retrospective, survey, biennale, art_fair_booth, permanent_collection),
  catalog_published (boolean),
  catalog_id FK (to literature_references if catalog exists),
  curator_user_id FK (nullable),
  source_id FK
)
```

### `literature_references` — The Paper Trail

```
literature_references (
  id, asset_id FK,
  publication_type (book, catalog, magazine_article, newspaper_article, journal_article, dissertation, online),
  title, author, publisher,
  publication_date,
  page_numbers, plate_number, figure_number,
  is_illustrated (boolean),
  is_color (boolean),
  is_catalogue_raisonne (boolean — the definitive reference),
  isbn, issn,
  source_id FK
)
```

Every mention of an artwork in print is a literature reference. A single Picasso might have 500+ literature references accumulated over a century. Each one is an observation that strengthens the provenance and authentication case.

### `certificates_of_authenticity`

```
certificates_of_authenticity (
  id, asset_id FK,
  issuing_org_id FK (foundation, estate, committee, expert),
  issuing_user_id FK (individual expert if applicable),
  issue_date,
  certificate_number,
  status (valid, revoked, disputed, superseded),
  status_changed_at,
  notes,
  document_url (if digitized),
  source_id FK
)
```

### `conservation_history` — The Restoration Record

```
conservation_history (
  id, asset_id FK,
  conservator_user_id FK,
  conservator_org_id FK,
  treatment_date, treatment_end_date,
  treatment_type (cleaning, relining, inpainting, varnish_removal, structural_repair, frame_restoration, preventive),
  treatment_description,
  condition_before,
  condition_after,
  materials_used,
  documentation_images (array of image references),
  source_id FK
)
```

This is the direct analog of vehicle restoration records. "Would you rather have a painting Jeff Koons painted himself or ones his studio painted?" is a provenance question. "Would you rather have a car restored by a known specialist or an unknown shop?" is the same question. The conservation history answers it.

---

## Section 5: Market Layer

### `auction_results` — Unified Across Domains

The same table structure handles vehicle auctions (BaT, Mecum, Barrett-Jackson) and art auctions (Christie's, Sotheby's, Phillips). The asset_id links to the unified asset layer.

```
auction_results (
  id, asset_id FK,
  auction_org_id FK,
  sale_date,
  lot_number,
  sale_title (the specific auction/event name),
  estimate_low, estimate_high, estimate_currency,
  hammer_price, premium_price (hammer + buyer's premium), price_currency,
  sold (boolean),
  bought_in (boolean — offered but didn't sell),
  buyer_user_id FK (if known),
  buyer_org_id FK (if known — sometimes galleries buy at auction),
  buyer_description (text — "Private collector, Asia" when identity unknown),
  seller_user_id FK (if known),
  seller_org_id FK (if known),
  condition_report_available (boolean),
  provenance_as_published (text — the lot catalog's provenance section),
  exhibition_history_as_published (text),
  literature_as_published (text),
  catalog_notes (text),
  source_url,
  source_id FK
)
```

### `private_sales` — The Hidden Market

Art has a massive private market that doesn't go through auction. Gallery sales, private treaty, advisor-brokered deals. These are known through:
- Insurance valuations (which imply a price)
- Legal proceedings (divorce, estate, restitution cases make prices public)
- Dealer invoices (if shared)
- Tax records (donation appraisals are public for nonprofits)

```
private_sales (
  id, asset_id FK,
  seller_user_id FK, seller_org_id FK,
  buyer_user_id FK, buyer_org_id FK,
  sale_date, sale_date_precision,
  price, price_currency,
  price_source (invoice, insurance, legal, appraisal, reported, estimated),
  intermediary_org_id FK (gallery/advisor who brokered),
  confidential (boolean — price may be estimated, not confirmed),
  source_id FK
)
```

### `appraisals` — Value Over Time

```
appraisals (
  id, asset_id FK,
  appraiser_user_id FK, appraiser_org_id FK,
  appraisal_date,
  appraisal_type (insurance, estate, donation, market, damage),
  fair_market_value, replacement_value, price_currency,
  source_id FK
)
```

The Nuke Estimate for art = the same concept as the Nuke Estimate for vehicles. A computed value derived from comparable sales, trajectory analysis, and condition assessment, with confidence scoring and source citations.

---

## Section 6: Observation Sources — Tiered

Every data point enters the system as an observation from a source with a trust weight. The tiers are domain-specific but the mechanism is universal.

### Art World Observation Source Hierarchy

| Tier | Source Type | Base Trust Score | Examples | What It Provides |
|------|-----------|-----------------|----------|------------------|
| 1 | Museum collection database | 0.95 | MoMA, Met, Tate, Pompidou APIs | Accession data, exhibition history, provenance, conservation |
| 2 | Auction house | 0.90 | Christie's, Sotheby's, Phillips, Heritage | Lot data, provenance sections, estimates, results, images |
| 3 | Catalogue raisonné | 0.95 | Published definitive catalogs | Complete work listing, authentication, literature |
| 4 | Gallery (primary source) | 0.80 | Perrotin, Gagosian, Pace websites | Artist roster, exhibitions, available works, press |
| 5 | Art price database | 0.85 | Artnet, Artsy, MutualArt | Historical pricing, market analytics |
| 6 | Magazine/publication | 0.75 | Artforum, Frieze, System, Purple | Features, reviews, ads — validation events |
| 7 | Art fair | 0.70 | Art Basel, Frieze, FIAC | Booth listings, exhibited works |
| 8 | University/institution | 0.65 | MFA shows, faculty pages, student directories | Emerging artists, education data |
| 9 | Artist self-publication | 0.60 | Artist website, portfolio | Self-reported work list, biography |
| 10 | Social media | 0.40 | Instagram, personal sites | Activity signal, audience, self-promotion |
| 11 | Anonymous/unverified | 0.20 | Forum posts, anonymous tips | Claims requiring identity to gain trust |

### Vehicle Observation Source Hierarchy (Existing, Restated for Consistency)

| Tier | Source Type | Base Trust Score | Examples |
|------|-----------|-----------------|----------|
| 1 | Official registry/manufacturer | 0.95 | VIN decode, build sheet, window sticker |
| 2 | Curated auction | 0.90 | BaT, RM Sotheby's, Gooding |
| 3 | Professional inspection | 0.85 | PPI reports, concours judging |
| 4 | Volume auction | 0.75 | Mecum, Barrett-Jackson |
| 5 | Dealer listing | 0.70 | Hemmings, Hagerty, PCarMarket |
| 6 | Marketplace | 0.50 | eBay, Craigslist, FB Marketplace |
| 7 | Forum/community | 0.45 | Rennlist, TheSamba, Pelican Parts |
| 8 | Social media | 0.35 | Instagram, YouTube, Facebook groups |
| 9 | Owner self-report | 0.60 | Direct owner input via Nuke |
| 10 | Anonymous/unverified | 0.20 | Unattributed claims |

### Magazine Trust Scoring

Magazines sit at tier 6 for art but their trust weight is contextual:
- Editorial feature (curated, fact-checked): 0.80
- Review (critical assessment): 0.75
- Advertisement (paid placement): 0.50 for brand signal, 0.30 for factual claims
- Caption/credit: 0.85 (usually accurate — production teams verify)
- Contributor listing: 0.90 (names in colophon are contractual)

---

## Section 7: The Five Dimensional Shadows

Every entity in the system — every component of every asset — exists across five dimensions. This is the digital twin architecture applied universally.

### For Art

| Dimension | What It Captures | Example |
|-----------|-----------------|---------|
| **Spec** | What the work should be according to definitive sources | Catalogue raisonné entry: "Oil on canvas, 72 x 68 inches, signed lower right" |
| **Current State** | What the work is now | Latest condition report: "Surface stable, minor craquelure lower left quadrant, varnish slightly yellowed" |
| **Condition** | Conservation assessment over time | "Cleaned and revarnished 2018 by [conservator]. Previous relining 1985. UV examination shows no inpainting." |
| **Provenance** | Full chain of custody | "Artist's studio → Leo Castelli Gallery, 1964 → Private collection, NY → Christie's, 2008 → Current owner" |
| **Evidence** | Citations for every claim | "Spec from Smith, J., Catalogue Raisonné, 2005, no. 234. Condition from conservation report by [conservator], 2018-03-15. Provenance from Christie's lot notes, sale 2008-11-12." |

### For Vehicles (Existing, Restated)

| Dimension | What It Captures | Example |
|-----------|-----------------|---------|
| **Spec** | Factory build specification | Build sheet/SPID: "L48 350, TH350, 3.73 posi, Cranberry Red, Black interior" |
| **Current State** | What the vehicle is now | "LS3 swap, 4L80E, 4.10 gears, repainted PPG Hugger Orange, aftermarket seats" |
| **Condition** | Assessment over time | "Body: 7/10, mechanical: 8/10, interior: 6/10. Rust in right rocker. Frame solid." |
| **Provenance** | Chain of custody | "Factory → first owner, Dayton OH 1972 → barn find 2015, rural Indiana → current owner, restored 2018-2020" |
| **Evidence** | Citations | "Spec from Protect-O-Plate decode. Current state from owner photos 2024-01-15. Condition from PPI report by [inspector], 2023-11-20." |

Every cell in the database traces back to evidence. Every evidence trace cites a source. Every source has a trust weight. This is what makes "I just know" auditable — the graph either supports the claim with evidence or it doesn't.

---

## Section 8: Classification and Ontology

### Art Classification

**Movements and Periods**: Abstract Expressionism, Pop Art, Minimalism, Conceptual Art, Neo-Expressionism, Young British Artists, Contemporary, Post-Internet, etc. Assigned with date ranges and confidence. An artist can belong to multiple movements (Rauschenberg: Neo-Dada AND Pop AND Combines).

**Media Types at Resolution**: Not just "oil on canvas" but:
- Oil type: linseed, walnut, poppy, safflower, alkyd
- Pigments: cadmium red, titanium white, ivory black (when documented)
- Canvas: linen, cotton, synthetic — weight, weave, preparation
- Application: brush, palette knife, spray, pour, drip, stencil
- Tools: brush types, sizes (when documented — "what paintbrush did Picasso use?")

**Subject Matter Taxonomy**: Portrait, landscape, still life, abstract, figurative, historical, religious, genre scene, self-portrait, nude, cityscape, seascape, interior. Works can have multiple classifications.

**Edition and Multiple Tracking**: See Section 12.

### Vehicle Classification (Existing, Restated for Alignment)

**Categories**: Muscle car, sports car, luxury, truck, SUV, sedan, wagon, convertible, race car, hot rod, custom, barn find, survivor, daily driver, project.

**Eras**: Pre-war, post-war, muscle era, malaise era, modern classic, contemporary.

**Build Type**: Factory stock, numbers matching, restored, modified, restomod, custom, race-prepared.

### Cross-Domain Classification

Some classifications are universal:
- **Condition grade**: Numeric 0-100 score derived from observations, comparable across domains
- **Market segment**: Investment grade, collector grade, enthusiast grade, entry level
- **Rarity**: Unique, limited edition, production, mass market
- **Authentication status**: Authenticated, attributed, disputed, unknown, rejected

---

# PART II: DESIGN PHILOSOPHY

---

## Section 9: Design and Interface Philosophy

The Nuke design system is established and non-negotiable:

- **Typography**: Arial only. Courier New for data values. Zero serif.
- **Borders**: 2px solid. Zero border-radius. Zero shadows. Zero gradients.
- **Labels**: ALL CAPS at 8-9px.
- **Animation**: 180ms cubic-bezier(0.16, 1, 0.3, 1). Nothing slower.
- **Color**: Monochrome with racing-heritage accent palette (Gulf, Martini, JPS, BRG, Papaya) as easter eggs only, never primary.
- **Anti-AI aesthetic**: Framework-style, raw, utilitarian. Looks like a professional tool, not a consumer app. No rounded corners, no soft gradients, no friendly illustrations.

### Every Data Point Is a Live Badge

"1991 GMC V3500" is not a label. It's three filters stacked. Each word is clickable. Each click explodes into the cluster that badge belongs to:

- Click **1991**: see every asset dated 1991 across all domains
- Click **GMC**: see every GMC in the system — vehicles, related organizations, events
- Click **V3500**: see the model lineage, comparables, price trajectory

Same for art: "Basquiat, Untitled, 1982, Acrylic and oil stick on canvas, 72 x 68 in" — every token is a portal:

- Click **Basquiat**: artist graph — exhibitions, auction results, gallery representation, timeline
- Click **1982**: everything made that year across all artists
- Click **Acrylic**: medium cluster — who else works in acrylic, what's the market
- Click **72 x 68**: scale class — large-scale works, pricing by dimension

Badges are portals, not labels. The UI is a graph browser wearing the skin of a data dashboard.

### Signal Depth Is Visible

A badge backed by 500 provenance entries and 12 auction results looks different from a badge backed by 3 Instagram posts. Not through decoration — through density. More connections = more visible weight. The design renders trust topology.

A Picasso badge is heavy — deep graph, dense provenance, massive observation count. An unknown Instagram artist badge is light — shallow graph, few sources, low structural depth. The weight is visible without reading a single number. The interface communicates data density through visual mass.

### Everything Recalculates

No static views. The dashboard materializes the current graph state. New data shifts positions, surfaces new clusters, reweights signals. The user sees the graph breathe as extractions land.

### Actionable at Every Level

Any badge, any cluster, any intersection — the user can take action:
- Watch (add to monitoring)
- Invest (add to portfolio — the ETF concept: "1991 vehicles" as a basket)
- Compare (side-by-side against another entity)
- Export (structured data out)
- Drill (go deeper)
- Contact (organic connection — see Section 14)

The interface never dead-ends. Every view offers the next click.

### Anti-Vanity Metrics

The system does not surface volume as signal. It surfaces:
- Graph depth (how many layers of connected data)
- Provenance density (how complete the ownership chain)
- Source diversity (how many independent sources corroborate)
- Trust-weighted observation count (not raw count — weighted by source tier)

This is how bad work gets naturally deprioritized. A thousand Instagram likes from tier-10 sources don't outweigh one Christie's lot from tier-2. The system makes quality legible.

---

## Section 10: Click Anxiety Elimination

Click anxiety means the system is punishing exploration. Right now, clicking something risks: navigation away, context loss, broken page, dead end, loading state of unknown duration. That uncertainty kills the desire to explore, which kills the entire point of a system designed to be explored.

### Principles

**Every interaction is reversible in place.** Click opens, click closes. No navigation. No page transitions. No context loss. The user's position in the graph is always preserved.

**Expand, don't navigate.** Badges explode into their cluster inline or as a layered panel. The parent view stays visible behind/beneath. Breadcrumb trail shows depth. Escape or click-outside always collapses back.

**Instant feedback.** Zero loading states visible to the user. Data is either there or the badge shows its depth count so you know what you're about to open before you open it. No clicking into void.

**No dead ends.** Every view has outbound connections. If you drill into "1982" and there are 47 artworks, each artwork has badges that lead further. The graph never terminates — it always offers the next click.

**Predictable interaction model.** Every badge behaves the same way everywhere. Year badges, artist badges, medium badges, gallery badges, make badges, model badges — same click behavior, same expand pattern, same collapse behavior. Learn it once, trust it everywhere.

**Context stacking, not context switching.** Opening a detail doesn't close the list. Opening a sub-cluster doesn't close the parent cluster. The user builds up layers of context and peels them off. Like papers layered on a desk — you can always see the edges of what's underneath.

The excitement to click comes from trust. Trust that clicking won't break anything, won't lose anything, won't strand you. The system rewards curiosity instead of punishing it.

---

## Section 11: Discovery Journey — See First, Know Later

The entry point is always the work. Not metadata, not a search result, not a list. The image. High res.

### The Natural Flow

1. **See** — the image, full resolution, dominant
2. **Feel** — sit with it, no data pressure
3. **Learn** — artist, date, medium, dimensions layer in as badges
4. **Contextualize** — provenance chain, exhibition history, literature references
5. **Value** — price history, auction results, estimates, market position
6. **Discover** — who owns it, where has it been, what's connected to it
7. **Want** — add to portfolio, explore editions/multiples, find derivatives
8. **Connect** — who else is looking at this, what does the graph suggest
9. **Go deeper** — related works, related artists, related movements

Every step is a click with zero anxiety. The system never front-loads information. It rewards curiosity at the user's pace. Nobody is forced through a funnel.

## Section 11.5: The Vehicle Profile — Computation Surface

The vehicle profile is the **primary materialization layer** — the point where the knowledge graph becomes visible intelligence. It is not a display page. It is a computation surface that analyzes the underlying data in real time on every render.

### Position in the Pipeline

The profile sits at the middle of the data pipeline. Sources (extractors, user input, photos, work tracking, comment analysis) feed observations into the knowledge graph. The profile reads the graph, computes analysis, and renders intelligence for consumers (buyers, sellers, analysts, coaching systems, API/SDK).

There is no caching layer between the graph and the profile. When new data arrives, the next render includes it.

### The Timeline IS the Vehicle

Everything that happens to a vehicle is a timeline event — the atomic unit of the vehicle's existence. Work orders, ownership transfers, auction appearances, photo sessions, title events, modifications, and community mentions are all events on the same timeline. There are no parallel tracking systems. A build log is the timeline filtered to work events. A service history is the timeline filtered to maintenance events.

### The Day Card

Clicking a day on the timeline opens a popup (the Day Card) with two layers: raw data (all images, technician identity, parts, receipts) and seven-level analysis (vehicle build arc, job benchmark, client pattern, technician profile, shop metrics, regional context, national comparison). The seven levels convert experience and intuition into measured fact.

### Progressive Density

The profile renders at whatever resolution the data supports. Sparse vehicles show only what is known — year, make, model, maybe a photo. Dense vehicles show full timelines, classified photo galleries, and benchmarked analysis. Empty sections never render.

### Bills Are Generated Views

Invoices are the same timeline data rendered as a document. One data source, multiple presentations. No separate invoice tables that drift from work orders.

**Canonical document:** `docs/library/technical/design-book/vehicle-profile-computation-surface.md`

---

# PART III: DOMAIN-SPECIFIC FEATURES

---

## Section 12: Editions, Multiples, and Derivatives

Vehicles are (mostly) unique. Art often isn't. An edition is a parent entity with N child assets.

### Edition Parent

```
edition_parents (
  id, asset_id FK (the "work" as a concept),
  artist_id FK,
  title, date_executed,
  medium, technique,
  edition_size (total number),
  artist_proofs (AP count),
  printer_proofs (PP count),
  hors_commerce (HC count),
  publisher_org_id FK (print workshop, foundry, etc.),
  source_id FK
)
```

### Edition Children (Individual Instances)

Each print, cast, or copy in an edition is a separate asset with its own:
- Provenance chain (owned by different collectors, shown in different exhibitions)
- Condition (one print may be pristine, another foxed)
- Auction history (different prints sell for wildly different prices)
- Location (scattered across collections worldwide)

The parent holds shared metadata. The child tracks independently. The parent view shows aggregate: total edition market value, price spread between instances, which instance has the strongest provenance.

### Cattelan's Banana as Data Model

"Comedian, 2019" — edition of 3 + 2 AP.
- Parent: conceptual work, instructions-based (banana + duct tape + wall)
- Child 1: Sold to Sarah Andelman. Provenance: Perrotin → Andelman.
- Child 2: Sold to crypto collector. Provenance: Perrotin → buyer.
- Child 3: Sold at Sotheby's for $6.2M. Provenance: Perrotin → consignor → Sotheby's → buyer.

Each child has independent price trajectory. The parent shows the full picture. Signal analysis on the parent reveals: "editions of conceptual works by established provocateurs, sold through blue-chip galleries, with media attention" — that's a detectable pattern. "Find more artworks like it" becomes a graph query.

### Derivatives Layer

Masterworks fractional shares, authorized reproductions, licensed merchandise, NFTs — these are observation sources on the parent asset, not assets themselves. Unless they become collectible in their own right (a Warhol print of a Warhol painting — the derivative becomes an asset).

---

## Section 13: Authentication as Community Forensics

The system doesn't authenticate. The data authenticates.

### Identity-Staked Claims

Users can make claims about assets — authenticity, condition, provenance, attribution. Every claim is:
- Attached to a verified user identity
- Timestamped
- Source-cited (or explicitly unsourced — "personal knowledge")
- Trust-weighted based on the user's graph position (a museum curator's claim > a random account)

Anonymous claims carry a trust weight of 0.20. "Tell us who you are" is the authentication mechanism. Once a user's identity is verified, their historical claims retroactively gain trust weight.

### Forensic Engagement

Two people claim the same serial number on an edition print. The system surfaces this conflict automatically:
- Shows both claims side by side
- Shows the documentation (or lack thereof) behind each
- Flags for community review
- Neither claim is accepted at full trust until documentation resolves the conflict

No documentation = no provenance-level money. The market prices accordingly. The truth outs itself because money demands proof.

### At Scale: The System Makes Calls

At sufficient graph density, cross-referencing thousands of provenance chains, exhibition records, literature references, and stylistic analyses, the system can surface attribution insights that individual experts can't:

"This work attributed to 'School of Rembrandt' appears in 3 provenance chains that intersect with 7 documented Rembrandts. The stylistic analysis matches [parameters]. The literature references from 1890-1920 suggest misattribution during the [period] of reattribution. Confidence: 78% that this is a Rembrandt."

That's not AI intuition. That's graph density reaching critical mass.

---

## Section 14: Signal Matching — Organic Connection

### What Signal Is

Signal is computed from weighted recent activity against an actor's profile:

```
signal_score = Σ (observation_weight × source_trust × recency_decay × anomaly_factor)
```

An artist's signal is: what they're producing, where they're showing, who's buying, what's being written about them, how consistently, and how the trajectory is moving.

A collector's signal is: what they're viewing, what they're drilling into, what they're adding to portfolios, what auctions they're watching.

A gallery's signal is: who they're representing, what they're exhibiting, what's selling, what fairs they're attending, what magazines are covering them.

### The Boulder City Test

Three months painting in a rented workspace. $10K in supplies. No sharing, no posting, no distribution. The signal pattern:

- High investment (supplies, workspace — financial trace)
- Concentrated effort (3 months continuous — temporal trace)
- Zero self-promotion (no social media, no gallery outreach — negative signal)
- Unconventional background (tech industry — anomaly signal)

This pattern is detectable and meaningful. A certain type of gallery person responds specifically to "serious, not playing the game" signal. Not through an algorithm that says "you might like this artist." Through the graph data being available when that gallery person is exploring adjacent nodes.

### Organic, Not Algorithmic

The system does NOT:
- Show "recommended artists" feeds
- Send "you might like" notifications
- Create "match" scores between collectors and artists
- Build any feed that optimizes for engagement

The system DOES:
- Make signal data queryable through MCP ("who's been producing consistently in [medium] in [region] without gallery representation?")
- Surface connections through the graph when a user is already exploring ("this artist exhibited alongside 3 other artists you've been looking at")
- Enable contextual discovery through magazines, exhibitions, and collaborative traces
- Power organic introductions through organizations (the gallery hosts the dinner, Nuke helps the gallery know who should be at the dinner)

The fundamental goal: refocus human connection on natural, organic methods. The system enables the meeting. It doesn't perform the meeting. End the doom scroll. Not as a marketing statement — as an architectural principle. The system has no feed. No scroll. Only exploration.

---

## Section 15: Magazine Intelligence — The Monetization Layer

Magazines are not a vertical. They're a validation layer that feeds into every other vertical. A physical receipt that something mattered.

### What Gets Extracted

From every magazine issue, OCR and extraction targets:

| Component | Trust Weight | What It Yields |
|-----------|-------------|----------------|
| **Cover** | 0.85 | Photographer, subject (artist/model/car), art direction credit |
| **Colophon/masthead** | 0.90 | Publisher, editor, art director, staff — org_staff entries with date ranges |
| **Contributors page** | 0.90 | User profiles for every contributor — photographers, writers, stylists |
| **Captions/credits** | 0.85 | Specific attribution of images to photographers, locations, subjects |
| **Index** | 0.90 | Complete entity map of the issue — artists, brands, places mentioned |
| **Advertisements** | 0.50/0.30 | Brand identification, agency (if credited), photographer (if credited), spend signal |
| **Feature articles** | 0.75 | Artist/subject profiles, validation events |
| **Images** | 0.80 | Visual documentation — artworks shown, vehicles photographed, garments featured |

### Ad Spend Intelligence

At scale across multiple titles and quarters:

- **Prada** appeared on XX pages in Q1 across 5 titles. Chanel appeared on XX pages.
- **Gap analysis**: Brand X is spending in every Caribbean title except Magazine Y. Probability of brokerable contract: high.
- **Quality scoring**: Of Prada's XX pages, XY were high-production (known photographer, editorial-quality layout). XZ were catalog-style (low production, likely supplied by brand).

This intelligence is what makes the magazine extraction monetizable. Brands, agencies, and publishers would pay for this data because nobody is aggregating it systematically.

### Production Quality as Signal

Not just what was published but how:
- Which photographer shot it (known vs. unknown)
- Which team produced it (the production logs are signal)
- What method/style (editorial vs. commercial vs. documentary)
- Effort invested (multi-day shoot vs. quick turnaround)

An unknown photographer who clearly worked intensely on an editorial spread is signal. An established name phoning it in is signal. The production quality tells you about the health of the magazine and the seriousness of the featured subject.

### Magazine as Observation Source for Art

When Artforum publishes a review of an artist's exhibition, that review is:
- An observation on the artwork(s) mentioned (literature_reference)
- An observation on the artist (exhibition coverage signal)
- An observation on the gallery (validation of their programming)
- An observation on the critic (their position in the network)
- An observation on Artforum itself (what they chose to cover)

One magazine article generates 5+ observations across multiple entities. At scale across thousands of issues, magazines ARE the connective tissue of the cultural graph.

---

## Section 16: Freeports, Black Zones, and Provenance Gaps

### What Freeports Are

Tax-free storage facilities in Geneva, Luxembourg, Singapore, Delaware, and a handful of other jurisdictions. Art enters, disappears from the public record for years or decades, then resurfaces.

A freeport period in a provenance chain is:
```
provenance_entries (
  ...
  location_during: 'Geneva Freeport',
  acquisition_date: '2012-03-15',
  disposition_date: NULL,  -- still there, or we don't know when it left
  owner_description: 'Private collection',  -- identity shielded
  ...
)
```

### Geographic Provenance Metadata

```
provenance_geography (
  id, provenance_entry_id FK,
  location_type (private_collection, museum, gallery, freeport, studio, warehouse, in_transit, unknown),
  city, country,
  is_freeport (boolean),
  is_conflict_zone (boolean — cultural property concerns),
  export_license_required (boolean),
  export_license_documented (boolean),
  customs_declaration_documented (boolean)
)
```

### Automatic Flag System

The system flags provenance chains that contain:
- **1933-1945 European gaps**: Potential Holocaust-era looted art. Flag for restitution research.
- **Freeport periods > 5 years**: Extended off-market storage. Not inherently suspicious but notable.
- **Undocumented cross-border transfers**: Art moving between countries without export documentation.
- **Rapid flipping**: Multiple transfers in < 2 years. May indicate speculative trading or laundering.
- **Descending authentication**: Work that was once "attributed to X" and is now "school of X" — value implications.

These flags are metadata, not judgments. The system sees the world as it is. Being bad is a fact of life. It's where things happen. It's important to study it from a position of extreme long-term knowledge.

---

# PART IV: TECHNICAL FOUNDATION

---

## Section 17: One Write Path — The Observation Mandate

**Every piece of data entering the system goes through `ingest-observation`. No exceptions.**

This is the single most important technical decision. The observation system already exists and works. The extractors don't use it — they write directly to legacy tables. This stops now.

### The Rule

```
❌ WRONG: extract-bat-core → INSERT INTO auction_comments
❌ WRONG: extract-bat-core → INSERT INTO vehicle_events
❌ WRONG: any extractor → direct INSERT INTO any table

✅ RIGHT: any extractor → ingest-observation → vehicle_observations
✅ RIGHT: any user input → ingest-observation → vehicle_observations
✅ RIGHT: any scrape result → ingest-observation → vehicle_observations
```

### Legacy Tables Become Views

`auction_comments`, `vehicle_events`, `vehicle_images` (for metadata — not binary storage) become materialized views on `vehicle_observations` filtered by `kind`. The read interface doesn't change. The write interface is unified.

### Benefits

1. **One audit trail.** Every observation records: source_id, agent_tier, confidence_score, extraction_timestamp, raw_source_reference.
2. **One dedup mechanism.** SHA256 content hash catches duplicates regardless of source.
3. **One entity resolution point.** Vehicle/artwork matching happens once, in one function, with one set of rules.
4. **One provenance chain.** Every data point traces back to where it came from.
5. **Domain agnostic.** The same path works for vehicle data, art data, magazine data, user input, and any future domain.

---

## Section 18: Entity Resolution — The Universal Matcher

One function. Shared by all extractors, all domains. Replaces the per-extractor matching logic that currently causes data corruption.

### Input: Resolution Hints

```typescript
interface ResolutionHints {
  // Strong identifiers (one is usually enough)
  unique_id?: string;          // VIN, catalogue raisonné number, accession number
  source_url?: string;         // URL of the listing/page this came from

  // Medium identifiers (need multiple to match)
  title?: string;              // "1984 Chevrolet K10" or "Untitled, 1982"
  year?: number;
  creator?: string;            // Make or artist name
  model_or_title?: string;

  // Weak identifiers (supplementary only)
  dimensions?: string;
  medium?: string;
  color?: string;
  location?: string;

  // Visual match (new capability)
  image_hash?: string;         // Perceptual hash for image similarity

  // Domain
  asset_type: 'vehicle' | 'artwork' | 'publication';
}
```

### Output: Resolution Result

```typescript
interface ResolutionResult {
  match_type: 'exact' | 'confident' | 'candidate' | 'new';
  asset_id?: string;           // If matched
  confidence: number;          // 0-1
  match_signals: {
    unique_id_match: boolean;
    url_match: boolean;
    image_similarity: number;
    metadata_overlap: number;
  };
  candidates?: Array<{        // If multiple possible matches
    asset_id: string;
    confidence: number;
    signals: object;
  }>;
}
```

### Resolution Priority

1. **Unique identifier** (VIN, catalogue raisonné number, accession number, ISBN) → 0.99 confidence. Auto-match.
2. **Source URL** (exact match on `source_url` in existing observations) → 0.95 confidence. Auto-match.
3. **Image perceptual hash** (hamming distance < threshold) → 0.85 confidence. Auto-match.
4. **Metadata intersection** (year + creator + title/model all match, plus at least one supporting field) → 0.80 confidence. Auto-match.
5. **Partial metadata** (year + creator match, title/model fuzzy) → 0.60 confidence. **DO NOT AUTO-MATCH. Return as candidate for review.**
6. **Below threshold** → Create new entity. Flag for manual review if similar candidates exist.

The 60% fuzzy match that currently auto-merges is dead. Confidence below 0.80 never auto-matches. Ever.

---

## Section 19: One Intake, One Gesture

### The UX: Command S

User is on a URL. They save it. Or they take a phone photo. Or they drop a PDF. Or they paste text. One gesture. Everything after is invisible.

### The Technical Reality

```
intake(raw_input)
  → store_raw(input)           // Preserve raw input permanently (archiveFetch for URLs)
  → classify(type, domain)     // What is this? URL? Image? Document? What domain?
  → extract(schema)            // Fill the appropriate schema from raw input
  → resolve(entity)            // Match to existing entity or create new
  → observe(entity, data)      // Write through ingest-observation
```

Five steps. One path. No domain-specific routing at intake. Classification happens after the raw input is safely stored. If extraction fails, the raw input is preserved — extract again later, differently, for free.

### Single Intake Endpoint

```typescript
// One endpoint accepts everything
POST /intake
{
  type: 'url' | 'image' | 'document' | 'text',
  content: string | binary,
  hints?: {
    asset_type?: 'vehicle' | 'artwork' | 'publication',
    context?: string  // Optional user context: "this is a BaT listing" or "this is a Christie's lot"
  }
}
```

### Classification Logic

The classifier determines:
1. **Input type**: URL (which domain?), image (photo of what?), document (PDF type?), text (structured?)
2. **Domain**: automotive, art, publication, unknown
3. **Source**: Which observation source does this map to? (BaT, Christie's, museum API, phone camera, etc.)
4. **Schema**: Which extraction schema to apply

Classification is cheap (pattern matching + light LLM if ambiguous). It runs after storage, not before. The raw input is never lost.

---

## Section 20: Audit Trail — Every Field Has a Birth Certificate

### Observation Metadata

Every observation written through `ingest-observation` carries:

```sql
source_id           -- Which observation source (BaT, Christie's, user camera, etc.)
agent_tier          -- haiku / sonnet / opus / human / system
extraction_method   -- llm_extraction / html_parse / ocr / api_response / manual_input
confidence_score    -- 0-1
raw_source_ref      -- URL, document ID, or image ID of the raw input
extracted_at        -- When the extraction happened
extracted_by        -- Which specific function/agent performed the extraction
content_hash        -- SHA256 for dedup
```

### Field-Level Provenance

When a vehicle says `make = "Chevrolet"`, the system can answer:
- **Who wrote it?** Haiku extraction worker
- **From what source?** BaT listing URL slug
- **When?** 2026-03-15 14:23:07
- **At what confidence?** 0.72
- **What was the raw input?** "/listing/1984-chevrolet-k10-pickup/"
- **Is there a higher-confidence source?** Yes — VIN decode says "Chevrolet" at 0.99

### Conflict Resolution

When multiple sources provide conflicting values for the same field, the system:
1. Stores all values as separate observations
2. Displays the highest-confidence value as the "current" value
3. Shows conflicts as a discrepancy (trust score delta × value difference = discrepancy severity)
4. Allows human resolution (human input at confidence 1.0 overrides all automated values)

---

## Section 21: Agent-Native Pipeline

The Claude MCP connector is not a debugging tool. It IS the extraction pipeline.

### Edge Functions Become MCP Tools

The 8-function Rube Goldberg machine becomes 5 atomic MCP tools:

```
nuke_intake(input)              -- Accept URL, image, document, text
nuke_extract(raw_id, schema)    -- Fill schema from stored raw input
nuke_resolve(hints)             -- Match to existing entity or create new
nuke_observe(entity_id, data)   -- Write observation with full audit trail
nuke_query(entity_id)           -- Read entity with full graph
```

### The Agent Orchestrates

When a user's Claude instance has the Nuke MCP connector:

1. User says: "Extract this Christie's lot"
2. Claude calls `nuke_intake(url)` — raw page stored
3. Claude calls `nuke_extract(raw_id, 'artwork')` — schema filled from stored page
4. Claude calls `nuke_resolve(hints)` — matched to existing artwork or new entity created
5. Claude calls `nuke_observe(entity_id, extracted_data)` — observation written with full provenance

The agent handles the orchestration that the Rube Goldberg machine currently handles badly. The agent can:
- Read errors and try alternative approaches
- Ask the user for clarification when entity resolution is ambiguous
- Chain multiple extractions in sequence
- Report exactly what it couldn't resolve

### Why This Wins

- **One orchestrator (the LLM) instead of 8 edge functions.** The agent understands context that rigid function chains can't.
- **Debugging is natural.** When extraction fails, the agent explains why in natural language instead of leaving a record stuck in `processing` forever.
- **User agency.** The user can steer the extraction: "No, that's not the right vehicle — link it to this one instead." The agent calls `nuke_resolve` with the corrected hints.
- **Scale through parallelism.** Multiple agents can run simultaneously, each extracting different sources, all writing through the same `nuke_observe` endpoint. No queue management needed — the MCP tools handle concurrency through database-level locking.

---

# PART V: EXPANSION AND REALITY

---

## Section 22: Expansion Plan

### Phase 0: Fix the Foundation (No New Verticals Needed)

**Duration**: 2-4 weeks. **Cost**: Engineering time only.

1. **Enforce single write path.** All new extractions from today forward go through `ingest-observation`. Don't migrate old data yet — stop the bleeding.
2. **Deploy universal entity resolver.** One function, shared by everything. Kill the 60% fuzzy match.
3. **Add audit trail fields.** Source, agent tier, confidence, timestamp on every observation.
4. **Unify intake endpoint.** One function that accepts URL, image, or document. Classifies after storage.
5. **Fix schema-code mismatch.** Add `pending_review` and `pending_strategy` to the import_queue CHECK constraint.

These changes improve vehicles immediately. They're also prerequisites for art.

### Phase 1: Unified Asset Layer + Art Schema

**Duration**: 4-8 weeks. **Cost**: Engineering + initial scraping.

1. **Create `assets` registry.** Every existing vehicle gets a row. Zero disruption.
2. **Create art tables.** `artworks`, `artwork_components`, `edition_parents`, `artist_profiles`, `exhibitions`, `exhibition_history`, `provenance_entries`, `literature_references`, `conservation_history`, `certificates_of_authenticity`, `auction_results` (shared), `private_sales`, `appraisals`, `org_staff`, `artist_representation`, `artwork_images`.
3. **Art extractors are MCP tools from birth.** No edge function Rube Goldberg. Agent-native pipeline is the default.
4. **First scrape: auction houses.** Christie's and Sotheby's lot archives. Most structured data — provenance sections, exhibition histories, literature references, sale results. Seed 50K-100K artwork shells.
5. **Second scrape: museums.** MoMA, Met, Tate, Pompidou collection APIs. High-trust, well-structured. Fills artist profiles and exhibition histories.
6. **Artist and org profiles** as extensions of the existing user/org model.

### Phase 2: Magazine as Observation Source

**Duration**: 6-12 weeks (OCR pipeline is the long pole).

1. **OCR pipeline** for priority magazines — Artforum, Frieze, System, Purple, V Magazine, and the St. Barths title.
2. **Extract targets**: contributors, captions, ad placements, featured artists/brands, colophon data.
3. **Each extraction becomes observations** on the relevant entities.
4. **Ad spend intelligence materializes** from observation density — count observations by brand by title by quarter.
5. **Quality scoring** on production (photographer, team, method) adds depth signal.

### Phase 3: Cross-Domain Graph Emergence

**Duration**: Ongoing. Happens naturally as data density increases.

- Collectors who own vehicles AND art become visible through the unified asset layer.
- Galleries that show art AND sponsor automotive concours share org profiles.
- Magazine features covering both car culture and art are observations on both domains.
- Signal engine works across domains because it calculates on observations, not domain-specific tables.
- The graph connects what was previously siloed.

### Phase 4: New Verticals Are Configuration

**Duration**: 2-4 weeks per vertical (once Phases 0-2 are complete).

For any new vertical (watches, wine, real estate, whatever):
1. Define ontology (tables, components, dimensional shadows)
2. Register observation sources with trust weights
3. Point scrapers at targets
4. The intake → extract → resolve → observe pipeline works unchanged
5. The UI renders badges and treemap pop-throughs unchanged
6. The signal engine calculates unchanged

At this point, adding a vertical is a schema definition exercise, not an engineering project.

---

## Section 23: Migration Reality — The Strangler Fig

The system is live. Data flows daily. You can't stop the car to rebuild the engine.

### The Strategy

The new system grows around the old one. It doesn't replace it — it absorbs it. Like a strangler fig that grows around a host tree until the host is just bark.

### Week 1-2: Parallel Write Path

New extractions go through `ingest-observation` AND the old tables. Dual-write. Both systems get the data. The old pipeline doesn't know or care. The new pipeline accumulates a parallel dataset that's audited, cited, and properly resolved.

### Week 3-4: New Extractions Go New-Path-Only

Stop the dual write. New vehicle extractions only write through `ingest-observation`. Materialized views surface this data in the old table shapes (`auction_comments`, `vehicle_events`). Nothing downstream notices — the views look identical to the tables they replaced.

### Week 5-8: Art Launches on New Path Exclusively

Art never touches the old pipeline. Born clean. The agent-native pipeline is the only pipeline. Every art observation has full audit trail from birth. This proves the architecture at scale on a domain with zero legacy debt.

### Month 3: Backfill Vehicles

Old vehicle data in `auction_comments`, `vehicle_events`, etc. migrates into `vehicle_observations` as a batch job. Each migrated record: `migration_source: 'legacy', confidence: 'inherited'`. Materialized views flip from "read old tables" to "read observations." Old tables become archive-only.

### Month 4-6: Old Tables Drop

Once all reads serve from observations and all writes go through the new path, old tables are dead weight. Archive, then drop. The 8-function pipeline retires. Edge function count approaches the target of 50.

### The Key Insight

Art is the migration strategy. You don't refactor vehicles to create the platform. You build art correctly on the new platform, prove it works, then pull vehicles over. Art has zero legacy debt — it's the clean room where the correct architecture gets validated.

### Ground Truth Is Progressive

The ground truth isn't established once. It's established observation by observation. Each new data point that enters through the correct path makes the graph more true. Each old record that gets backfilled extends the truth backward in time.

The system is never done establishing ground truth. It's always accumulating it. Assets don't change. They accumulate data. The database doesn't describe the asset. At sufficient density, the database IS the asset.

---

# APPENDICES

---

## Appendix A: The 11 Machines (From RHIZOME.md)

The system operates as an interconnected body:

```
Photos (eye) → Ingest (mouth) → Process (gut) → Store (skeleton) →
Think (brain) → Discover more (nose) → Remember (memory) →
Value (wallet) → Show (skin) → Speak (voice) → Let humans touch (hands)
```

The voice (API/SDK) and hands (curation) are the most underdeveloped. The body can see, eat, digest, think, discover, remember, and value — but it barely speaks to the outside world, and humans can barely touch it to correct it.

## Appendix B: Observation System — The Body Without Organs

From RHIZOME.md: "Observation is the one concept that belongs equally to ingestion, processing, infrastructure, intelligence, and vision. If fully realized, it dissolves the 'which table does this go in?' problem."

The observation system is the unifying architecture. Every extractor writes through one path. Every data point has provenance. Every domain uses the same mechanism. This is the architectural decision that makes Nuke a platform instead of a vehicle database.

## Appendix C: What Was Killed (Do Not Rebuild)

Deleted features (March 2026 triage):
- Betting/wagering on auction outcomes
- Trading/exchange (vehicle swap marketplace)
- Vault (NFT-style ownership tokens)
- Concierge/villa (luxury services)
- Shipping (transport logistics)
- Investor portal (fundraising dashboard)

These consumed 161 prompts, ~90 commits, and $1,500-3,000/month. They were conceptually discussed but never manifested in meaningful code. Every mention of these features is a distraction signal.

## Appendix D: DB Safety Rules

- NEVER `statement_timeout` > 120s
- ALWAYS batch DELETE/UPDATE with LIMIT 500-1000
- Check `pg_stat_activity` for lock waiters after EVERY write
- Check active queries before DDL — if > 2 on the target table, WAIT
- No raw `fetch()` — use `archiveFetch()`
- No direct `createClient` — use shared pattern
- No CORS header duplication — import from `_shared/cors.ts`
- No unbounded UPDATE/DELETE on large tables — batch with `pg_sleep(0.1)` between

## Appendix E: The Five Prompts That Are the Spec

From 13,758 prompts, five activate all 11 machines simultaneously:

1. "When a user has their images on their computer we basically need to give them some version of a bot like Claude Code who asks permission to access their photos and then we run analysis"
2. "I am actually the expert you're just a super intelligent fucking God level amazing computer genius but I have a vision..."
3. "Design a comprehensive Photo Auto-Sync system... watches Apple Photos library, automatically ingests, classifies, matches to vehicles..."
4. "Import ~400+ saved Craigslist listings with historian credits and unverified owner tracking"
5. "API Endpoints, SDK Publishing, Documentation... 938K vehicles, 507K valuations, 11M+ auction comments, 30M+ images — but most is locked behind internal functions"

If you read nothing else, read these 5. They are the product spec: photos in → intelligence applied → data structured → value estimated → API out → human steering.

---

*This document is the Level 2 specification for Nuke. Level 1 is the vision (captured in docs/writing/). Level 3 is the code. At sufficient resolution, the three converge.*

*The schema IS the prompt. The documentation IS the system. A big enough database just turns into AI at one point.*

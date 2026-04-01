# NUKE DICTIONARY

Canonical definitions. Every term means exactly one thing. When in doubt, this is what we mean.

---

## A

**Agentic Header** — A header design philosophy where the primary interaction is intent expression (typing, pasting, dropping) rather than navigation (clicking links). The system interprets intent and routes to the correct response. The user doesn't need to know the application's taxonomy — they express what they want and the system resolves it. This is simultaneously more accessible (new users type naturally) and more powerful (experts type VINs, URLs, complex queries). Historical lineage: command line (1964) → GUI navigation (1984) → command palette (2015) → agentic header (2026). See Paper: The Agentic Header.

**Actor** — Any user or organization that touches an asset. Actors create, restore, sell, curate, transport, insure, authenticate, and exhibit assets. Actors are never assets. Actors leave traces in the graph through their actions.

**Anomaly Signal** — A signal pattern that deviates from the norm for a given actor type. High investment + zero self-promotion from an artist is anomaly signal. Rapid price increase without institutional validation is anomaly signal. Anomalies are flagged, not judged.

**Archive Fetch** — The principle that every external URL fetched gets stored permanently as raw HTML/markdown in `listing_page_snapshots`. Fetch once, extract forever. Implemented via `archiveFetch()` from `_shared/archiveFetch.ts`. Raw `fetch()` is prohibited.

**Asset** — Any physical object tracked by the system. Vehicles, artworks, magazine issues, photographs, garments. Immutable in identity. Accumulates data forever. Assets don't change — they accumulate observations.

**Asset Registry** — The `assets` table. Thin universal layer that every domain-specific entity (vehicle, artwork) links to via `asset_id`. Enables cross-domain queries.

**Auction Readiness Score (ARS)** — A 0-100 composite score across six dimensions (identity, photos, documentation, description, market position, condition) that measures how prepared a vehicle is for auction submission. Computed by `compute_auction_readiness()` SQL function. Stored in `auction_readiness` table. Tier transitions tracked in `ars_tier_transitions`. Used by the coaching system to generate specific improvement recommendations. See `auction-readiness-strategy.md`.

**Apparition** — A single appearance of a vehicle on a marketplace or auction platform. A vehicle that has appeared on BaT, then Craigslist, then BaT again has three apparitions. Stored as `vehicle_observations` with kind = 'listing' or 'sale_result'. The pattern of apparitions — frequency, price trajectory, platform migration, outcomes — is itself a signal. See Intelligence Surface: HistoryPatternCard.

**Apparition Timeline** — The chronological rendering of a vehicle's market appearances across all platforms. Shows each apparition as a dot on a horizontal timeline with price, platform, and outcome (sold/no sale/withdrawn/active). Price trajectory is color-coded. One of five signal cards on the Vehicle Briefing. Not a separate data system — reads from `vehicle_observations` filtered by kind. See `docs/library/technical/design-book/11-intelligence-surface.md`.

**Audit Trail** — The metadata attached to every observation: source_id, agent_tier, confidence_score, extraction_timestamp, raw_source_reference. Every field has a birth certificate.

**Agent Hierarchy** — The three-tier LLM processing system: Haiku ($1/$5 MTok) for routine extraction, Sonnet ($3/$15 MTok) for quality review and edge cases, Opus ($5/$25 MTok) for strategy. Dispatched by `agent-tier-router`. Queue flow: `pending -> haiku -> complete/pending_review -> sonnet -> complete/pending_strategy -> opus`. Replaced the single-model CQP approach. See `supabase/functions/agent-tier-router/index.ts`.

**Agent Tier** — The `agent_tier` column on `vehicle_observations`. Records which LLM model produced an observation: `haiku`, `sonnet`, `opus`, `qwen-local`, `qwen-modal`, `nuke-agent`. Enables cost analysis and quality correlation by model tier.

**Analysis Engine** — The widget-based vehicle intelligence system. Coordinator function sweeps for stale signals every 15 minutes, queues recomputation, and processes analysis queue items. 14 widgets across 6 categories produce per-vehicle signals stored in `analysis_signals`. See `supabase/functions/analysis-engine-coordinator/index.ts`.

**Archivist** — One of three user modes (not personas — modes). The Archivist wants to see every field, every source, every confidence score. They want the full depth of the digital twin rendered without simplification. They operate in List View. Their need is auditability. The Intelligence Surface serves Archivists through the Evidence Layer (L2) — expandable full-provenance evidence under every signal card. See Contemplation: The Three Users and the Finder.

## B

**Badge** — A clickable data token in the UI. "1991", "GMC", "V3500", "Basquiat", "1982", "Acrylic" — each is a badge. Badges are portals, not labels. Clicking a badge explodes into the cluster it belongs to.

**Briefing** — The user-facing intelligence summary rendered at the top of a vehicle profile. Inverts the query model: instead of the user asking questions, the system presents the most relevant computed intelligence unprompted. Structured as a pyramid: L0 headline (one sentence, highest-severity signal), L1 signal cards (3-5 dimension-specific insights), L2 evidence layer (expandable full-provenance backing for each signal). The briefing is a computation surface — it reads from the knowledge graph and computes on render. See Discourse: The Knowing System, Design Book Ch. 11.

**Briefing Headline** — The L0 (Layer 0) component of the Vehicle Briefing. One sentence communicating the single most important thing about a vehicle right now. Generated from the highest-severity active analysis signal. Color-coded by severity (red/amber/blue/green/grey). The headline serves the Browser user mode — the person scrolling who needs one reason to stop or keep going.

**Briefing Model** — The information delivery paradigm where the system observes, analyzes, and presents rather than waiting to be queried. Contrast with the Query Model (user asks → system answers). In the briefing model: system observes → system analyzes → system presents → user decides. Inspired by intelligence analysis and military briefings. The user's job is not to formulate questions but to absorb the briefing and make a decision. See Discourse: The Knowing System, Section II.

**Browser** — One of three user modes (not personas — modes). The Browser opens the feed, scrolls through vehicles, clicks what catches their eye, checks the price, goes back, scrolls more. They want beautiful cards, good images, quick summaries. Their need is pleasure and discovery. The Intelligence Surface serves Browsers through the Briefing Headline (L0) and signal card summaries (L1). See Contemplation: The Three Users and the Finder.

**Black Zone** — A period or location where an asset disappears from the provenance record. Freeports, undocumented storage, provenance gaps. Black zones are data — the absence of records is itself informative.

**Body Without Organs (BwO)** — Deleuzian concept. In Nuke, the observation system is the BwO — it has no single home, belongs to every machine equally, and dissolves boundaries between all data types. See RHIZOME.md.

## C

**Catalogue Raisonné** — The definitive published catalog of an artist's complete works. The ground truth reference for art, like a factory build sheet is for vehicles. Highest trust source for artwork identification and attribution.

**Click Anxiety** — The fear of clicking because the system might navigate away, lose context, break, or dead-end. The fear correlates with the irreversibility of the action — hovering creates zero anxiety, expanding in place creates low anxiety, navigating to a new page creates high anxiety. Nuke eliminates click anxiety through reversible-in-place interactions. Every click opens, every click closes. Trust accumulates through repetition: ~7 successful interactions establish a model, ~20 build habit, ~50 build love. One broken interaction destroys the trust built by four good ones — the asymmetry of trust destruction mandates zero exceptions in the interaction model. See Contemplation: Click Anxiety and Digital Trust.

**Command Input** — The universal input field occupying the center of the header. Not a search bar — a polymorphic intent resolver. Accepts: search queries, URLs for extraction, VINs for lookup, year-make-model patterns, natural language questions, and dragged images. Each input type is detected by cascading pattern matchers (URL regex > VIN regex > YMM pattern > keyword router > search fallback) and routed to the appropriate handler. The routing is invisible to the user. Ghost text rotates capabilities: "Search vehicles...", "Paste a URL...", "Drop an image...", "Ask anything...". Focused via Cmd+K from anywhere. Results appear as overlays (not navigation), preserving context. See Paper: The Agentic Header.

**Command Palette** — An interface pattern (popularized by VS Code's Cmd+P, macOS Spotlight, Raycast) where a text input searches across actions, files, commands, and settings. The agentic header extends this pattern by making it the primary navigation surface rather than a secondary shortcut, and by accepting polymorphic input (not just text commands).

**Context Stacking** — The interaction model where opening a new view does not close the previous one. Clicking a badge opens a panel; clicking within that panel can open another panel; Escape peels off one layer at a time. Like papers on a desk — you can always see the edges of what's underneath. The opposite of context switching, where navigating to a new view replaces the current one. Context stacking preserves the user's working memory and eliminates the need for the back button within exploratory interactions.

**Collaborative Trace** — A connection between two actors derived from shared involvement with an asset or organization. Not declared ("follow/following") but evidenced by transactions, exhibitions, publications, or co-ownership. Permanent and financial.

**Circular Estimate** — A Nuke Estimate where the computed value equals the vehicle's own sale price, indicating the valuation engine fell back to `self_price_fallback` comp method instead of finding independent comparables. Circular estimates are flagged via `nuke_estimates.is_circular = true` and excluded from deal scores. As of 2026-03-29, self_price_fallback is blocked for sold vehicles — the estimate stays null rather than mirroring reality.

**Comp Method** — The methodology used to derive a Nuke Estimate, stored in `nuke_estimates.comp_method`. Values: `exact` (VIN match), `canonical` (make/model/year exact), `normalized` (fuzzy match), `core_model` (model family), `make_fallback` (make only), `self_price_fallback` (vehicle's own price — blocked for sold vehicles). Higher-precision methods receive confidence bonuses; lower-precision methods widen the confidence interval.

**Competitive Context** — A seller organization's position relative to peers in the same state and nationally. Computed from `organization_vehicles` join counts, ranked by volume. Rendered on the org profile overview tab. See `getOrganizationCompetitiveContext()` in `profileStatsService.ts`.

**Computation Surface** — A UI surface that computes analysis in real time rather than displaying cached values. The vehicle profile is the primary computation surface. Data flows in from the knowledge graph, is computed on render, and flows out as visible intelligence. There is no cache invalidation problem because there is no cache. See `docs/library/technical/design-book/vehicle-profile-computation-surface.md`.

**Condition** — One of the five dimensional shadows. The conservation/restoration assessment of an asset over time. Spectral, not binary — a 0-100 score derived from observations, not a label.

**Confidence Score** — A 0-1 numeric value attached to every observation indicating how reliable the data is. Derived from: source trust weight, match quality, content substance, and corroboration.

**Content Hash** — SHA256 hash of an observation's content. Used for deduplication. If two observations produce the same hash, the second is a duplicate.

**Coaching Flow** — The seller/owner-facing intelligence workflow that transforms ARS from a score into actionable steps. Maps ARS dimension gaps to specific actions (upload photos, add documents, review description) with estimated point gain and sale price impact. Visible only to vehicle owners and contributors. Implements the "Savant Janitor" mode: the user doesn't understand ARS methodology — they just see "take these 5 photos" and do it. See Design Book Ch. 11: CoachingTab.

**Community Pulse** — One of five signal cards on the Vehicle Briefing. Shows sentiment score, top discussion themes, and notable expert comments from auction comment analysis. Renders only when `comment_discoveries` exist for the vehicle. Sources: `comment_discoveries` (sentiment, themes), `bat_user_profiles` (expertise identification). See Design Book Ch. 11: CommunityPulseCard.

## D

**Density Badge** — A compact 5-level visual indicator (●○○○○ through ●●●●●) showing how much the system knows about a vehicle. Appears on every vehicle card in browse/search results. Computed from observation count, source diversity, VIN confirmation, work history presence, and photo coverage. Creates pull: vehicles with deep profiles look rich, motivating owners of thin-profile vehicles to contribute data. The badge answers the meta-question: "How much should I trust what I'm seeing?" See Design Book Ch. 11: DensityBadge.

**Density Level** — The 1-5 integer encoding data depth about a vehicle. Level 1 (Sparse): basic identity only. Level 2 (Thin): some history. Level 3 (Moderate): well-documented. Level 4 (Dense): comprehensive. Level 5 (Bedrock): fully verified with scientific measurements. Stored as `vehicles.density_level`, updated by trigger on observation changes.

**Data Point** — Any single piece of information about an asset. A price, a color, a VIN digit, a photo, a comment. Every data point is an observation with a source, confidence, and timestamp.

**Day Card** — The timeline popup for a specific date. Shows all activity, data, and seven-level analysis for that day. Not a separate component — it is the standard popup rendered for a time-scoped data slice. Contains two layers: raw data (images, technician identity, parts, before/after, receipts) and computed analysis (vehicle, job, client, technician, shop, region, market). See `docs/library/technical/design-book/vehicle-profile-computation-surface.md`.

**Decay** — See Half-Life. Data is testimony that degrades over time. A condition report from 2015 is less trustworthy in 2026 than one from 2024.

**Derivative** — A secondary object created from an asset. Fractional shares (Masterworks), authorized reproductions, licensed merchandise, NFTs. Derivatives are observation sources on the parent, not assets, unless they become collectible.

**Digital Twin** — The complete data representation of a physical asset. At sufficient density, the database doesn't describe the asset — it IS the asset. The five dimensional shadows (spec, current state, condition, provenance, evidence) constitute the twin.

**Dimensional Shadow** — One of five perspectives on any entity: spec (what it should be), current state (what it is now), condition (assessment over time), provenance (chain of custody), evidence (citations for every claim).

**Discrepancy Alert** — A risk signal surfaced by the Intelligence Surface when observations from different sources conflict about the same data point. Example: "Mileage discrepancy: listing says 67K, last title transfer showed 72K." Rendered as the RiskSignalsCard on the Vehicle Briefing with amber severity. Each alert is expandable to show the specific conflicting data points with full provenance (source, timestamp, trust score). Discrepancies are signals, not errors — they may have innocent explanations ("odometer was replaced") but warrant buyer attention. See Design Book Ch. 11: RiskSignalsCard.

**Discrepancy** — A conflict between observations from different sources about the same data point. "Seller says matching numbers, photo shows replacement block." Discrepancies are flagged and scored by severity (trust delta × value impact).

## E

**Era Detection** — The process of identifying phase transitions in a user's expertise landscape over time. A BaT user who specializes in Mustangs for 5 years then switches to trucks has two distinct eras. Detected by tracking dominant make per quarter and identifying sustained shifts. Each era produces its own stylometric fingerprint. Part of the palimpsest model. See `scripts/user-stylometric-analyzer.mjs`.

**Epistemology of Truth** — The framework for understanding data certainty. Four layers: Claims (what sources say), Consensus (where sources agree), Inspection (physical verification), Scientific Test (bedrock measurement). Citation accuracy is the floor, not the ceiling. Consensus can be wrong. The database is uncertainty being gradually reduced. See `~/.claude/projects/-Users-skylar/memory/epistemology-of-truth.md`.

**Expand-Don't-Navigate** — The core interaction principle of the Design Bible's Second Law. When a user clicks an interactive element, the result expands in place (inline panel, overlay, popover) rather than navigating to a new page. The parent context remains visible. Escape or click-outside collapses the expansion. The user never leaves their current position. This eliminates click anxiety because the action is always reversible and the cognitive cost of exploring is zero — no context is lost, no scroll position is reset, no working memory is discarded. Contrast with traditional web navigation where clicking a link replaces the page.

**Edition** — A set of identical or near-identical artworks produced from the same matrix (print plate, mold, photograph negative, conceptual instructions). The edition is a parent entity; individual copies are child assets with independent provenance.

**Entity Resolution** — The process of determining whether a new observation refers to an existing asset or a new one. Uses unique identifiers (VIN, catalogue raisonné number), URL matching, image similarity, and metadata intersection. Never auto-matches below 0.80 confidence.

**Evidence Layer** — The L2 (Layer 2) component of the Intelligence Surface. When a signal card is expanded, the evidence layer renders the full provenance chain backing the signal: comparable sales with photos, conflicting data points with sources, sentiment distributions, observation timelines. Follows the expand-don't-navigate principle: evidence appears below the card, pushing content down, with no page navigation. The existence of the evidence layer is what makes L0/L1 summaries trustworthy — a system that summarizes without showing its work is a black box; a system that summarizes and lets you audit the summary is an intelligence platform.

**Evidence** — One of the five dimensional shadows. Citations for every claim. Every field in the database traces back to a source document, observation, or human input.

**Extraction** — The process of converting raw input (HTML, image, PDF, text) into structured data that fills a schema. The LLM fills the mold -- it doesn't invent the mold.

**Extraction Handbook** — The complete institutional knowledge of the extraction pipeline, at 2,998 lines across 14 chapters and 4 appendices. Documents every extraction method (16), every documented failure (14), every source-specific technical note (11), the prompt evolution arc, and the graduation path. Located at `docs/library/technical/extraction-playbook.md`.

## F

**Function Word Fingerprint** — The unconscious writing signature derived from function word usage rates (the, of, and, to, etc.). The top 100 English function words are produced unconsciously and are the single most diagnostic feature for authorship attribution (Mosteller & Wallace 1964). Topic-independent: they reveal HOW someone thinks, not WHAT they think about. Stored per user in `bat_user_profiles.metadata.stylometric_profile.function_word_fingerprint`. Computed by `scripts/user-stylometric-analyzer.mjs`.

**Five Dimensional Shadows** — See Dimensional Shadow. Spec, current state, condition, provenance, evidence. Every entity exists across all five.

**Freeport** — Tax-free storage facilities (Geneva, Luxembourg, Singapore, Delaware). Assets enter and disappear from public record. A freeport period in a provenance chain is a black zone.

## G

**Ghost Text** — Rotating placeholder text in the command input that cycles through input type examples: "Search vehicles...", "Paste a URL...", "Drop an image...", "Ask anything...". Ghost text solves the discoverability problem of polymorphic inputs — the user learns what the input accepts by reading the examples. Each rotation teaches one capability. Styled in `--text-disabled`, animated with subtle fade (4s cycle), disappears on focus.

**Graph** — The complete network of relationships between assets, actors, and organizations. Not declared (like social media follows) but derived from collaborative traces. The graph IS the knowledge base.

**Graph Density** — The number and quality of connections around an entity. High density = well-documented, well-connected, trustworthy. Low density = sparse data, uncertain.

**Ground Truth** — The current best understanding of reality, established progressively through accumulated observations. Never final — always accumulating. Each new observation makes the truth more true.

**Hapax Legomena** — Words appearing exactly once in a corpus. The ratio of hapax legomena to total unique words measures vocabulary breadth -- high hapax ratio indicates wider vocabulary reach and more unusual word choices. One of the structural stylometric features computed per user.

## H

**Hammer Price** — The final auction sale price. Predicted by `predict-hammer-price` edge function (active cron). Distinct from sale price which may include buyer's premium.

**Header** — The persistent 40px sticky bar at the top of the application viewport. Contains exactly three zones: identity (NUKE wordmark), command (universal input), and session (user capsule). Height is fixed and unconditional — no variants, no stacking, no contextual expansion. The header never contains navigation links, breadcrumbs, page-specific controls, or toolbar slots. Sub-context (where-am-I information) lives in the content area as inline breadcrumbs, never in the header. The header is the last thing to change and the first thing to render. One header. Same everywhere. See Design Book Ch. 5 (The Header), Discourse 2026-03-21.

**Header Chrome** — The total vertical space consumed by navigation elements above the content. In Nuke's target state: 40px (the header alone). In the pre-rework state: up to 136px (header 40px + vehicle tab bar 32px + page header 36px + toolbar slot 28px). Reducing header chrome is a primary design objective because every pixel of chrome is a pixel stolen from content. At 136px on a 900px laptop viewport, 15% of the screen was navigation scaffolding. At 40px, it's 4.4%.

**Half-Life** — The rate at which an observation's trust decays over time. Different categories decay differently: a VIN never decays (permanent physical marking). A condition report decays in 2-3 years. A market estimate decays in months. An owner's claim about mileage decays from the moment it's stated.

**Handler** — An org_staff member who manages logistics, installation, or crating of assets. In art, handlers have significant hidden power — they know where things are and who's moving what.

**Flywheel** — The virtuous cycle created by the Intelligence Surface: user sees briefing → sees gaps → contributes data (photos, documents, corrections) → vehicle gets denser → richer briefing → user trusts system more → contributes more. The coaching flow is the strongest driver: "upload undercarriage photos → +23 points" converts ARS gaps into user action. The density badge amplifies the flywheel by creating social pressure: no owner wants their vehicle to look poorly documented next to a competitor's well-documented one.

## I

**Intelligence Layer** — The abstraction level at which intelligence is presented to users. Four layers: L0 (headline — one sentence, highest severity), L1 (signal cards — 3-5 dimensional insights), L2 (evidence — full provenance chain), L3 (raw graph — complete observation timeline). Most users interact at L0-L1. The Archivist reaches L2-L3 through progressive expansion. Each layer is progressively denser but serves a different user mode (Browser→L0, general user→L1, Archivist→L2-L3). See Design Book Ch. 11.

**Intelligence Surface** — The collective name for the user-facing intelligence components added to the vehicle profile, browse experience, and segment dashboard. The system that makes Nuke's data depth serve vanilla users who don't know the schema. Comprises: Vehicle Briefing (profile), Smart Search + Market Pulse (browse), Seller Coaching (owner view), Segment Dashboard (market view), Density Badges (cross-surface). See Discourse: The Knowing System, Design Book Ch. 11, Engineering Manual: Intelligence Surface Build Guide.

**Interestingness Signal** — A computed score indicating how unusual, story-rich, or attention-worthy a vehicle is, independent of price or condition. Factors: rarity (option combination frequency), story density (provenance chain length), community engagement (comment count, expert attention), anomaly (unusual specs or history), price anomaly (significant deviation from segment). Used to power the "Discover" feed for casual browsers. NEEDS BUILD as of 2026-03-31.

**Information Density** — The amount of meaningful data per pixel of screen space. Nuke optimizes for high information density: 8-11px font sizes, 4px spacing grid, zero decorative elements (no rounded corners, no shadows, no gradients). The Bloomberg Terminal is the density benchmark — financial terminals solved the problem of presenting large structured datasets to professional users decades ago. High density is not clutter; clutter is decorative waste. High density is meaningful data with structural clarity.

**Ingest-Observation** — The single write endpoint for all data entering the system. Every extractor, every user input, every scrape result writes through this one function. The observation mandate.

**Intake** — The single gesture that begins data entry. Command S on a URL. Phone photo. PDF drop. One endpoint accepts everything. Classification happens after storage, not during.

## J

**Jewel** — A low-frequency, high-importance concept from the prompt analysis. Features that appear in few prompts but are architecturally critical: YONO, Photo Sync, Condition Scoring, Autonomous Loop, Nuke Estimate, Observation System, Developer API, Labor Estimation. See JEWELS.md.

## K

**Knowledge Graph** — The materialized relational schema that encodes everything that can be true about assets in a domain. Not a separate graph database — the Postgres tables ARE the graph.

**Layer 0** — The zero-cost foundation of the persona simulation pipeline. Pure structural and lexical analysis of text using math, not LLM calls. Computes stylometric features (sentence length, vocabulary richness, function word frequencies, punctuation signatures, epistemic stance) from raw comment text. See `scripts/user-stylometric-analyzer.mjs`.

**Knowing System** — The design philosophy where the system does the knowing and the user does the deciding. No user learns the schema. The system determines what information is relevant, what patterns are significant, and what the user needs to know. The user's job is to absorb the briefing and make a decision. The boundary is permanent: the system presents information, not recommendations. It says "this truck is priced 18% below comps" (information), not "you should buy this" (recommendation). Crossing the boundary into decision-making would require liability and data quality that no system achieves. See Discourse: The Knowing System.

## L

**Listing Preview** — A coaching component that generates a platform-appropriate listing description from all known vehicle data. Assembled by AI from structured data (specs, observations, work history, photos analyzed). Gaps are surfaced inline as `[MISSING: ...]` tags — not errors but calls to action. Users can edit the generated text before copying. Platform selector adjusts tone and format (BaT, C&B, Hemmings, Craigslist). Located on the CoachingTab of the vehicle profile (owner view only). See Design Book Ch. 11: ListingPreview.

**Library** — Two meanings: (1) This documentation system, organized like a traditional library. (2) The reference data corpus (RPO codes, paint codes, catalogue raisonnés, service manuals) that the extraction pipeline validates against.

## M

**Machine** — One of 11 Deleuzian assemblages that constitute Nuke's body: eye (vision), mouth (ingestion), gut (processing), skeleton (infrastructure), brain (intelligence), wallet (valuation), nose (discovery), memory (provenance), skin (UI), voice (API), hands (curation). See RHIZOME.md.

**Market Position Card** — One of five signal cards on the Vehicle Briefing. Shows the vehicle's price relative to comparable sales: asking price, comparable range (min-max), median comparable, and number of sales in the comparison set. Expandable to a full CompGrid showing each comparable with photo, price, date, platform, and similarity score. Renders when `nuke_estimate` exists or `price_comparables` has >=3 rows. See Design Book Ch. 11.

**Market Pulse** — A compact section on the browse page showing real-time market activity: trending segments (by bid velocity and price momentum), notable sales (deviations from estimate), and active inventory counts. Each item is clickable for drill-down. Data source: `market_snapshots`, `market_segment_stats`, recent `auction_events`. See Design Book Ch. 11.

**Materialization Layer** — The system layer where knowledge graph data is transformed into visible intelligence. The vehicle profile is the primary materialization layer. Raw observations enter the graph from many sources; the materialization layer reads the graph and computes analysis on render. The profile surface shows summaries; popups (Day Cards) show full-resolution computation. See `docs/library/technical/design-book/vehicle-profile-computation-surface.md`.

**Material Honesty** — The design principle that interface elements should look like what they are. A screen is flat — so no shadows pretend depth. Pixels are square — so no rounded corners pretend softness. A container is a rectangle — so its edges are straight lines. The principle extends from visual treatment to interaction: a button looks clickable, an input looks typeable, a badge looks expandable. Material honesty eliminates cognitive overhead because the user doesn't need to decode what an element does — its visual appearance declares its function. See also: Win95 lineage in Design Book Ch. 1 (Foundations).

**Magazine** — Not a vertical. A validation layer and observation source that feeds into every other vertical. A physical receipt that something mattered. Magazines validate assets and actors through editorial selection.

**Materialized View** — A database view that stores computed results for fast reads. Used to present observation data in the shape of legacy tables (auction_comments, vehicle_events) without maintaining separate write paths.

## N

**Nested Header** — The recognition that a web application's header exists inside a browser's chrome (tab bar + URL bar), which exists inside an operating system's chrome (menu bar). Each nesting layer adds navigation overhead and steals content space. The application header is always the third-most-prominent bar on screen — it cannot compete with the browser for transport control or the OS for system control. It can only serve its own scope (application identity, action, session) in the fewest pixels possible. This is why Nuke's header is 40px and contains only three zones.

**Nuke Estimate** — The system's computed valuation for an asset. A Zestimate for collector vehicles and art. Derived from comparable sales, trajectory analysis, condition assessment, and provenance strength, with confidence scoring and source citations.

## O

**Observation** — The fundamental unit of data in Nuke. Every piece of information is an observation from a source with a trust weight, confidence score, and timestamp. Comments, listings, images, metadata, user inputs — all observations.

**Observation Source** — A registered origin of observations. Each source has a slug, display name, category, base trust score, and list of supported observation kinds. BaT (trust: 0.85), Christie's (trust: 0.90), Instagram (trust: 0.40).

**Ontology** — The formal specification of everything that can be true about entities in a domain. For vehicles: ~950 tables, ~5,000-8,000 columns. For art: comparable scale. The ontology IS the schema. The schema IS the prompt.

**Organic** — The principle that connections between actors should emerge naturally from the graph, not from algorithmic recommendation. No feeds, no "you might like," no engagement optimization. The system enables meetings — it doesn't perform them.

**Ownership Classification** — The relationship between a seller and a vehicle at the time of sale. Derived from regex patterns on listing descriptions (BaT, Mecum). Values map to `organization_vehicles.relationship_type`: `owner` (seller acquired and held), `consigner` (seller handles on behalf of original owner), `supplier_build` (seller built or restored the vehicle). "sold_by" is the generic fallback when no signal is found. Classification is a Claims-layer judgment — "the listing says this" — not verified truth. See `extract-bat-core/index.ts` ownership classifier.

**Organization Sandbox** — A provenance container holding an organization's data records that lack verifiable identifiers (VIN, chassis number, accession number). Not a penalty — a trust boundary. Records in the sandbox are incomplete testimony at the Claims layer of the epistemological hierarchy. When another source provides a matching identifier, the record graduates to the main corpus. The sandbox makes each organization's verifiable contribution a measurable, public number. See Encyclopedia Section 18: Entity Resolution. Synonym: Provenance Container.

## P

**Palimpsest** — A manuscript that has been written on, scraped off, and rewritten, with earlier layers still partially visible. In Nuke, the palimpsest model describes how a user's expertise evolves over time: each era (e.g., 5 years of Porsche, then a switch to trucks) is a layer that remains visible in their writing style even after the topical shift. Style is permanent; topic is temporal. The palimpsest is one of 7 novel ontological contributions identified in the applied ontology research.

**Permanent Interface** — An interface element that solves a problem which hasn't changed and won't change. The scroll bar (content exceeds container), the menu bar (applications have actions), the address bar (users need location awareness), the search box (information exceeds browsability). The test: remove the element; if the user is stuck within seconds, it's permanent. If they adjust within minutes, it was trend. The header is permanent because its function (identity + command + session) hasn't changed. See Contemplation: The Permanent Interface.

**Pipeline Registry** — The `pipeline_registry` table mapping every table.column to its owning edge function. Prevents duplicate tools and data forks. Check before writing to any field.

**Portal** — What a badge becomes when clicked. Every badge in the UI is a portal into the cluster it represents. Year portals, make portals, artist portals, medium portals. Clicking opens, clicking closes.

**Progressive Density** — The principle that a vehicle profile renders at whatever resolution the data supports. Sparse vehicles show minimal facts (year/make/model, maybe a photo). Dense vehicles show full computational analysis (timeline, classified photos, seven-level benchmarks). Bedrock vehicles add scientific measurements. Empty sections never render. No placeholders, no skeleton UI, no "No data available" messages. The profile is honest about what it knows. See `docs/library/technical/design-book/vehicle-profile-computation-surface.md`.

**Provenance** — One of the five dimensional shadows. The complete chain of custody for an asset — who owned it, when, how acquired, how disposed, with citations. Provenance determines authenticity, legality, and a significant portion of value.

**Provenance Container** — Synonym for Organization Sandbox. A holding area for records from a specific data source that lack verifiable identifiers. The container is scoped to the organization that produced the data and is publicly visible. Records graduate when corroborating identifiers arrive from any source.

**Photo Coaching** — A coaching component that shows the 41-zone image angle spectrum with coverage status for a specific vehicle. Each zone (front 3/4, undercarriage, engine bay detail, odometer, etc.) is marked as covered or needed. "NEEDED" zones link directly to the photo upload interface with the zone pre-selected. Addresses the use case "What photos do I need?" without the seller needing to know platform-specific requirements. See Design Book Ch. 11: PhotoCoaching.

## Q

**Query Model** — The dominant paradigm for data access where the user formulates a question and the system returns an answer. SQL is the purest expression. Every search box is a simplified query interface. The query model fails when users don't know what questions to ask, when the most valuable information is non-obvious, or when answers require synthesizing data across many dimensions. The Briefing Model inverts this: the system presents rather than waits to be asked. See Discourse: The Knowing System, Section II.

**Quality Score** — A 0-1 assessment of extraction completeness and reliability. Derived from: fields extracted / total fields, weighted by field importance. Below 0.30 triggers review. Below 0.40 triggers escalation to a higher agent tier.

**Question Intelligence** — The system that classifies 1.65M auction comment questions into a 2-level taxonomy (12 L1 categories, 112 L2 subcategories) to reveal what buyers actually want to know. Data flows: `auction_comments.has_question` → regex classification (`analyze-comments-fast`, mode `question_classify`) → LLM fallback (`batch-comment-discovery`, mode `question_classify_llm`) → `mv_question_intelligence` materialized view → `question_gap_analysis()` RPC. Dashboard: `/admin/qi`. The taxonomy was discovered by sampling ~5K questions, classifying via Gemini Flash, consolidating via LLM, and extracting TF-IDF regex patterns. See `scripts/question-taxonomy-discovery.mjs`.

**Question Taxonomy** — The `question_taxonomy` table. 112 entries, each with `id` (format: `l1.l2`), `display_name`, `regex_patterns`, `keywords`, `answerable_from_db`, and `data_fields`. L1 categories: mechanical, provenance, cosmetics, features, logistics, auction_process, vehicle_details, community, legal_and_regulatory, vehicle_history, valuation, general. Populated by the discovery pipeline (`npm run discover:questions`).

**Question Classification** — The process of tagging each question comment with its taxonomy category. Two tiers: Tier 1 regex ($0, ~79% hit rate) via `analyze-comments-fast` mode `question_classify`; Tier 2 Gemini Flash LLM ($0) via `batch-comment-discovery` mode `question_classify_llm`. Results stored on `auction_comments`: `question_primary_l1`, `question_primary_l2`, `question_categories` (JSONB array of top matches), `question_classified_at`, `question_classify_method`.

**Question Data Gap** — A taxonomy category where `answerable_from_db = false` — buyers ask about it but no structured DB field can answer it. Examples: video requests, seller responsiveness, provenance value, bidding strategy. Gaps inform what data to collect next or what features to build.

## R

**Rhizome** — Deleuzian concept. A network with no center, no hierarchy, no beginning or end. Nuke's architecture is rhizomatic — every concept connects to every other. The observation system is the purest expression. See RHIZOME.md.

**Resolution** — See Entity Resolution.

**Savant Janitor** — One of three user modes (not personas — modes). The Savant Janitor has 400 photos on their phone, receipts in the glovebox, and doesn't want to organize anything. They want to dump everything into the system and have it sort itself. Their need is a drain — an endpoint that accepts everything and classifies it. The Coaching Flow serves Savant Janitors by telling them exactly what to do next without requiring them to understand the system's structure. See Contemplation: The Three Users and the Finder.

**Segment Dashboard** — A market-level intelligence surface for a vehicle segment (all K5 Blazers, all C10s). Route: `/market/:make/:model`. Shows: price trend chart, recent sales with photos, active listings, segment statistics (avg DOM, sell-through rate, common configurations, price by condition tier). The segment dashboard is where enthusiasts track markets, buyers do deep comp research, and sellers time their listings. See Design Book Ch. 11: SegmentDashboard.

**Signal Card** — A self-contained intelligence unit on the Vehicle Briefing (L1 layer). Each card presents one dimension of analysis with a title, key metric, supporting detail, and expandable evidence. Five types: MarketPositionCard, TrustAssessmentCard, RiskSignalsCard, CommunityPulseCard, HistoryPatternCard. Each self-guards against missing data — if the card has nothing to show, it doesn't render. Cards expand in-place (expand-don't-navigate) to reveal their evidence layer (L2). See Design Book Ch. 11.

**Smart Search** — The natural-language-to-structured-query search interface. Accepts human language ("red trucks under 30k from the seventies") and decomposes it into structured filters using client-side regex pattern matching (no API call). Extracted filters appear as removable pills below the search bar. What remains after extraction becomes the text search query. The user doesn't need to know that `body_style: truck` is a filter — they type naturally and the system translates. See Design Book Ch. 11: SmartSearchBar.

## S

**Snapshot** — An archived copy of a web page stored in `listing_page_snapshots`. Created automatically by `archiveFetch()`. Contains raw HTML and/or markdown representation. Snapshots enable re-extraction from stored content without re-fetching. The table holds 440K+ snapshots totaling 79GB. Snapshots are being migrated to Supabase Storage via `migrate-snapshots-to-storage` cron.

**Stylometric Profile** — The quantitative writing fingerprint of a BaT user, computed from their comment history using zero-cost structural analysis. Includes: writing signature (sentence/comment length distributions), vocabulary metrics (Yule's K, TTR, hapax ratio), function word fingerprint (top 20 per-1000-word rates), punctuation signature, opening patterns, self/other reference rates, epistemic stance (hedging vs boosting), taste fingerprint (make distribution), and comment role distribution. Stored as JSONB in `bat_user_profiles.metadata.stylometric_profile`. Methodology grounded in Mosteller-Wallace, Yule, Pennebaker, Hyland, and Stamatatos.

**Schema** — The structured definition of what data to extract from a source. The schema IS the prompt — hand the LLM a schema and raw input, it fills the fields and cites everything. Domain-specific (vehicle schema, artwork schema) but the extraction mechanism is universal.

**Sub-Context** — Positional information ("where am I in the knowledge graph") rendered as the first line of the content area, not as a header appendage. Styled as 8px ALL CAPS breadcrumb labels in `--text-secondary` with `→` separators. Maximum 4 levels deep: `VEHICLES → 1977 K5 BLAZER → SERVICE HISTORY → INVOICE #4471`. Each segment is clickable except the last (current position). Sub-context scrolls with the content — it is not sticky, not a separate bar, not part of the header. The principle: breadcrumbs are a confession of complexity. If the interface needs them, they should live in the content where the complexity lives, not in the chrome above it.

**Seven-Level Analysis** — The contextual analysis framework for any work event on the vehicle profile: (1) Vehicle — build arc position and trajectory, (2) Job — operation benchmarked against national medians, (3) Client — communication and payment patterns, (4) Technician — speed, quality, and specialization match, (5) Shop — throughput, capacity, and quality metrics, (6) Region — local labor rates, parts availability, specialist density, (7) Market/National — national benchmarks and ROI trajectory. Each level adds comparative context that converts experience into measured fact. See `docs/library/technical/design-book/vehicle-profile-computation-surface.md`.

**Signal** — Computed from weighted recent activity against an actor's profile. Signal = Σ(observation_weight × source_trust × recency_decay × anomaly_factor). Signal is what emerges from the graph — not what users declare about themselves.

**Source Trust** — The base reliability weight assigned to an observation source. Museum databases (0.95) > auction houses (0.90) > galleries (0.80) > social media (0.40) > anonymous (0.20). Contextual modifiers apply.

**Spec** — One of the five dimensional shadows. What an entity should be according to definitive sources. Factory build sheet for vehicles. Catalogue raisonné entry for art. The reference standard against which current state is compared.

**Seller Track Record** — Per-vehicle historical data for an organization acting as seller. Includes each vehicle sold with sale price, date, ownership classification, nuke estimate (if non-circular), and estimate confidence. Aggregated into GMV by year, volume by quarter, and state distribution. Rendered on the organization profile overview tab. Computed in `profileStatsService.ts` from `organization_vehicles` + `vehicles` + `nuke_estimates`.

**Strangler Fig** — The migration pattern. The new system grows around the old one, gradually replacing it. Art launches on the new platform, vehicles migrate after the pattern is proven. Neither system stops during the transition.

## T

**Trust Assessment Card** — One of five signal cards on the Vehicle Briefing. Shows documentation depth: total observation count, source diversity, VIN confirmation status, and three sub-dimensions (Identity: STRONG/MODERATE/THIN, Provenance: same, Condition: same). The trust card always renders if the vehicle exists — even a sparse vehicle shows "limited data." Expandable to source list with observation counts and trust scores. The trust card is how the system communicates its own uncertainty — honest about what it knows and doesn't know. See Design Book Ch. 11.

**Testimony** — What observations actually are. Data is testimony from sources with varying reliability. Testimony has half-lives. A seller's description is testimony. A museum catalog entry is testimony. Both decay, at different rates.

**Timeline Event** — The atomic unit of the vehicle timeline. Everything that happens to a vehicle is a timeline event: factory build, ownership transfers, auction appearances, work performed, parts installed or transferred, photos taken, inspections, title events, accidents, modifications, community mentions. There are no parallel tracking systems. A build log is the timeline filtered to work events. A photo gallery is the timeline filtered to image events. A service history is the timeline filtered to maintenance events. See `docs/library/technical/design-book/vehicle-profile-computation-surface.md`.

**Treemap Pop-Through** — The interaction pattern where clicking a badge explodes into a treemap of its contents, and clicking within that treemap drills deeper. Infinite depth, always reversible.

**Trust Weight** — See Source Trust and Confidence Score. Every observation carries both: the source's base trust and the specific observation's confidence.

## U

**User Capsule** — The rightmost element of the header. Contains: user avatar (28px square, 2px border), notification indicator (6px red dot at top-right), and dropdown trigger. Communicates session state at a glance. The avatar uses initials as fallback when no profile image exists. The notification dot is Rosso red (#E4002B) regardless of active colorway — it must always be visible.

**Unified Asset Layer** — See Asset Registry. The thin `assets` table that sits above all domain-specific entities and enables cross-domain operations.

**Universal Matcher** — See Entity Resolution. One function, shared by all extractors, all domains.

**Use Case Atlas** — The canonical catalog of all hypothesized user interactions with the Nuke platform. 47 use cases across 11 archetypes (Buyer pre/post, Seller, Enthusiast, Builder, Mechanic, Dealer, Casual Browser, Appraiser, Journalist, Post-Sale). Each use case specifies: situation, need, data source, surface, intelligence layer, infrastructure status, and priority. Key finding: 64% of use cases have PARTIAL infrastructure (data exists, UI doesn't surface it). The gap is overwhelmingly a surface area gap, not a data gap. See `docs/library/intellectual/papers/use-case-atlas.md`.

## V

**Value Badge** — A subtle badge on vehicle cards in browse results indicating deal quality relative to the system's estimate. Levels: GOOD DEAL (10-20% below estimate), GREAT DEAL (20%+ below), ABOVE MARKET (10%+ above), no badge (within ±10% or no estimate). Green for good/great deals, amber for above market. Source: `nuke_estimate` vs. current listing price. See Design Book Ch. 11: ValueBadge.

**Vehicle Briefing** — The master intelligence component on the vehicle profile page. Positioned below the hero image, above the sub-header. Contains the BriefingHeadline (L0) and up to 5 SignalCards (L1), each expandable to an evidence layer (L2). Self-guards: renders nothing if no intelligence data is available (progressive density). Implements the Briefing Model — the system presents rather than waiting to be queried. The single highest-leverage feature for making data depth serve vanilla users. See Design Book Ch. 11, Engineering Manual: Intelligence Surface Build Guide, Discourse: The Knowing System.

**Validation Layer** — What magazines are. Not content creators but validators — their editorial selection confirms that an asset, artist, or event matters. A magazine feature is a high-trust observation, not a product.

**Widget** — A self-contained analysis module in the Analysis Engine. Each widget computes a specific intelligence signal for a vehicle (e.g., sell-through probability, rerun decay, completion discount, geographic arbitrage). 14 widgets registered in `analysis_widgets` table across 6 categories. Each produces a signal stored in `analysis_signals` with severity, confidence, and actionable recommendations.

## W

**Work Session** — A record in the `work_sessions` table representing a single day's work on a vehicle. Contains: session_date, work_type (fabrication, heavy_work, parts_and_work, parts_received, work), duration_minutes, image_count, total_parts_cost, total_labor_cost, total_job_cost, work_description, technician_id, zones_touched, and evidence links. Created by the work photo pipeline (`drop-folder-ingest.mjs`, `activity-linker.mjs`). Work sessions are merged into the vehicle timeline by `VehicleProfileContext.loadTimelineEvents()` as `event_type: 'work_session'` entries. Clicking a work session day on the BarcodeTimeline opens a Day Card popup with full-resolution detail via the `get_daily_work_receipt` RPC. Not a parallel system to timeline events — a data source that feeds into the same timeline.

**Wordmark** — The text "NUKE" rendered in the top-left of the header. Arial, 13px, bold, uppercase, 0.10em letter-spacing. Functions as: (1) brand identity, (2) home navigation (click to go to /), (3) ontological anchor ("you are inside the knowledge graph"). The wordmark IS the logo — no icon, no symbol, no graphic. The simplicity is the identity. NUKE stays as the full word in all contexts; abbreviating to "N1" or similar was considered and rejected because the name is already maximally compressed at four characters.

**Write Path** — The single route through which all data enters the system: `ingest-observation`. No direct writes to legacy tables. One path, one audit trail, one dedup mechanism.

## Y

**YONO (You Only Nuke Once)** — Local AI model for image classification. EfficientNet-based, ONNX exported. Eliminates cloud inference costs at scale ($0 vs $34K for 34M images). Sidecar live on Modal (2 warm containers). Consumer API deployed via `api-v1-vision`. Hierarchical classification: tier-1 family, tier-2 make (58 makes). Zone classifier (41 zones, 72.8% accuracy). Condition analysis via Florence-2 vision. Pipeline globally PAUSED via `NUKE_ANALYSIS_PAUSED` flag.

**Yule's K** — A vocabulary richness measure that is approximately independent of text length (Yule 1944). K = 10^4 * (M2 - N) / N^2. Lower K = richer vocabulary. Typical ranges: literary prose 80-120, academic writing 100-150, forum comments 120-200+, formulaic writing 200+. The primary cross-user vocabulary comparison metric because unlike Type-Token Ratio, it is length-normalized. Computed per user in stylometric profiles.

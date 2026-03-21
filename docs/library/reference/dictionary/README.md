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

**Audit Trail** — The metadata attached to every observation: source_id, agent_tier, confidence_score, extraction_timestamp, raw_source_reference. Every field has a birth certificate.

## B

**Badge** — A clickable data token in the UI. "1991", "GMC", "V3500", "Basquiat", "1982", "Acrylic" — each is a badge. Badges are portals, not labels. Clicking a badge explodes into the cluster it belongs to.

**Black Zone** — A period or location where an asset disappears from the provenance record. Freeports, undocumented storage, provenance gaps. Black zones are data — the absence of records is itself informative.

**Body Without Organs (BwO)** — Deleuzian concept. In Nuke, the observation system is the BwO — it has no single home, belongs to every machine equally, and dissolves boundaries between all data types. See RHIZOME.md.

## C

**Catalogue Raisonné** — The definitive published catalog of an artist's complete works. The ground truth reference for art, like a factory build sheet is for vehicles. Highest trust source for artwork identification and attribution.

**Click Anxiety** — The fear of clicking because the system might navigate away, lose context, break, or dead-end. The fear correlates with the irreversibility of the action — hovering creates zero anxiety, expanding in place creates low anxiety, navigating to a new page creates high anxiety. Nuke eliminates click anxiety through reversible-in-place interactions. Every click opens, every click closes. Trust accumulates through repetition: ~7 successful interactions establish a model, ~20 build habit, ~50 build love. One broken interaction destroys the trust built by four good ones — the asymmetry of trust destruction mandates zero exceptions in the interaction model. See Contemplation: Click Anxiety and Digital Trust.

**Command Input** — The universal input field occupying the center of the header. Not a search bar — a polymorphic intent resolver. Accepts: search queries, URLs for extraction, VINs for lookup, year-make-model patterns, natural language questions, and dragged images. Each input type is detected by cascading pattern matchers (URL regex > VIN regex > YMM pattern > keyword router > search fallback) and routed to the appropriate handler. The routing is invisible to the user. Ghost text rotates capabilities: "Search vehicles...", "Paste a URL...", "Drop an image...", "Ask anything...". Focused via Cmd+K from anywhere. Results appear as overlays (not navigation), preserving context. See Paper: The Agentic Header.

**Command Palette** — An interface pattern (popularized by VS Code's Cmd+P, macOS Spotlight, Raycast) where a text input searches across actions, files, commands, and settings. The agentic header extends this pattern by making it the primary navigation surface rather than a secondary shortcut, and by accepting polymorphic input (not just text commands).

**Context Stacking** — The interaction model where opening a new view does not close the previous one. Clicking a badge opens a panel; clicking within that panel can open another panel; Escape peels off one layer at a time. Like papers on a desk — you can always see the edges of what's underneath. The opposite of context switching, where navigating to a new view replaces the current one. Context stacking preserves the user's working memory and eliminates the need for the back button within exploratory interactions.

**Collaborative Trace** — A connection between two actors derived from shared involvement with an asset or organization. Not declared ("follow/following") but evidenced by transactions, exhibitions, publications, or co-ownership. Permanent and financial.

**Condition** — One of the five dimensional shadows. The conservation/restoration assessment of an asset over time. Spectral, not binary — a 0-100 score derived from observations, not a label.

**Confidence Score** — A 0-1 numeric value attached to every observation indicating how reliable the data is. Derived from: source trust weight, match quality, content substance, and corroboration.

**Content Hash** — SHA256 hash of an observation's content. Used for deduplication. If two observations produce the same hash, the second is a duplicate.

## D

**Data Point** — Any single piece of information about an asset. A price, a color, a VIN digit, a photo, a comment. Every data point is an observation with a source, confidence, and timestamp.

**Decay** — See Half-Life. Data is testimony that degrades over time. A condition report from 2015 is less trustworthy in 2026 than one from 2024.

**Derivative** — A secondary object created from an asset. Fractional shares (Masterworks), authorized reproductions, licensed merchandise, NFTs. Derivatives are observation sources on the parent, not assets, unless they become collectible.

**Digital Twin** — The complete data representation of a physical asset. At sufficient density, the database doesn't describe the asset — it IS the asset. The five dimensional shadows (spec, current state, condition, provenance, evidence) constitute the twin.

**Dimensional Shadow** — One of five perspectives on any entity: spec (what it should be), current state (what it is now), condition (assessment over time), provenance (chain of custody), evidence (citations for every claim).

**Discrepancy** — A conflict between observations from different sources about the same data point. "Seller says matching numbers, photo shows replacement block." Discrepancies are flagged and scored by severity (trust delta × value impact).

## E

**Expand-Don't-Navigate** — The core interaction principle of the Design Bible's Second Law. When a user clicks an interactive element, the result expands in place (inline panel, overlay, popover) rather than navigating to a new page. The parent context remains visible. Escape or click-outside collapses the expansion. The user never leaves their current position. This eliminates click anxiety because the action is always reversible and the cognitive cost of exploring is zero — no context is lost, no scroll position is reset, no working memory is discarded. Contrast with traditional web navigation where clicking a link replaces the page.

**Edition** — A set of identical or near-identical artworks produced from the same matrix (print plate, mold, photograph negative, conceptual instructions). The edition is a parent entity; individual copies are child assets with independent provenance.

**Entity Resolution** — The process of determining whether a new observation refers to an existing asset or a new one. Uses unique identifiers (VIN, catalogue raisonné number), URL matching, image similarity, and metadata intersection. Never auto-matches below 0.80 confidence.

**Evidence** — One of the five dimensional shadows. Citations for every claim. Every field in the database traces back to a source document, observation, or human input.

**Extraction** — The process of converting raw input (HTML, image, PDF, text) into structured data that fills a schema. The LLM fills the mold — it doesn't invent the mold.

## F

**Five Dimensional Shadows** — See Dimensional Shadow. Spec, current state, condition, provenance, evidence. Every entity exists across all five.

**Freeport** — Tax-free storage facilities (Geneva, Luxembourg, Singapore, Delaware). Assets enter and disappear from public record. A freeport period in a provenance chain is a black zone.

## G

**Ghost Text** — Rotating placeholder text in the command input that cycles through input type examples: "Search vehicles...", "Paste a URL...", "Drop an image...", "Ask anything...". Ghost text solves the discoverability problem of polymorphic inputs — the user learns what the input accepts by reading the examples. Each rotation teaches one capability. Styled in `--text-disabled`, animated with subtle fade (4s cycle), disappears on focus.

**Graph** — The complete network of relationships between assets, actors, and organizations. Not declared (like social media follows) but derived from collaborative traces. The graph IS the knowledge base.

**Graph Density** — The number and quality of connections around an entity. High density = well-documented, well-connected, trustworthy. Low density = sparse data, uncertain.

**Ground Truth** — The current best understanding of reality, established progressively through accumulated observations. Never final — always accumulating. Each new observation makes the truth more true.

## H

**Header** — The persistent 40px sticky bar at the top of the application viewport. Contains exactly three zones: identity (NUKE wordmark), command (universal input), and session (user capsule). Height is fixed and unconditional — no variants, no stacking, no contextual expansion. The header never contains navigation links, breadcrumbs, page-specific controls, or toolbar slots. Sub-context (where-am-I information) lives in the content area as inline breadcrumbs, never in the header. The header is the last thing to change and the first thing to render. One header. Same everywhere. See Design Book Ch. 5 (The Header), Discourse 2026-03-21.

**Header Chrome** — The total vertical space consumed by navigation elements above the content. In Nuke's target state: 40px (the header alone). In the pre-rework state: up to 136px (header 40px + vehicle tab bar 32px + page header 36px + toolbar slot 28px). Reducing header chrome is a primary design objective because every pixel of chrome is a pixel stolen from content. At 136px on a 900px laptop viewport, 15% of the screen was navigation scaffolding. At 40px, it's 4.4%.

**Half-Life** — The rate at which an observation's trust decays over time. Different categories decay differently: a VIN never decays (permanent physical marking). A condition report decays in 2-3 years. A market estimate decays in months. An owner's claim about mileage decays from the moment it's stated.

**Handler** — An org_staff member who manages logistics, installation, or crating of assets. In art, handlers have significant hidden power — they know where things are and who's moving what.

## I

**Information Density** — The amount of meaningful data per pixel of screen space. Nuke optimizes for high information density: 8-11px font sizes, 4px spacing grid, zero decorative elements (no rounded corners, no shadows, no gradients). The Bloomberg Terminal is the density benchmark — financial terminals solved the problem of presenting large structured datasets to professional users decades ago. High density is not clutter; clutter is decorative waste. High density is meaningful data with structural clarity.

**Ingest-Observation** — The single write endpoint for all data entering the system. Every extractor, every user input, every scrape result writes through this one function. The observation mandate.

**Intake** — The single gesture that begins data entry. Command S on a URL. Phone photo. PDF drop. One endpoint accepts everything. Classification happens after storage, not during.

## J

**Jewel** — A low-frequency, high-importance concept from the prompt analysis. Features that appear in few prompts but are architecturally critical: YONO, Photo Sync, Condition Scoring, Autonomous Loop, Nuke Estimate, Observation System, Developer API, Labor Estimation. See JEWELS.md.

## K

**Knowledge Graph** — The materialized relational schema that encodes everything that can be true about assets in a domain. Not a separate graph database — the Postgres tables ARE the graph.

## L

**Library** — Two meanings: (1) This documentation system, organized like a traditional library. (2) The reference data corpus (RPO codes, paint codes, catalogue raisonnés, service manuals) that the extraction pipeline validates against.

## M

**Machine** — One of 11 Deleuzian assemblages that constitute Nuke's body: eye (vision), mouth (ingestion), gut (processing), skeleton (infrastructure), brain (intelligence), wallet (valuation), nose (discovery), memory (provenance), skin (UI), voice (API), hands (curation). See RHIZOME.md.

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

## P

**Permanent Interface** — An interface element that solves a problem which hasn't changed and won't change. The scroll bar (content exceeds container), the menu bar (applications have actions), the address bar (users need location awareness), the search box (information exceeds browsability). The test: remove the element; if the user is stuck within seconds, it's permanent. If they adjust within minutes, it was trend. The header is permanent because its function (identity + command + session) hasn't changed. See Contemplation: The Permanent Interface.

**Pipeline Registry** — The `pipeline_registry` table mapping every table.column to its owning edge function. Prevents duplicate tools and data forks. Check before writing to any field.

**Portal** — What a badge becomes when clicked. Every badge in the UI is a portal into the cluster it represents. Year portals, make portals, artist portals, medium portals. Clicking opens, clicking closes.

**Provenance** — One of the five dimensional shadows. The complete chain of custody for an asset — who owned it, when, how acquired, how disposed, with citations. Provenance determines authenticity, legality, and a significant portion of value.

## Q

**Quality Score** — A 0-1 assessment of extraction completeness and reliability. Derived from: fields extracted / total fields, weighted by field importance. Below 0.30 triggers review. Below 0.40 triggers escalation to a higher agent tier.

## R

**Rhizome** — Deleuzian concept. A network with no center, no hierarchy, no beginning or end. Nuke's architecture is rhizomatic — every concept connects to every other. The observation system is the purest expression. See RHIZOME.md.

**Resolution** — See Entity Resolution.

## S

**Schema** — The structured definition of what data to extract from a source. The schema IS the prompt — hand the LLM a schema and raw input, it fills the fields and cites everything. Domain-specific (vehicle schema, artwork schema) but the extraction mechanism is universal.

**Sub-Context** — Positional information ("where am I in the knowledge graph") rendered as the first line of the content area, not as a header appendage. Styled as 8px ALL CAPS breadcrumb labels in `--text-secondary` with `→` separators. Maximum 4 levels deep: `VEHICLES → 1977 K5 BLAZER → SERVICE HISTORY → INVOICE #4471`. Each segment is clickable except the last (current position). Sub-context scrolls with the content — it is not sticky, not a separate bar, not part of the header. The principle: breadcrumbs are a confession of complexity. If the interface needs them, they should live in the content where the complexity lives, not in the chrome above it.

**Signal** — Computed from weighted recent activity against an actor's profile. Signal = Σ(observation_weight × source_trust × recency_decay × anomaly_factor). Signal is what emerges from the graph — not what users declare about themselves.

**Source Trust** — The base reliability weight assigned to an observation source. Museum databases (0.95) > auction houses (0.90) > galleries (0.80) > social media (0.40) > anonymous (0.20). Contextual modifiers apply.

**Spec** — One of the five dimensional shadows. What an entity should be according to definitive sources. Factory build sheet for vehicles. Catalogue raisonné entry for art. The reference standard against which current state is compared.

**Strangler Fig** — The migration pattern. The new system grows around the old one, gradually replacing it. Art launches on the new platform, vehicles migrate after the pattern is proven. Neither system stops during the transition.

## T

**Testimony** — What observations actually are. Data is testimony from sources with varying reliability. Testimony has half-lives. A seller's description is testimony. A museum catalog entry is testimony. Both decay, at different rates.

**Treemap Pop-Through** — The interaction pattern where clicking a badge explodes into a treemap of its contents, and clicking within that treemap drills deeper. Infinite depth, always reversible.

**Trust Weight** — See Source Trust and Confidence Score. Every observation carries both: the source's base trust and the specific observation's confidence.

## U

**User Capsule** — The rightmost element of the header. Contains: user avatar (28px square, 2px border), notification indicator (6px red dot at top-right), and dropdown trigger. Communicates session state at a glance. The avatar uses initials as fallback when no profile image exists. The notification dot is Rosso red (#E4002B) regardless of active colorway — it must always be visible.

**Unified Asset Layer** — See Asset Registry. The thin `assets` table that sits above all domain-specific entities and enables cross-domain operations.

**Universal Matcher** — See Entity Resolution. One function, shared by all extractors, all domains.

## V

**Validation Layer** — What magazines are. Not content creators but validators — their editorial selection confirms that an asset, artist, or event matters. A magazine feature is a high-trust observation, not a product.

## W

**Wordmark** — The text "NUKE" rendered in the top-left of the header. Arial, 13px, bold, uppercase, 0.10em letter-spacing. Functions as: (1) brand identity, (2) home navigation (click to go to /), (3) ontological anchor ("you are inside the knowledge graph"). The wordmark IS the logo — no icon, no symbol, no graphic. The simplicity is the identity. NUKE stays as the full word in all contexts; abbreviating to "N1" or similar was considered and rejected because the name is already maximally compressed at four characters.

**Write Path** — The single route through which all data enters the system: `ingest-observation`. No direct writes to legacy tables. One path, one audit trail, one dedup mechanism.

## Y

**YONO (You Only Nuke Once)** — Local AI model for image classification. EfficientNet-based, ONNX exported. Eliminates cloud inference costs at scale ($0 vs $34K for 34M images). Trained but not yet integrated into the pipeline.

# NUKE DESIGN INTERFACE ENCYCLOPEDIA

**The canonical implementation reference for the nuke.ag interface.**

This is not a style guide. Not a mood board. Not a set of suggestions. This is an engineering specification. Every visual decision, every component behavior, every token value, every violation pattern is documented here. After reading this, there is no ambiguity.

---

## THE THREE ABSOLUTE RULES

```
NO border-radius.  NO box-shadow.  NO hardcoded hex colors.

These are enforced by !important CSS and ESLint.
They are not negotiable. They are not oversights.
They are not "to be revisited later."
```

---

## THE THREE DESIGN LAWS

**1. Every Data Point is a Live Badge.** Every piece of data on screen is clickable. Every click explodes into its cluster or collapses back. Nothing is decoration. Nothing is a dead label.

**2. Zero Click Anxiety.** Every interaction is reversible in place. Click opens, click closes. No navigation. No page transitions. No context loss. The system rewards curiosity instead of punishing it.

**3. See First, Know Later.** The entry point is always the work — the image, the vehicle, the data. You look at it. Then the data layers in as you want it.

---

## QUICK-REFERENCE DESIGN TOKENS

The 10 most used tokens. Complete reference in [TOKENS.md](./TOKENS.md).

```
--bg:             #f5f5f5 / #1e1e1e     Page background
--surface:        #ebebeb / #252526     Card/component background
--border:         #bdbdbd / #3e3e42     Default borders
--text:           #2a2a2a / #cccccc     Primary text
--text-secondary: #666666 / #858585     Secondary text
--font-family:    Arial, sans-serif     All human text
--font-mono:      'Courier New', mono   All machine data
--fs-8:           8px                   ALL CAPS labels
--fs-10:          10px                  Standard body text
--space-1:        4px                   Base spacing unit
```

---

## HOW TO USE THIS ENCYCLOPEDIA

| Task | Read These |
|------|-----------|
| Building a new component | [01-foundations](./01-foundations.md), [02-components](./02-components.md), [TOKENS](./TOKENS.md) |
| Building a new screen | [04-screens](./04-screens.md), [07-finder-model](./07-finder-model.md), [02-site-architecture](./02-site-architecture.md) |
| Fixing a design violation | [VIOLATIONS](./VIOLATIONS.md) first, then the relevant chapter |
| Adding a third-party library | [06-third-party](./06-third-party.md) |
| Working on dark mode | [08-dark-mode](./08-dark-mode.md), [TOKENS](./TOKENS.md) |
| Understanding interaction patterns | [03-interactions](./03-interactions.md) |
| Understanding the header | [05-the-header](./05-the-header.md) |
| Understanding image-analysis depth / tiers | [18-deep-image-analysis](./18-deep-image-analysis.md) |

---

## TABLE OF CONTENTS

### [01 — Foundations](./01-foundations.md)
The philosophy behind every visual decision. Why Arial. Why Courier New. Why 8-11px. Why zero border-radius. Why zero shadow. Why 4px spacing. Why greyscale. Why racing accents as Easter eggs. The Bloomberg Terminal inheritance. The Win95 lineage. The transition speed. The enforcement philosophy. Each rule cross-referenced to its CSS token, ESLint rule, and violation entry.

### [02 — Components](./02-components.md)
Every reusable component specified. BadgePortal (the atomic unit), BadgeClusterPanel, useBadgeDepth, CardShell, CardImage, CardDealScore, CardSource, FeedStatsStrip, FeedEmptyState, ResilientImage, DetailPanel. Props, behavior, composition patterns, CSS tokens used, common violations. Component-to-file mapping table.

### [02 — Site Architecture](./02-site-architecture.md)
Every page in the application. The three entity types (Vehicle, User, Organization). Page hierarchy (Tier 1-5). The Vehicle Profile in detail (8,000+ lines, 14 components). Shared component taxonomy. Derivative page mapping. Component count summary.

### [03 — Interactions](./03-interactions.md)
How every interactive element behaves. Badge click model. Feed card click model. Empty state actions. Keyboard navigation. Hover states with exact timing values. Animation specifications for every transition (badge open, card expand, route change, data loading, dropdown, command input focus, toast, table row hover, tab switch, form field focus). The "No Surprise" rule. What never happens.

### [04 — Screens](./04-screens.md)
**Every screen, every state.** Home/Hub, Vehicle Profile, Feed/Discovery, Search, Browse, Auction Marketplace, Profile, Organization Profile, Add Vehicle, and all remaining pages. For each: route, file, layout spec, loaded/empty/loading/error states, component inventory. Universal screen rules. Route-to-screen mapping table.

### [05 — The Header](./05-the-header.md)
The persistent navigation bar. Three zones: identity (NUKE wordmark), command input, session (user capsule). Exact CSS token reference for every element. Responsive behavior. Dark mode behavior. Context notation. Command input behavior (text, URL, VIN, YMM, natural language, dragged image). Sub-context pattern (breadcrumbs, vehicle tabs). Anti-patterns.

### [06 — Third-Party Components](./06-third-party.md)
Override patterns for every third-party library. Recharts (chart colors, tooltip, legend). Headless UI (unstyled but watch for agent-added violations). Radix UI. Leaflet/MapLibre (allowlisted canvas, override controls). Three.js/Deck.gl (canvas, allowlisted). React Hot Toast (token overrides). Lucide React (icon rules). React Router, TanStack Query, React Markdown, Vite. Global override strategy. New library checklist.

### [07 — Finder Model](./07-finder-model.md)
The product architecture and its design implications. Every element earns its presence. Hierarchy through density, not decoration. The interface feels inevitable. The badge is the fundamental unit. Anti-vanity metrics. The multi-surface model (web, MCP, CLI, extension, embeds). Screen architecture principles.

### [08 — Dark Mode](./08-dark-mode.md)
Complete dark mode token mapping (every token, light and dark values, delta). How dark mode is applied (`[data-theme="dark"]` attribute). The four dark mode rules. High contrast modes (light and dark). Greyscale mode. Third-party dark mode handling. Testing checklist.

### [09 — Click-Through Chains](./09-click-through-chains.md)
How clicks propagate through nested components. The click-through chain model. Badge → panel → detail → source. Every click target, every depth level, every transition.

### [11 — Intelligence Surface](./11-intelligence-surface.md)
How computed intelligence (scores, estimates, comparisons) renders on the vehicle profile. The seven-level analysis. Signal aggregation. Confidence visualization.

### [12 — Document Generation](./12-documents.md)
The Layer 0 mechanical skeleton for generated documents. Page tokens (A4, US Letter), slide tokens, bleed/trim/safe zones, type scales, color safety. The parallel `--doc-*` token namespace. Print vs. screen color spaces.

### [13 — Multi-Brand Composition](./13-multi-brand-composition.md)
How multiple brands coexist in a single document. The three-layer stack (Nuke / Agency / Brands). Deck manifest. Logo hierarchy and sizing. Color dominance and the one-accent rule. Slide ownership. Typography rules. Voice mixing profiles. Image treatment. The agency is the editor, the brands are the subjects.

### [14 — The Deck System](./14-deck-system.md)
**The most important chapter.** How Nuke generates outward-facing documents that secure partnerships and funding. The deck as a view into the database. The five-stage pipeline (Query → Validate → Compose → Render → Review). The evidence hierarchy. Logo display rules as code. The seven rules for deck generation. The build report and provenance chain. The collaboration model between human and agent. Anti-patterns. The closing principle: the database IS the pitch.

### [18 — Deep Image Analysis](./18-deep-image-analysis.md)
**The adjudication record for image depth.** How deep-analyzed a photo is, made canonical: one deep-analysis marker (T1 verdict + image_observations row), the Tier 0→4 ladder (GATED → SEEN → PLACED → CONNECTED → CONFIRMED), the demotion of the listing four-tier (`decode/observe/deliberate/sign`) to listing-field justification, the orthogonal value/density axes, one `analysis_depth_score`, the butterfly cascade arms, and the two-flows-one-engine architecture with the inflow-priority rule. Each decision cited to the live file that enforces it.

### [Vehicle Profile — Computation Surface](./vehicle-profile-computation-surface.md)
The vehicle profile as the middle of the data pipeline. Timeline as the atomic unit. Day cards. Seven-level analysis. Progressive density. The bill as a generated view. The anti-pattern of parallel tracking systems.

### [TOKENS.md](./TOKENS.md)
**Every CSS variable in the design system.** Font scale, font sizes, typography, backgrounds, text, borders, accents, status colors, spacing, layout, chart palette, heatmap, racing accent colorways (22 colorways), contrast profiles, semantic aliases, grey scale aliases, button system, card system, input system, animation, z-index scale.

### [VIOLATIONS.md](./VIOLATIONS.md)
**The anti-pattern lookup table.** 20 violation patterns (V-01 through V-20). For each: temptation, symptom, impact, detection method, fix. ESLint rule reference table. Changelog.

---

## DESIGN VOCABULARY GLOSSARY

**Badge Portal:** The fundamental UI primitive. A rectangle showing a data point (label + value) that, when clicked, opens a depth-appropriate panel showing more context. Not a label. Not a chip. A portal.

**Badge Depth:** The depth level of a badge portal indicating how much data backs the displayed value. Hover shows count; click shows preview grid.

**Signal:** A piece of information about a vehicle derived from a source (listing, document, event, sensor). Signals are the raw inputs to provenance calculations.

**Provenance:** The documented history of a vehicle's ownership, condition, modifications, and events. The core product.

**Feed Card:** The card unit in list/feed views. Shows a vehicle summary with its top signals visible as badges.

**Finder Model:** The product mental model: the primary interaction is finding and exploring data. Everything is a search result.

**Surface:** In design token context, the background color for elevated components (cards, panels). `var(--surface)` is `#ebebeb` (light) / `#252526` (dark).

**Session Zone:** The header area showing user session state: avatar, notification dot.

**Command Input:** The search/command bar in the header. The primary navigation affordance. Accepts text, URLs, VINs, YMM, natural language, dragged images.

**4px Grid:** The spacing system. All margins, padding, and layout measurements are multiples of 4px.

**ALL CAPS Labels:** The label style for column headers, category labels, classification text. 8-9px, Arial, letter-spacing 0.08em, `var(--text-secondary)` color, `text-transform: uppercase`.

**Dead End Empty State:** An anti-pattern. An empty state showing "no data" with no action offered. Explicitly forbidden.

**Zero Click Anxiety:** Design Law 2. Every interaction is reversible in place. Click opens, click closes. The system rewards curiosity.

**See First, Know Later:** Design Law 3. Show the data first. Explain it on demand.

**Every Data Point is a Live Badge:** Design Law 1. Every piece of data is displayable as a badge portal wired to its source and depth.

**Deck Manifest:** The JSON contract that defines a deck: thesis, audience, entity list, brand roles, palette mode, editorial voice, slide definitions with data bindings. The manifest is the single input to the deck generation pipeline.

**Deck Readiness Report:** A per-entity completeness audit produced during validation. Lists blocking errors (missing logos, missing GPS) and warnings (missing brand colors, suboptimal formats). The deck does not render until all blocking items are resolved.

**Build Report:** The provenance chain produced alongside every rendered deck. Records every data binding, its source, confidence tier, and retrieval date. A deck with zero hardcoded values is a deck that can be re-rendered indefinitely.

**Evidence Hierarchy:** The five-tier confidence scale for claims in outward-facing documents. Tier 1 (photo proof) through Tier 4 (qualified assertion) render with appropriate visual treatment. Tier 5 (unverifiable claims) is structurally impossible in a properly built template.

**Deck-as-View:** The foundational principle of Chapter 14. A deck is not a document created in isolation -- it is a rendering of the database at a point in time, re-renderable whenever the underlying data changes.

---

## SUPERSESSION NOTICE

This Design Book supersedes `docs/DESIGN_BIBLE.md` as the canonical design reference. The Design Bible remains for philosophical context and the three laws, but for implementation specifications, this encyclopedia is the single source of truth.

---

## CHANGELOG

| Date | Change |
|------|--------|
| 2026-06-18 | Chapter 18 (Deep Image Analysis) written — the §4 adjudication record for the IMAGE_ANALYSIS_100X mandate (one marker, one Tier 0–4 ladder, one depth score, two-flows-one-engine; demotes the listing four-tier to listing-field justification). README TOC + "where do I go" table updated. |
| 2026-04-05 | Chapter 14 (The Deck System) written. README TOC updated to include chapters 09, 11, 12, 13, 14, and the Computation Surface chapter. Glossary extended with deck system terms. |
| 2026-03-24 | Design Interface Encyclopedia created. TOKENS.md, VIOLATIONS.md, 04-screens.md, 06-third-party.md, 07-finder-model.md, 08-dark-mode.md written. All existing chapters (01, 02, 02-arch, 03, 05) updated with cross-references, CSS token references, and expanded specifications. README replaced with comprehensive index. |
| 2025-10-21 | Original design-book chapters created (01-foundations, 02-components, 03-interactions, 05-the-header). |

---

*The database IS the vehicle. The interface IS the graph. Design is end to end.*

---

## Scholarly Foundations

The design laws and component doctrines in this book are not invented from scratch — they are bindings of established results in information visualization, usability engineering, and scene representation; the works below ground each core claim and are all web-verified against primary sources.

- **Maximize information density / data-ink** → The "every element must earn its presence," 8-11px text, 4px grid, and zero-decoration mandate of [01-foundations.md](./01-foundations.md) and [07-finder-model.md](./07-finder-model.md) ("hierarchy through data density, not visual decoration") is Tufte's data-ink-ratio principle — "above all else show the data" — applied to a UI; the Bloomberg-terminal inheritance is the same idea by another name. [tufte1983visual]
- **Progressive density / details-on-demand** → Design Law 3 "See First, Know Later" and the [11-intelligence-surface.md](./11-intelligence-surface.md) "progressive density" principle (sparse vehicle → sparse briefing; dense one → expandable evidence layers; BadgePortal value at idle → count on hover → full context on click) is Shneiderman's Visual Information-Seeking Mantra: "overview first, zoom and filter, then details-on-demand." [shneiderman1996eyes]
- **Faceted navigation / browse** → `frontend-doctrine.md` §2b "Faceted Browse (Flamenco pattern)" — every high-cardinality attribute auto-becomes a facet with live counts, no query language exposed, the system never returns an empty result set — is Hearst's Flamenco work on faceted metadata for information exploration. [hearst2006clustering][hearst2002flexible]
- **Information scent / foraging** → `frontend-doctrine.md` §2c "Observation Feed" — observation cards carry source glyph, observer trust, timestamp, and confidence chip as the "scent" a user follows to decide whether to dig into a patch — operationalizes Pirolli & Card's Information Foraging theory. [pirolli1999foraging]
- **The Briefing Model** → "The profile IS the briefing" ([11-intelligence-surface.md](./11-intelligence-surface.md)), "the interface should feel inevitable — pre-fetch, pre-calculate, pre-render" ([07-finder-model.md](./07-finder-model.md)), and `frontend-doctrine.md` §5 "UI as call-to-action, not browser" rest on user-centered design — the system, not the user, bears the cognitive load (Norman) — with details-on-demand as the auditable expansion of a summary (Shneiderman). [norman1988design][shneiderman1996eyes]
- **Usability heuristics / Zero Click Anxiety** → Design Law 2 "Zero Click Anxiety" (reversible-in-place, nothing navigates away without explicit action, the "No Surprise" rule of [03-interactions.md](./03-interactions.md)) operationalizes Nielsen & Molich's usability heuristics — user control and freedom (reversibility), consistency, and visibility of system status. [nielsen1990heuristic]
- **Affordance honesty / material honesty** → [01-foundations.md](./01-foundations.md) "Why Zero Shadow" ("shadows are a lie about light"), "Why Zero Border-Radius," and the Win95 lineage ("a button looked like a button… every interactive element announced itself through visual affordance") is Norman's affordance/signifier theory: an element's appearance must truthfully signal what it does. [norman1988design]
- **Spatial-temporal viewing of an entity** → `frontend-doctrine.md` §2d "Spatial-Temporal Viewer (Volumetric Lens)" — a vehicle scene queryable at any viewpoint, observations pinned at (x,y,z), a time scrubber for drift — descends from NeRF and 3D Gaussian Splatting for scene representation, with diachronic word embeddings as the model for temporal semantic drift. [mildenhall2020nerf][kerbl2023gaussian][hamilton2016diachronic]

### Bibliography

1. **[tufte1983visual]** Edward R. Tufte (1983). *The Visual Display of Quantitative Information*. Graphics Press, Cheshire, CT. https://www.edwardtufte.com/book/the-visual-display-of-quantitative-information/
2. **[shneiderman1996eyes]** Ben Shneiderman (1996). *The Eyes Have It: A Task by Data Type Taxonomy for Information Visualizations*. Proceedings of the IEEE Symposium on Visual Languages, Boulder, CO, pp. 336-343. https://doi.org/10.1109/VL.1996.545307
3. **[hearst2006clustering]** Marti A. Hearst (2006). *Clustering Versus Faceted Categories for Information Exploration*. Communications of the ACM, 49(4), pp. 59-61. https://doi.org/10.1145/1121949.1121983
4. **[hearst2002flexible]** Marti A. Hearst, Jennifer English, Rashmi Sinha, Kirsten Swearingen, Ka-Ping Yee (2002). *Finding the Flow in Web Site Search*. Communications of the ACM, 45(9), September 2002, pp. 42-49. https://doi.org/10.1145/567498.567525
5. **[pirolli1999foraging]** Peter Pirolli, Stuart K. Card (1999). *Information Foraging*. Psychological Review, 106(4), pp. 643-675. https://doi.org/10.1037/0033-295X.106.4.643
6. **[nielsen1990heuristic]** Jakob Nielsen, Rolf Molich (1990). *Heuristic Evaluation of User Interfaces*. Proceedings of the SIGCHI Conference on Human Factors in Computing Systems (CHI '90), Seattle, pp. 249-256. https://doi.org/10.1145/97243.97281
7. **[norman1988design]** Donald A. Norman (1988). *The Design of Everyday Things* (originally *The Psychology of Everyday Things*). Basic Books, New York (revised/expanded edition 2013). https://www.basicbooks.com/titles/don-norman/the-design-of-everyday-things/9780465050659/
8. **[mildenhall2020nerf]** Ben Mildenhall, Pratul P. Srinivasan, Matthew Tancik, Jonathan T. Barron, Ravi Ramamoorthi, Ren Ng (2020). *NeRF: Representing Scenes as Neural Radiance Fields for View Synthesis*. European Conference on Computer Vision (ECCV 2020), pp. 405-421. https://arxiv.org/abs/2003.08934
9. **[kerbl2023gaussian]** Bernhard Kerbl, Georgios Kopanas, Thomas Leimkuehler, George Drettakis (2023). *3D Gaussian Splatting for Real-Time Radiance Field Rendering*. ACM Transactions on Graphics (SIGGRAPH), 42(4). https://doi.org/10.1145/3592433
10. **[hamilton2016diachronic]** William L. Hamilton, Jure Leskovec, Dan Jurafsky (2016). *Diachronic Word Embeddings Reveal Statistical Laws of Semantic Change*. Proceedings of the 54th Annual Meeting of the Association for Computational Linguistics (ACL 2016), Volume 1: Long Papers, Berlin, pp. 1489-1501. https://aclanthology.org/P16-1141/

*Verification note: all 10 citations above confirmed real against primary sources (publisher pages, ACM DL, IEEE, ACL Anthology, arXiv, Psychological Review). No citations were excluded — every key supplied for this section verified as is_real=true. Note that [hearst2002flexible] was corrected from a garbled proposal: it is the canonical CACM 45(9) 2002 paper "Finding the Flow in Web Site Search" (DOI 10.1145/567498.567525), NOT a SIGIR 2002 demo, and "Ame Elliott" is NOT an author — do not re-add her or the flamenco02.pdf manuscript URL.*

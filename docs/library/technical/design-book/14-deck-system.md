# DESIGN BOOK -- Chapter 14: The Deck System

A deck is a view into the database. Not a creative artifact. Not a document produced in isolation. A view -- the same way a vehicle profile is a view (Chapter: Computation Surface), the same way an invoice is a view (Chapter 12), the same way an auction readiness score is a view. The deck queries the database, assembles the results into a visual document, and presents them to a human who will make a decision based on what they see.

A deck with accurate data gets funded. A bullshit deck dies unread in the inbox.

**Cross-references:**
- Document generation tokens: [12-documents.md](./12-documents.md) (Layer 0)
- Multi-brand composition: [13-multi-brand-composition.md](./13-multi-brand-composition.md) (Layer 1 + 2)
- Computation surface model: [vehicle-profile-computation-surface.md](./vehicle-profile-computation-surface.md)
- Token values: [TOKENS.md](./TOKENS.md)

---

## The Central Principle

**If the data is right, the deck is right. If the deck is wrong, the data is wrong.**

This is not a slogan. It is a structural constraint. Every element that appears in a rendered deck -- every logo, every statistic, every map pin, every brand name, every quote, every price -- originates from a database query. When an element is incorrect, the error is not in the deck. The error is upstream: in the `organizations` table, in `org_assets`, in `brand_design_language`, in the observation record that supplied the number.

The deck is a downstream consumer. It does not contain facts. It displays them.

This distinction changes what it means to "fix a deck." You do not fix a deck by opening the HTML and editing a number. You fix a deck by correcting the database row that produced the wrong number, then re-rendering. If you edit the HTML directly, you have created a fork -- a document that will diverge from the database on the next render. Direct HTML edits are patches. Patches accumulate. Accumulated patches produce a document that cannot be regenerated, which means it cannot be maintained, which means it cannot be trusted.

---

## Errors Are Symptoms

Every error in a rendered deck points to a specific gap upstream. The deck does not create problems. It reveals them.

| What You See | What It Means | Where to Fix |
|---|---|---|
| Wrong logo variant on dark slide | Logo display rules not codified or not followed | `org_assets` (add the missing variant) or template logic (fix the contrast check) |
| Brand mentioned without its logo | Asset enrichment pipeline didn't supply the logo | `org_assets` -- the researcher didn't do their job |
| Wrong GPS coordinates on the map | Organization record wasn't enriched | `organizations.latitude`, `organizations.longitude` |
| A statistic without a source | Number exists somewhere but wasn't collected or wasn't queried | Source tables, observation pipeline |
| A claim presented as fact | No provenance chain for the assertion | Should not have rendered -- validation gap |
| Hardcoded number in the template | Someone typed a value instead of querying it | Template code -- replace with a DB query |
| Text where an image should be | The asset doesn't exist yet | `org_assets` or the media pipeline |

Hardcoded numbers are tech debt. Every number that appears in a template as a literal value instead of a database reference is a number that will be wrong eventually. It might be right today. It will be wrong next quarter. The template author has hidden a time bomb.

---

## The Deck Generation Pipeline

Five stages. Each produces an artifact that the next stage consumes. No stage can be skipped.

```
QUERY ──> VALIDATE ──> COMPOSE ──> RENDER ──> REVIEW
  │          │            │          │          │
  │          │            │          │          └── Human reviews output
  │          │            │          └── Templates + validated data = HTML
  │          │            └── Chapter 13 rules applied (hierarchy, voice, palette)
  │          └── Completeness checks per entity (gaps flagged, readiness scored)
  └── Pull org profiles, observations, assets from DB
```

### Stage 1: Query

The deck manifest (Chapter 13) names the entities involved. Stage 1 resolves those entities against the database.

```sql
-- Pull every organization mentioned in the deck manifest
SELECT
  o.id,
  o.name,
  o.display_name,
  o.business_type,
  o.city,
  o.state_province,
  o.country,
  o.latitude,
  o.longitude,
  o.website_url,
  o.description
FROM organizations o
WHERE o.slug = ANY(:manifest_brand_slugs);
```

```sql
-- Pull logo assets for each organization
SELECT
  oa.organization_id,
  oa.asset_type,
  oa.url,
  oa.variant,        -- 'light', 'dark', 'monochrome'
  oa.format,         -- 'svg', 'png', 'jpg', 'webp'
  oa.min_height_px,
  oa.max_height_px,
  oa.notes
FROM org_assets oa
WHERE oa.organization_id = ANY(:manifest_org_ids)
  AND oa.asset_type = 'logo';
```

```sql
-- Pull brand design language (colors, fonts, usage rules)
SELECT
  bdl.organization_id,
  bdl.primary_color,
  bdl.secondary_color,
  bdl.accent_color,
  bdl.font_family,
  bdl.usage_notes
FROM brand_design_language bdl
WHERE bdl.organization_id = ANY(:manifest_org_ids);
```

The query stage does not filter or interpret. It retrieves everything the database knows about the named entities. Filtering is the next stage's job.

### Stage 2: Validate

For each entity named in the manifest, check completeness against a requirements matrix. The matrix defines what data a deck entity MUST have versus what is optional.

```json
{
  "entity_requirements": {
    "logo": {
      "required": true,
      "variants_needed": ["dark_bg", "light_bg"],
      "fallback": "text_only",
      "severity_if_missing": "blocking"
    },
    "gps": {
      "required_if": "entity appears on map",
      "fallback": null,
      "severity_if_missing": "blocking"
    },
    "brand_colors": {
      "required": true,
      "fallback": "neutral_palette",
      "severity_if_missing": "warning"
    },
    "description": {
      "required": false,
      "severity_if_missing": "info"
    }
  }
}
```

Validation produces two artifacts:

**1. The Deck Readiness Report** -- a per-entity breakdown of what exists and what is missing.

```
DECK READINESS REPORT
=====================

Ford (ford-bronco)
  [OK] Logo: dark_bg variant (PNG, filter-invertible)
  [OK] Logo: light_bg variant (PNG, native blue oval)
  [OK] Brand colors: #003478 primary, #fff secondary
  [WARN] GPS: not applicable (not map-plotted)
  [OK] Description: 2 paragraphs in DB
  READINESS: 100%

Fouquet's (fouquets-stbarth)
  [OK] Logo: dark_bg variant (SVG white)
  [OK] Logo: light_bg variant (SVG black)
  [OK] Brand colors: defined in brand_design_language
  [OK] GPS: 17.8966, -62.8496
  [OK] Description: exists
  READINESS: 100%

Eden Rock (eden-rock-stbarth)
  [FAIL] Logo: no static logo asset. JS-rendered site only.
  [OK] GPS: exists
  [WARN] Brand colors: not defined -- will use neutral palette
  [OK] Description: exists
  READINESS: 40% -- BLOCKING: no logo

DECISION REQUIRED: Eden Rock has no logo asset.
  Option A: Source the logo manually, add to org_assets, re-validate.
  Option B: Exclude Eden Rock from the deck.
  Option C: Render as text "EDEN ROCK" (fallback -- acceptable for tertiary brands only).
```

**2. The Readiness Score** -- a single number (0-100) per entity, following the same scoring philosophy as Auction Readiness (six dimensions, weighted, gaps identified). The deck does not render until all `blocking` items are resolved.

### Stage 3: Compose

Apply the composition rules from Chapter 13. The manifest declares which brand is primary, secondary, tertiary. The composition engine resolves:

- **Palette mode:** dark or light, which determines Layer 0 tokens
- **Accent privilege:** which brand's color appears on which slides
- **Logo sizing:** role multiplier * weight * base height
- **Typography:** document typeface from agency or Layer 0 default
- **Voice profile:** `luxury-editorial`, `technical-authority`, `heritage-narrative`, or `direct-commercial`
- **Slide ownership map:** which slides belong to which category (neutral, brand-owned, agency-branded)

Composition is deterministic. Given the same manifest and the same validated data, composition produces the same output every time. There are no random elements, no AI-generated layout decisions, no "let's try this arrangement." The rules are the rules.

### Stage 4: Render

Templates consume composed data and produce HTML. The templates are mechanical -- they make no editorial decisions.

A template is a function:

```
f(validated_data, composition_rules) → HTML
```

Not:

```
f(creative_brief, brand guidelines, designer intuition) → HTML
```

The template knows:
- Where to place the logo (position, size, contrast variant -- all from composition rules)
- Where to place numbers (from DB queries, never from template literals)
- Where to place images (from `org_assets`, never from random URLs)
- Which color tokens to use (from the composed palette, never from hardcoded hex values)

The template does not know:
- Whether the thesis is compelling (that is the human's job)
- Whether the brand mix makes strategic sense (that is the agency's job)
- Whether a number is impressive or embarrassing (that is editorial judgment, not rendering logic)

#### Template Data Binding

Every dynamic element in a template binds to a specific data path. No string interpolation from untracked sources.

```html
<!-- WRONG: hardcoded statistic -->
<span class="stat">300,000 annual visitors</span>

<!-- RIGHT: bound to a data path with provenance -->
<span class="stat"
  data-source="collectivite_sbh_tourism_2024"
  data-confidence="external_citation"
  data-retrieved="2026-03-15">
  {{ entity.stats.annual_visitors | number }}
</span>
```

Every `{{ }}` binding traces to a column in the database. The `data-source` attribute records where the number came from. The `data-confidence` attribute records the evidence tier (see Evidence Hierarchy below). The `data-retrieved` attribute records when it was last refreshed.

This is not over-engineering. This is the difference between a deck that can be audited and a deck that cannot. When someone in the room asks "where does that 300,000 number come from?" the answer exists in the markup, not in someone's memory.

### Stage 5: Review

The human reviews the rendered deck. Every change they request maps to exactly one of three targets:

| Change Type | Target | Example |
|---|---|---|
| Data correction | The database | "That GPS coordinate is wrong" -- fix `organizations.latitude` |
| Rule adjustment | The composition rules | "Ford's logo should be bigger" -- adjust `weight` in manifest |
| Creative direction | The thesis / editorial layer | "The argument needs a stronger opening" -- rewrite the narrative |

Never the HTML. The human never edits the HTML. If they want to move a logo, the composition rules change. If they want a different number, the database changes. If they want a different story, the thesis changes. Then the deck re-renders.

This is the same principle as the vehicle profile's computation surface: the profile does not own data, it reads from the graph and computes on it. The deck does not own data, it reads from the graph and renders from it.

```
WRONG:
  human opens deck.html → edits a number → saves → sends

RIGHT:
  human reviews deck.html
    → "this number is wrong"
    → agent updates organizations table
    → deck re-renders
    → human reviews again
```

---

## The Collaboration Model

The deck is produced by a human and an agent working together. Their responsibilities do not overlap.

### The Human Provides

- **The thesis.** What are we arguing? What is the strategic insight? "Ford should think about SBH the same way Hermes does" is a thesis. "Here are some nice Bronco photos" is not.
- **The audience.** Who receives this? A CMO at Ford? A hotel general manager? A media company's ad sales team? The audience determines voice, depth, and what gets foregrounded.
- **The entity list.** Which organizations, people, and brands are involved? The human knows the relationships. The system knows the data about those relationships.
- **Creative direction.** What should it feel like? `luxury-editorial` or `direct-commercial`? Dark slides or light? What is the emotional register?
- **Domain knowledge.** Things the database does not yet contain. "FBM already sells Ranger Raptors on-island." "Stacey Bendet was on-island 14 weeks ago." "Fouquet's just opened Lou Lou Beach Club." The human provides intelligence; the agent ingests it into the database where it becomes queryable.

### The Agent Provides

- **Data completeness checks.** Before rendering: does every mentioned entity have its logo, GPS, brand colors, description? What is missing? The readiness report is the agent's first output, not the deck itself.
- **Asset collection.** When the readiness report flags a missing logo, the agent attempts to source it: scrape the org's website, check known CDN paths, apply image processing for variant generation. If sourcing fails, flag it for the human.
- **Composition rule application.** Chapter 13 rules applied mechanically. Logo sizing, accent privilege, slide ownership, typography -- all deterministic from the manifest.
- **Template rendering.** Pull from DB, apply rules, output HTML. Mechanical.
- **Factual verification.** For every number in the rendered deck: is it from the database with a source, or is it hardcoded? Hardcoded numbers get flagged in the build report.

### What Makes the Collaboration Efficient

The back-and-forth becomes fast when each party stops doing the other's work:

- The human never says "where are the logos?" -- the system never renders without them.
- The human never says "that coordinate is wrong" -- coordinates come from the database, verified at validation time.
- The human never says "that number looks made up" -- every number has a `data-source` attribute.
- The human CAN say "the thesis needs to be stronger" -- that is creative direction, their domain.
- The human CAN say "add the Bendet connection" -- that is domain knowledge, their domain.
- The agent never decides what to argue -- that is editorial judgment, the human's domain.
- The agent never invents a statistic -- that is fabrication, which the system prevents structurally.

---

## The Evidence Hierarchy

Not all claims are equal. The deck must signal the strength of every assertion. This is the same epistemological framework that governs vehicle data (see: epistemology of truth), applied to outward-facing documents.

| Tier | Name | Description | Rendering Treatment |
|---|---|---|---|
| 1 | **Photographic proof** | A photograph of the thing being claimed. A Bronco at FBM. The Hermes store in Gustavia. | Image displayed inline. No qualifier needed. |
| 2 | **Database with provenance** | A number from the DB with a source chain. Auction results, observation counts, GPS coordinates. | Number displayed as `{{ value }}`. Source available on hover or in footnote. |
| 3 | **External citation** | A number from a third-party source with a URL and date. Tourism board statistics. Press quotes. | Number displayed with citation mark. Source in footnotes. |
| 4 | **Qualified assertion** | An estimate or analysis with stated assumptions. "We estimate..." or "Based on comparable markets..." | Displayed with qualifier language. Italicized or visually distinguished. |
| 5 | **Unverifiable claim** | An assertion without proof, source, or methodology. | **Does not render.** Rejected at validation. |

The system enforces this hierarchy at the template level. Every dynamic element has a `data-confidence` attribute matching one of these tiers. Tier 5 content -- unverifiable claims -- is structurally impossible in a properly built template because there is no data path that produces it. If a number is not in the database and not in a cited source, the template has nothing to bind to, and the element renders empty, which triggers a validation error.

This is how the system makes errors structurally impossible rather than merely unlikely.

---

## The Deck Manifest (Extended)

Chapter 13 defines the manifest structure for multi-brand composition. The deck system extends it with deck-specific fields.

```json
{
  "deck_id": "luxe-fleet-ford-pitch-v3",
  "version": 3,
  "created_at": "2026-04-05T00:00:00Z",

  "agency": "lagence-stbarth",
  "presenter": "nuke",
  "audience": "ford-motor-company-cmo",

  "thesis": "Ford should treat SBH the way Hermes treats Gustavia -- not as a sales channel measured in units, but as a validation surface measured in impressions on the right people.",

  "brands": [
    { "slug": "ford-bronco", "role": "primary", "weight": 1.5 },
    { "slug": "fouquets-stbarth", "role": "secondary", "weight": 1.0 },
    { "slug": "lofficiel-stbarth", "role": "secondary", "weight": 1.0 },
    { "slug": "fbm-automobiles", "role": "tertiary", "weight": 0.8 }
  ],

  "entities_on_map": [
    "fouquets-stbarth",
    "fbm-automobiles",
    "eden-rock-stbarth",
    "nikki-beach",
    "rosewood-le-guanahani",
    "le-barthelemy",
    "le-toiny",
    "manapany",
    "cheval-blanc"
  ],

  "palette_mode": "dark",
  "editorial_voice": "luxury-editorial",
  "language": "en",

  "slides": [
    {
      "id": "title",
      "type": "title",
      "ownership": "agency-branded",
      "data_bindings": {}
    },
    {
      "id": "map-sbh",
      "type": "interactive-map",
      "ownership": "neutral",
      "data_bindings": {
        "locations": "SELECT slug, display_name, latitude, longitude FROM organizations WHERE slug = ANY(:entities_on_map)",
        "competitor_brands": "SELECT DISTINCT make FROM vehicles WHERE ... -- rental fleet"
      }
    },
    {
      "id": "ford-hero",
      "type": "brand-owned",
      "ownership": "ford-bronco",
      "data_bindings": {
        "hero_image": "SELECT url FROM org_assets WHERE organization_id = :ford_id AND asset_type = 'hero_image' ORDER BY created_at DESC LIMIT 1",
        "tagline": "SELECT content_text FROM vehicle_observations WHERE kind = 'specification' AND source_slug = 'ford-editorial' LIMIT 1"
      }
    },
    {
      "id": "market-data",
      "type": "data",
      "ownership": "neutral",
      "data_bindings": {
        "annual_visitors": "SELECT value FROM island_stats WHERE metric = 'annual_visitors' AND year = 2024",
        "american_pct": "SELECT value FROM island_stats WHERE metric = 'visitor_origin_us_pct' AND year = 2024",
        "hotel_count": "SELECT COUNT(*) FROM organizations WHERE business_type = 'hotel' AND city IN (SELECT DISTINCT city FROM organizations WHERE latitude BETWEEN 17.85 AND 17.95)",
        "villa_count": "SELECT COUNT(*) FROM organizations WHERE business_type IN ('villa', 'villa_rental') AND latitude BETWEEN 17.85 AND 17.95"
      }
    }
  ]
}
```

The manifest is the contract between the human (who defines the thesis, audience, and entity list) and the system (which validates, composes, and renders). It is checked into version control. It is diffable. When the human says "add Eden Rock to the map," the change is a one-line diff to `entities_on_map`, not a redesign of a slide.

---

## The Map as a View

The interactive map (see `MAP_SPEC.md`) is the purest expression of the deck-as-view principle. The map does not contain data. It renders data.

```sql
-- The map's data source: a single query against the organizations table
SELECT
  o.slug,
  o.display_name,
  o.business_type,
  o.latitude,
  o.longitude,
  oa.url AS logo_url,
  oa.variant AS logo_variant,
  bdl.primary_color
FROM organizations o
LEFT JOIN org_assets oa
  ON oa.organization_id = o.id
  AND oa.asset_type = 'logo'
  AND oa.variant = 'dark_bg'  -- map uses dark tiles
LEFT JOIN brand_design_language bdl
  ON bdl.organization_id = o.id
WHERE o.latitude BETWEEN 17.85 AND 17.95
  AND o.longitude BETWEEN -62.90 AND -62.79
  AND o.slug = ANY(:entities_on_map);
```

When this query returns `latitude: null` for an organization, the map does not guess. It does not geocode. It does not place the pin "approximately near Gustavia." It produces a validation error: `Eden Rock: GPS coordinates missing. Cannot render on map.` The human sees the error in the readiness report and either supplies the GPS or removes the entity from `entities_on_map`.

When the GPS is later added to the `organizations` table (because a researcher looked it up, or the enrichment pipeline ran, or someone visited the location with a phone), the next render automatically places the pin correctly. No one edits the map HTML. The data changed. The view updated.

This is why the MAP_SPEC document insists: "GPS coordinates MUST come from the database, not guesses." A guess is a hardcoded value. A hardcoded value is a fork. A fork becomes stale. A stale coordinate on a map shown to a Ford CMO is a credibility failure. The system prevents this by construction: no data path exists that allows a coordinate to enter the map without first existing in the `organizations` table.

---

## Logo Display Rules as Code

Chapter 13 defines logo hierarchy. The deck system codifies the mechanical rules that determine which logo variant to render in which context. These rules live in code, not in a designer's head.

```typescript
interface LogoVariant {
  url: string;
  variant: 'dark_bg' | 'light_bg' | 'monochrome';
  format: 'svg' | 'png' | 'jpg' | 'webp';
  css_filter?: string;  // e.g., 'brightness(0) invert(1)'
}

interface LogoRenderDecision {
  url: string;
  height_px: number;
  css_filter: string | null;
  fallback_text: string | null;  // only if no logo asset exists
  warning: string | null;        // e.g., "Using filter-inverted PNG -- SVG preferred"
}

function resolveLogoForContext(
  org_assets: LogoVariant[],
  slide_bg: 'dark' | 'light',
  role: 'primary' | 'secondary' | 'tertiary',
  weight: number,
  base_height_px: number
): LogoRenderDecision {

  const role_multiplier = { primary: 1.5, secondary: 1.0, tertiary: 0.7 };
  const height = base_height_px * role_multiplier[role] * weight;

  // Preferred: native variant for the background
  const preferred_variant = slide_bg === 'dark' ? 'dark_bg' : 'light_bg';
  const native = org_assets.find(a => a.variant === preferred_variant);

  if (native) {
    return {
      url: native.url,
      height_px: height,
      css_filter: native.css_filter || null,
      fallback_text: null,
      warning: null
    };
  }

  // Fallback: opposite variant with CSS filter inversion
  const opposite_variant = slide_bg === 'dark' ? 'light_bg' : 'dark_bg';
  const invertible = org_assets.find(a => a.variant === opposite_variant);

  if (invertible) {
    return {
      url: invertible.url,
      height_px: height,
      css_filter: 'brightness(0) invert(1)',
      fallback_text: null,
      warning: `Using filter-inverted ${invertible.variant} variant. Native ${preferred_variant} preferred.`
    };
  }

  // Fallback: monochrome
  const mono = org_assets.find(a => a.variant === 'monochrome');
  if (mono) {
    return {
      url: mono.url,
      height_px: height,
      css_filter: slide_bg === 'dark' ? 'brightness(0) invert(1)' : null,
      fallback_text: null,
      warning: 'Using monochrome variant. Brand-specific variants preferred.'
    };
  }

  // No logo asset exists -- text fallback for tertiary only
  if (role === 'tertiary') {
    return {
      url: '',
      height_px: height,
      css_filter: null,
      fallback_text: org_assets.length === 0
        ? 'NO LOGO ASSET IN DATABASE'
        : null,
      warning: 'No usable logo variant. Rendering as text. Source the logo.'
    };
  }

  // Primary and secondary brands MUST have logos. This is a blocking error.
  throw new DeckValidationError(
    `${role} brand has no logo asset in org_assets. ` +
    `Cannot render deck. Add logo to org_assets and re-validate.`
  );
}
```

The function is deterministic. Given the same assets and context, it produces the same decision every time. A designer does not choose which logo variant to use on slide 7 -- the function chooses, based on data in `org_assets` and rules in the composition layer. If the designer disagrees with the choice, they update `org_assets` (add a better variant) or update the composition rules (change the weight). They do not override the function per-slide.

---

## The Seven Rules

These are the rules that an experienced human follows instinctively when building a pitch deck. They are codified here so that agents follow them without being told.

### Rule 1: Every Brand Mentioned Gets Its Logo

No exceptions. If the text says "Fouquet's," the Fouquet's logo appears on the same slide or an adjacent one. If the logo does not exist in `org_assets`, the brand does not appear in the deck until the researcher supplies it.

The validation stage enforces this: for every string in the rendered text that matches an entity name in the manifest, check that the entity has a renderable logo. If not, the readiness report flags it.

This rule prevents the most common credibility failure in pitch decks: mentioning a partner by name without visual proof of the partnership. Text is a claim. A logo is evidence. The deck shows evidence.

### Rule 2: Every Claim Gets Its Proof

A statistic without a source is a liability. "300,000 annual visitors" -- where does that number come from? If it is in the database with a `source_url` and `retrieved_at`, show it with a footnote citation. If it is an estimate, label it "estimated" with the methodology. If it has no source at all, it does not appear.

The template enforces this through required `data-source` attributes. An element without a source binding is a template error, caught at build time, not at review time.

### Rule 3: Every Logo Has Context Rules

White logo on dark background. Dark logo on light background. Minimum height. Clear space. These rules live in `brand_design_language` and `org_assets` and are applied automatically by `resolveLogoForContext()`. No manual per-slide decisions. No "I think it looked better with the colored version." The rules decide. The rules are in the database. The rules can be updated. But they are followed.

### Rule 4: The Deck Is a View, Not a Document

When the underlying data changes -- a new logo is uploaded, a price is updated, a GPS coordinate is corrected -- the deck is re-rendered. Not manually edited. Re-rendered. The deck is a function of the data. When the input changes, the output changes.

This has a practical consequence: the deck must be re-renderable at any time. Every dependency must be resolved from the database, not from a designer's local files, not from a Slack thread, not from an email attachment. If an asset was used in the deck, it exists in `org_assets` or `vehicle_images` or another queryable table. If it does not exist in a queryable table, it does not exist in the deck.

### Rule 5: Gaps Are Visible, Not Hidden

If an entity is missing data, the build process produces a readiness report. The report is explicit:

```
Eden Rock: missing logo [BLOCKING], missing brand_colors [WARNING]
Cool Rental: missing logo [BLOCKING], missing GPS [BLOCKING]
TopLoc: missing logo [BLOCKING], missing GPS [BLOCKING]
```

The human then decides: fix the data (assign a researcher to source the logos), or exclude the entity from this version of the deck. What the human does NOT do is render the deck with text placeholders where logos should be and hope nobody notices. Gaps are failures of the data pipeline. Making them visible is how the pipeline gets fixed.

### Rule 6: Proof Increases Confidence

When making a point, the strongest possible evidence should lead. The hierarchy:

```
BEST:       Photograph of the thing.
            (A Bronco at FBM. The Hermes boutique in Gustavia.)

GOOD:       Data from the DB with provenance.
            (Auction results, observation counts, GPS-verified locations.)

ACCEPTABLE: External source with citation.
            (Tourism board annual report, press coverage, public filings.)

WEAK:       Qualified assertion.
            ("We estimate," "Based on comparable markets," "Approximately.")

UNACCEPTABLE: Fabricated or unverified claim presented as fact.
              (Never renders. Caught at validation.)
```

The template signals evidence tier visually. Tier 1 content (photos) renders full-bleed with no qualifier. Tier 2 content (DB-sourced numbers) renders in `--font-mono` with a subtle source indicator. Tier 3 content (external citations) renders with a footnote mark. Tier 4 content (estimates) renders in italics with qualifier language baked into the template. Tier 5 content does not exist in the template vocabulary.

### Rule 7: The Art Is in the Query, Not the Rendering

The creative work is deciding WHAT to show and HOW to argue it. Which entities belong in the deck? What is the thesis? What is the narrative arc? Which comparisons are illuminating? These are human decisions -- editorial, strategic, rhetorical.

The rendering is mechanical. Pull from the database. Apply composition rules. Output HTML. If the rendering requires a creative decision -- which photo to feature, which quote to highlight, which number to foreground -- that decision should be stored as metadata in the manifest, not made inline during rendering.

```json
{
  "slide_id": "sbh-lifestyle",
  "hero_image_selection": {
    "query": "SELECT url FROM org_assets WHERE organization_id = :fouquets_id AND asset_type = 'lifestyle' ORDER BY quality_score DESC",
    "override": null,
    "selected_by": "human",
    "selection_reason": "Shell Beach approach shot -- establishes geography"
  }
}
```

When the human chooses a specific photo, the choice is recorded as structured metadata: which query produced the candidates, which one was selected, who selected it, and why. This metadata survives re-renders. The next time the deck regenerates, the system does not randomly pick a different photo -- it respects the human's recorded choice. But the choice is metadata, not an HTML edit. It lives in the manifest, not in the markup.

---

## The Build Report

Every render produces a build report alongside the HTML. The build report is the deck's provenance chain -- a complete record of what was rendered, from where, with what confidence.

```json
{
  "deck_id": "luxe-fleet-ford-pitch-v3",
  "rendered_at": "2026-04-05T14:32:00Z",
  "render_duration_ms": 2340,

  "entity_readiness": {
    "ford-bronco": { "score": 100, "blocking": 0, "warnings": 0 },
    "fouquets-stbarth": { "score": 100, "blocking": 0, "warnings": 0 },
    "lofficiel-stbarth": { "score": 95, "blocking": 0, "warnings": 1 },
    "fbm-automobiles": { "score": 85, "blocking": 0, "warnings": 2 },
    "eden-rock-stbarth": { "score": 40, "blocking": 1, "warnings": 1 }
  },

  "data_bindings": [
    {
      "slide": "market-data",
      "element": "annual_visitors",
      "value": 310000,
      "source": "collectivite_sbh_tourism_annual_report_2024",
      "source_url": "https://www.comstbarth.fr/...",
      "confidence_tier": 3,
      "retrieved_at": "2026-03-15"
    },
    {
      "slide": "map-sbh",
      "element": "fouquets_gps",
      "value": [17.8966, -62.8496],
      "source": "organizations.latitude/longitude",
      "confidence_tier": 2,
      "retrieved_at": "2026-04-01"
    }
  ],

  "warnings": [
    "lofficiel-stbarth: Using filter-inverted dark_bg logo. Native light_bg SVG preferred.",
    "fbm-automobiles: Logo is JPG format. SVG preferred for resolution independence.",
    "fbm-automobiles: Brand colors not defined in brand_design_language. Using neutral palette."
  ],

  "blocking_errors": [
    "eden-rock-stbarth: No logo asset. Excluded from render per manifest fallback rules."
  ],

  "hardcoded_values": [],

  "total_data_bindings": 47,
  "total_from_db": 45,
  "total_from_external_citation": 2,
  "total_hardcoded": 0
}
```

The `hardcoded_values` array should always be empty. When it is not empty, each entry is technical debt that must be resolved before the deck can be considered production-ready. A deck with zero hardcoded values is a deck that can be re-rendered indefinitely as data improves. A deck with hardcoded values is a snapshot that rots.

---

## Lifecycle: From Brief to Boardroom

The full lifecycle of a deck, showing where each system participates:

```
1. HUMAN writes thesis + identifies audience + names entities
     │
2. AGENT creates deck manifest (JSON)
     │
3. AGENT runs Stage 1: Query -- pulls all entity data from DB
     │
4. AGENT runs Stage 2: Validate -- produces readiness report
     │
5. HUMAN reviews readiness report
     │
     ├── Gaps found → HUMAN assigns researcher to fill gaps
     │                   │
     │                RESEARCHER adds logos to org_assets,
     │                GPS to organizations, colors to brand_design_language
     │                   │
     │                AGENT re-runs validation (go to step 4)
     │
     └── No blocking gaps → continue
           │
6. AGENT runs Stage 3: Compose -- applies Chapter 13 rules
     │
7. AGENT runs Stage 4: Render -- produces HTML + build report
     │
8. HUMAN reviews rendered deck
     │
     ├── Data wrong → fix the DATABASE, re-render (go to step 3)
     ├── Rules wrong → fix the MANIFEST, re-render (go to step 6)
     ├── Thesis wrong → rewrite the THESIS, re-render (go to step 6)
     └── Deck correct → ship
```

The loop tightens over time. On the first deck for a new entity set, the readiness report will flag many gaps. On the tenth deck for the same entities, the data is mature and the render is nearly instant. The investment in data quality compounds: every logo sourced, every GPS verified, every brand color defined pays dividends across all future decks that reference that entity.

---

## What the Database Needs to Support Decks

The deck system is a consumer, not a creator. It reads from tables that already exist (or should exist) in the Nuke platform. The critical tables:

| Table | What the Deck Reads From It |
|---|---|
| `organizations` | Entity identity, GPS, business_type, description |
| `org_assets` | Logos, hero images, lifestyle images -- with variant and format metadata |
| `brand_design_language` | Primary/secondary/accent colors, font family, usage notes |
| `vehicle_observations` | Quotes, statistics, claims with provenance |
| `vehicle_images` | Photos used as evidence (Tier 1 proof) |
| `observation_sources` | Source metadata for citation generation |

The deck system does not require new tables. It requires existing tables to be well-populated. If `org_assets` is sparse, decks will be sparse. If `organizations.latitude` is null, maps will be broken. If `brand_design_language` is empty, composition falls back to neutral palette (acceptable but not ideal).

This is the point: the work of building a great deck is not the work of laying out slides. It is the work of populating the database. A well-populated database produces great decks automatically. A sparse database produces readiness reports full of blocking errors.

**Build the database, and the decks build themselves.**

---

## The Anti-Patterns

Patterns that seem efficient but produce decks that cannot be maintained or trusted.

### Anti-Pattern 1: The Bespoke Deck

A designer creates a deck in Keynote or Google Slides. Every slide is hand-crafted. The logos are dragged from a folder on their desktop. The numbers are typed from memory. The deck looks beautiful. Then the GPS coordinates change, a logo gets updated, a statistic is revised, and the deck is wrong. Nobody re-opens it. Nobody updates it. It lives in someone's inbox, permanently wrong.

The bespoke deck is a photograph of the data at a moment in time. The deck-as-view is a live rendering of the data at any moment in time.

### Anti-Pattern 2: The Template Fork

An agent renders a deck from the database. The human reviews it and says "move that logo 10 pixels left." The agent edits the HTML. Now the deck is a fork -- it contains a manual override that exists nowhere in the database or the composition rules. On the next render, the logo goes back to its original position. The human says "I already told you to move it." The agent edits the HTML again. This cycle repeats until both parties are frustrated and the deck is a patchwork of manual overrides that break on every re-render.

The fix: if the logo should be 10 pixels left, update the composition rules or the logo's spacing metadata. The change persists across renders because it lives in the system, not in the output.

### Anti-Pattern 3: The Hardcoded Number

A deck template contains `<span>300,000 visitors</span>`. The number is correct today. In six months, the tourism board publishes new figures. Nobody remembers which decks contain the old number. Nobody knows how many decks reference it. The number stays wrong across every deck that contains it, silently, until someone in a meeting notices.

The fix: `{{ sbh_annual_visitors }}` bound to a database row. Update the row once. Every deck that references it reflects the new number on next render.

### Anti-Pattern 4: The Missing Provenance

A deck claims "65% of SBH visitors are American." The CMO in the room asks: "source?" The presenter says: "I think it was from the tourism board." Nobody is sure. The claim's credibility drops to zero. The entire deck's credibility drops. One unsourced number poisons the well.

The fix: every number carries its provenance in the build report. The presenter can answer: "Collectivite de Saint-Barthelemy, Tourism Annual Report 2024, published March 2025." Confidence maintained.

---

## Closing Principle

The deck system is an extension of the digital twin architecture. The digital twin says: the database IS the vehicle. The deck system says: the database IS the pitch.

A vehicle profile renders the knowledge graph as an interface for someone investigating a vehicle. A deck renders the knowledge graph as an argument for someone making a decision. The data is the same. The queries are different. The presentation is different. But the source of truth is one.

When the data is thin, the profile is sparse and the deck is unconvincing. When the data is deep, the profile is rich and the deck is compelling. There is no shortcut. There is no way to produce a persuasive deck from an empty database, just as there is no way to produce a meaningful vehicle profile from a single observation.

The work is always the data. The deck is just the proof that the work was done.

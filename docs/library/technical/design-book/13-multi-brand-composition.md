# DESIGN BOOK -- Chapter 13: Multi-Brand Composition

How multiple brands coexist within a single document without visual anarchy.

**Cross-references:**
- Token values: [TOKENS.md](./TOKENS.md)
- Foundations: [Chapter 1](./01-foundations.md)
- Dark mode: [Chapter 8](./08-dark-mode.md)

---

## The Three-Layer Stack

Every multi-brand document is governed by three layers. The layers are not suggestions. They are a strict hierarchy where upper layers override lower ones and lower layers cannot reach upward.

```
LAYER 0: NUKE (utility)     -- Grid, spacing, typography scale, export tokens
LAYER 1: AGENCY (authority)  -- Composition rules, hierarchy, voice direction
LAYER 2: BRANDS (identity)   -- Colors, logos, fonts, usage rules per brand
```

**Layer 0** is infrastructure. It provides the grid, the spacing scale, the type ramp, and the export tokens. It has no opinion about which brand is on screen. It is the concrete slab the building sits on.

**Layer 1** is the agency -- the entity commissioning the document. The agency decides hierarchy, sequencing, editorial voice, and how brands relate to each other. This chapter is about Layer 1.

**Layer 2** is where individual brand identities live. Colors, logos, fonts, usage guidelines -- all the assets a brand provides. These assets flourish *within* the constraints set by Layer 1. They never override Layer 1. A brand's guidelines are respected to the maximum extent possible, but when a brand rule conflicts with composition authority, composition authority wins.

This is the central principle: **the agency is the editor, the brands are the subjects.** No brand gets to redesign the document.

---

## Deck Manifest

Every multi-brand document starts with a manifest. The manifest is not metadata tucked away in a config file -- it is the architectural blueprint that determines every visual decision downstream. Nothing renders until the manifest is defined.

```json
{
  "agency": "lagence-stbarth",
  "presenter": "nuke",
  "brands": [
    { "slug": "ford-bronco", "role": "primary", "weight": 1.5 },
    { "slug": "fouquets-stbarth", "role": "secondary", "weight": 1.0 },
    { "slug": "lofficiel-stbarth", "role": "secondary", "weight": 1.0 }
  ],
  "palette_mode": "light",
  "editorial_voice": "luxury-editorial",
  "language": "en"
}
```

### Manifest Fields

| Field | Type | Purpose |
|-------|------|---------|
| `agency` | slug | The composition authority. Their rules govern the document. |
| `presenter` | slug | The platform rendering the document. Usually `nuke`. |
| `brands` | array | Every brand present in the document, with role and weight. |
| `palette_mode` | `light` or `dark` | Base palette direction. Determines Layer 0 token set. |
| `editorial_voice` | string | One of the predefined voice profiles. See Voice Mixing below. |
| `language` | ISO 639-1 | Document language. Affects typographic rules (e.g., French spacing). |

### Brand Roles

| Role | Position | Accent Privilege | Logo Sizing | Where They Appear |
|------|----------|-----------------|-------------|-------------------|
| `primary` | Hero position on title slides | Yes -- accent color on hero and title slides | 1.5x base height | Title, hero, brand row, closing |
| `secondary` | Brand row, owned slides | Only on their owned slides | 1.0x base height | Brand row, owned slides, closing |
| `tertiary` | Footnote, fine print | Never | 0.7x base height | Brand row (if included), legal/footnote |

The manifest is authoritative. If a brand's marketing team insists they should be primary, but the agency manifest says secondary, they are secondary. The manifest is set by the agency before production begins. It is not negotiated during layout.

### Weight

The `weight` field is a relative visual weight multiplier applied to logo sizing. It allows fine-grained control beyond the role-based defaults:

- A primary brand at `weight: 1.5` gets `base_height * 1.5`
- A secondary brand at `weight: 1.2` gets `base_height * 1.2` (slightly elevated within their tier)
- Weight does not change role. A secondary at `weight: 2.0` still cannot claim accent privilege on hero slides.

---

## Logo Hierarchy Rules

Logos are the most politically sensitive element in any multi-brand document. Every brand believes their logo deserves maximum prominence. The hierarchy rules exist to prevent logo negotiation from becoming a design process.

### Sizing

| Role | Multiplier | Height at 1920x1080 |
|------|-----------|---------------------|
| Primary | 1.5x base | 72px |
| Secondary | 1.0x base | 48px |
| Tertiary | 0.7x base | 34px |

Base logo height is **48px at 1920x1080**. At other resolutions, scale proportionally: `base_height = 48 * (slide_height / 1080)`.

The multiplier is then modified by the brand's `weight` from the manifest: `final_height = base_height * role_multiplier * weight`.

### Visual Weight Normalization

Pixel dimensions are not visual weight. A wordmark like "Ford" and an icon like the Fouquet's "F" have radically different visual densities at the same pixel height. A 48px "Ford" wordmark commands far more visual space than a 48px "F" monogram.

The rule: **normalize to perceived prominence, not pixel dimensions.** This is a manual calibration step during document setup. The designer adjusts each logo until they feel equally prominent at the same weight value. There is no formula -- visual weight is perceptual.

Guidelines for calibration:
- Wordmarks (all text, e.g., "Ford", "L'Officiel") tend to need 85-95% of their calculated height
- Lettermarks (single letter or monogram, e.g., Fouquet's "F") tend to need 100-110%
- Icon marks (pictorial, e.g., the Bronco horse) tend to need 95-105%
- Combination marks (icon + text) use the text height as the reference

### Logo Row Layout

The logo row is a horizontal strip appearing on designated slides (typically title and closing). Layout rules:

- **Alignment:** center-aligned horizontally
- **Gap:** 32px between logos at 1920x1080, scaling proportionally with resolution
- **Sort order:** weight descending, then alphabetical by slug (for deterministic ordering at equal weights)
- **Vertical alignment:** center on the shared horizontal axis (logos of different heights align at their vertical midpoints)

### Logo Integrity

- Never stretch logos. Aspect ratio is locked.
- Never rotate logos. 0 degrees, always.
- Never recolor logos beyond the variants the brand provides (light, dark, monochrome).
- If only a dark logo variant exists and the slide is light, use it as-is. Add a subtle shadow (`0 1px 3px rgba(0,0,0,0.1)`) only if legibility suffers.
- If only a light logo variant exists and the slide is dark, use it as-is. Add a subtle glow (`0 0 8px rgba(255,255,255,0.15)`) only if legibility suffers.
- Never auto-generate a logo variant by inverting colors. Use the brand's provided assets or request the missing variant.

---

## Color Dominance Rules

Color is territory. When multiple brands occupy the same document, color must be rationed or the result is a carnival.

### The One-Accent Rule

**Maximum ONE brand accent color per slide.** This is the most important composition rule in the system. Two brand accents on a single slide creates visual competition. Three creates chaos. One creates clarity.

### Accent Privilege

| Slide Type | Who Gets Accent |
|------------|----------------|
| Title / Hero | Primary brand |
| Brand-owned content | The owning brand |
| Data / Comparison | Nobody -- neutral palette only |
| Agency editorial | Nobody -- neutral palette only |
| Closing | Primary brand |

### Where Brand Color Appears

Brand accent color is permitted in exactly these elements:

| Element | Application |
|---------|------------|
| Accent stripe | 4px vertical or horizontal rule |
| Pull quote background | Brand color at 10% opacity |
| Icon tint | Monochrome icons tinted to brand color |
| Chart highlight | Single data point or series belonging to that brand |

### Where Brand Color Never Appears

| Element | Why |
|---------|-----|
| Body text | Colored body text is unreadable and unprofessional |
| Headings | Headings use the document's type hierarchy, not brand colors |
| Slide backgrounds | Backgrounds belong to Layer 0 or Layer 1, not Layer 2 |
| Hero zone background | Exception: primary brand may tint hero zone at 5% opacity maximum |
| Navigation / UI chrome | Chrome is Layer 0 territory |

### Conflict Resolution

When two brand colors would appear on the same slide (e.g., a comparison slide featuring two brands), both defer to the neutral palette. Neither brand gets color. The slide uses Layer 0 tokens exclusively: marsh greens, sand, charcoal, and the standard grey scale.

This is not a compromise -- it is a rule. There is no mechanism for "splitting" a slide between two brand colors. Neutrality is the resolution.

---

## Slide Ownership

Every slide in a multi-brand document belongs to exactly one of three categories. There is no fourth category. There is no "mixed" state.

### Categories

| Category | Palette | Logo Placement | Used For |
|----------|---------|---------------|----------|
| `neutral` | Layer 0 only | None (or small presenter mark) | Data slides, comparisons, disclaimers, transitions |
| `brand-owned` | One brand's accent active | Owner's logo in the ownership zone | Brand-specific content, product features, case studies |
| `agency-branded` | Agency's mark/palette | Agency logo in ownership zone | Intro, outro, editorial commentary, methodology |

### Ownership Zone

On `brand-owned` and `agency-branded` slides, the owning entity's logo appears in a designated ownership zone. This zone is:

- **Position:** top-right corner, 24px from top edge, 32px from right edge
- **Size:** 60% of the logo's brand-row height
- **Opacity:** 80%
- **Purpose:** signals who is speaking on this slide without dominating the content

### Transition Slides

When ownership changes between sections (e.g., from Ford Bronco content to Fouquet's content), insert a neutral transition slide. This visual reset prevents one brand's accent from bleeding into the next brand's territory.

The transition slide uses:
- Layer 0 palette exclusively
- A section title or divider graphic
- No brand logos, no accent colors
- Minimum content -- it exists to create breathing room, not to convey information

---

## Typography Rules

Typography in a multi-brand document follows one law: **one typeface system governs the entire document.** Brand fonts do not enter body copy. Period.

### The Document Typeface

The agency specifies the document typeface in the manifest (or defers to Layer 0's default). This typeface is used for:

- All headings
- All body copy
- All captions
- All data labels
- All navigation and UI elements
- All callout text

If the agency specifies no font preference, the Layer 0 system font stack applies: Arial for proportional text, Courier New for data. The same two-font rule from Chapter 1 governs documents unless the agency overrides it.

### Where Brand Fonts Appear

Brand-specific typefaces appear in exactly three contexts:

1. **Inside the brand's own logo.** The logo is a raster or vector asset -- the font is baked in. It is never recreated in live text.

2. **Pull quotes attributed to that brand.** If the document quotes a brand's tagline or spokesperson, the quote may render in the brand's typeface inside a callout box. The attribution line below uses the document typeface.

3. **Brand name in a callout box.** Maximum three words. Example: a callout reading "Ford Bronco" in Ford's corporate font, inside a bordered box, on a slide that brand owns.

That is the complete list. Brand fonts never appear in:

- Body paragraphs
- Headings
- Data labels
- Footnotes
- Slide titles
- Anywhere that would create a typeface collision when scanning the document

### Why Not Let Each Brand Own Their Slides Typographically?

Because a document with four typeface systems is not a document. It is a collage. The reader's eye must track consistent visual rhythm across slides. Typeface changes break that rhythm -- the brain processes a font switch as a context switch, and in a 40-slide deck that means dozens of involuntary cognitive interruptions.

One typeface, many brands. The typeface is the agency's. The brands are guests.

---

## Voice Mixing

Every multi-brand document has ONE editorial voice. The agency selects it in the manifest. All copy -- headings, body text, captions, callouts -- follows the voice profile.

### Predefined Voice Profiles

| Profile | Characteristics | Sentence Length | Punctuation | Typical Use |
|---------|----------------|-----------------|-------------|-------------|
| `luxury-editorial` | Measured, confident, minimal. Understated authority. | Short. | No exclamation marks. Sparing commas. | High-end brand decks, gallery presentations |
| `technical-authority` | Data-forward, precise, citation-heavy. Numbers lead. | Medium. | Colons and em-dashes frequent. | Market reports, valuation documents, specs |
| `heritage-narrative` | Story-driven, evocative, rich in sensory detail. | Variable, some long. | Full range. Semicolons acceptable. | Provenance documents, history-forward presentations |
| `direct-commercial` | Clear value propositions, action-oriented. Pricing prominent. | Short to medium. | Questions OK. Exclamation marks allowed (one per slide max). | Sales decks, listing packages, proposals |

### Voice Consistency

The document does not modulate voice between brands. A Ford Bronco product slide and a Fouquet's hospitality slide use the same voice profile. The content differs -- the tone does not. This is what makes it a document rather than a folder of individual brand decks stapled together.

### Brand-Attributed Copy

When the document needs to present a brand's own words (a tagline, a mission statement, a spokesperson quote), it appears in a callout box with explicit attribution:

```
+------------------------------------------+
|  "Go Further"                             |
|                     -- Ford Motor Company  |
+------------------------------------------+
```

The callout box uses:
- Brand font for the quoted text (optional -- document font is also acceptable)
- Document font for the attribution line
- Brand accent color at 10% opacity as background
- 1px border in brand accent color at 30% opacity
- Content is always in quotation marks to distinguish it from the agency's editorial voice

Outside of callout boxes, the agency writes everything. The brands are subjects, not authors. Never ghostwrite in a brand's voice -- the reader should always know who is speaking.

---

## Image Treatment

Visual consistency across images from different brands and sources is achieved through a shared treatment profile. All images in the document pass through the same filter pipeline.

### Treatment Profile

| Parameter | Range | Notes |
|-----------|-------|-------|
| Saturation | 0.9 -- 1.1 | Subtle desaturation (0.9) for luxury. Slight boost (1.1) for commercial. |
| Contrast | Normalized | All images brought to a consistent midpoint. No crushed blacks or blown highlights. |
| Temperature | Neutral | No warm/cool shift unless the agency profile specifies one. |
| Sharpening | None | Never sharpen. Source resolution is source resolution. |

### Crop Ratios

| Context | Ratio | When Used |
|---------|-------|-----------|
| Hero / full-bleed | 16:9 | Title slides, section openers, hero moments |
| Content / inline | 4:3 | Product shots, environment images, editorial content |
| Portrait / logo | 1:1 | Headshots, logo containers, square grid items |

**Corner radius: 0px.** Never round image corners in documents. This is a direct extension of Chapter 1's zero-border-radius rule. The image edge is the image edge.

### Product vs. Lifestyle

Not all images receive the treatment profile equally:

- **Brand product images** (cars, watches, buildings, food) keep their original color integrity. No saturation shift, no temperature adjustment, no contrast normalization on the product itself. The product looks like the product. Filters on a car photo lie about the paint color.

- **Lifestyle and environment images** (scenery, atmosphere, context shots) receive the full treatment profile. These images serve the document's mood, not the brand's product accuracy.

This distinction is binary. An image is either product (exempt) or lifestyle (treated). If an image contains both (a car in a landscape), the product exemption wins -- do not filter it.

### Consistency Rule

Never mix filtered and unfiltered images on the same slide. If a slide has one product image (unfiltered) and one lifestyle image (filtered), apply a minimal treatment to the lifestyle image that keeps it close to the product image's natural look. The goal is that no single slide has images that feel like they came from different cameras.

---

## Brand Row Component

The brand row is a standardized component that appears on designated slides. It is the canonical representation of all participating brands in one horizontal strip.

### Layout Specification

| Property | Value | Scales With |
|----------|-------|-------------|
| Orientation | Horizontal | -- |
| Alignment | Center (horizontal + vertical midpoints) | -- |
| Gap | 32px | Resolution (proportional to 1920 base) |
| Position | Bottom of slide, 40px from bottom edge | Resolution |
| Background | Transparent (light slides) or `rgba(255,255,255,0.05)` (dark slides) | Palette mode |

### Logo Sizing Within the Row

Each logo in the brand row is sized to: `base_height * brand_weight`

Where `base_height` is 48px at 1920x1080 (scales proportionally) and `brand_weight` is from the manifest.

### Separator Options

Choose one per document:
- **None:** gap provides separation. Cleaner. Preferred for 3 or fewer brands.
- **Thin vertical line:** 1px width, `var(--doc-muted)` color, 60% of the tallest logo's height. For 4+ brands where visual grouping helps.

### Responsive Behavior

| Brand Count | Base Height Adjustment | Gap Adjustment |
|-------------|----------------------|----------------|
| 1-5 | None | None |
| 6-8 | Reduce base_height by 20% | Reduce gap by 25% |
| 9+ | Reduce base_height by 35% | Reduce gap by 40% |

At 9+ brands, question whether all brands belong in the row. Tertiary brands may be better served in a footnote or legal slide than in a crowded logo strip.

---

## Conflict Resolution

Brand guidelines often contradict each other and the document's composition rules. These conflicts are resolved by a fixed hierarchy, not by negotiation.

### Resolution Hierarchy

```
1. Layer 1 (agency manifest)  -- always wins
2. Document consistency       -- the document must be coherent
3. Brand guidelines           -- respected to maximum extent within above constraints
```

### Common Conflicts and Resolutions

**Brand A says "always on white background" but the slide is dark.**

Use the brand's light logo variant on the dark slide. Do not change the slide background to white. The document's palette mode is set by the agency, not by individual brand requirements. If no light variant exists, use the dark variant with a subtle backing rectangle (`rgba(255,255,255,0.08)`, no border-radius, padding equal to 25% of logo height on all sides).

**Two brands both claim primary status.**

The agency manifest is authoritative. If the manifest says Brand A is primary and Brand B is secondary, that is the hierarchy. Brand B's internal marketing team does not get a vote. This should be resolved before production begins, not during layout.

**A brand requires its proprietary font in all communications.**

The brand's font appears only in their logo, attributed quotes, and brand-name callouts (maximum three words). It does not enter body copy, headings, or data labels. The brand guideline applies to documents the brand authors, not documents the agency authors that mention the brand.

**A brand's minimum clear space requirement exceeds available slide area.**

Scale proportionally. If the brand requires 2x logo height of clear space on all sides but the slide can only accommodate 1.5x, use 1.5x. Document the exception. Do not shrink other brands' logos to create more space for one brand's clear space requirement.

**A brand's color palette has no neutral variant.**

Every brand has a primary color. If a brand provides no secondary or neutral variant, use their primary color only in the permitted accent contexts (stripe, pull quote background, icon tint). Never synthesize a lighter/darker variant by adjusting opacity or HSL values -- use the declared primary or defer to the neutral palette.

**A brand's guidelines specify a minimum logo size larger than the manifest allows.**

The manifest weight determines size. If the resulting size is smaller than the brand's stated minimum, use the manifest size. Logo minimums are designed for independent brand usage. In a multi-brand composition, the composition authority overrides individual minimums.

---

## Anti-Patterns

These are things that happen when composition rules are absent or ignored. Each one has appeared in real multi-brand documents. Each one made the document worse.

### 1. The 50/50 Split

Splitting a slide down the middle with one brand's color on the left and another's on the right. This is not composition -- it is two documents taped together. It creates visual competition where neither brand wins. Use a neutral slide with both brands represented through content, not color.

### 2. The Gradient Background

Using a brand's gradient as a full-slide background. Gradients are brand-specific visual devices. On a slide background, they overwhelm every other element. The slide becomes a billboard for one brand, not a page in a multi-brand document. Slide backgrounds use Layer 0 tokens only.

### 3. The Font Medley

Recreating a brand's proprietary typeface in body text, then switching to another brand's typeface on the next slide. Two slides in, the reader has processed three typeface systems and lost all typographic rhythm. One typeface governs the document. Brand fonts live only in logos and attributed quotes.

### 4. The Logo Collision

Placing competing logos adjacent to each other without neutral spacing. When the Ford oval sits 8 pixels from the Fouquet's monogram, the reader's eye oscillates between them. They compete for recognition instead of coexisting. The 32px gap exists to provide visual breathing room. The neutral transition slide exists to provide temporal breathing room.

### 5. The Eyedropper Palette

Auto-extracting colors from a logo's pixel data instead of using the brand's declared color values. A JPEG-compressed logo's blue might be `#2B5EA7` while the brand's declared blue is `#2B5DAF`. The difference is imperceptible to humans but signals sloppiness to brand managers. Use declared values from official brand guidelines, not sampled pixels.

### 6. The Secondary Accent

Using a brand's secondary palette color as the document's accent instead of their primary. A brand's secondary colors exist for their own extended brand system. In a multi-brand composition, only the primary brand color is used. If the primary is too loud, defer to neutral rather than reaching for the brand's secondary palette.

### 7. The Orphaned Brand

Including a brand in the manifest but never giving them a visual moment in the document. If a brand is in the manifest, they must appear in the brand row and have at least one brand-owned slide or meaningful mention. If they have no content, remove them from the manifest rather than listing a brand that goes unseen.

### 8. The Voice Collision

Writing Ford Bronco copy in rugged adventure voice and Fouquet's copy in refined hospitality voice within the same document. This is not voice -- it is impersonation. The agency's editorial voice profile governs all copy. The brands' individual tones are their own concern in their own materials. In this document, the agency speaks about the brands, not as the brands.

---

## Implementation Checklist

Before rendering any multi-brand document:

- [ ] Manifest exists and is complete (agency, brands, voice, palette mode)
- [ ] All brand assets collected (logo variants for light/dark, declared color values, any font files for attributed quotes)
- [ ] Visual weight calibration done for all logos in the brand row
- [ ] Slide ownership map drafted (which slides are neutral, brand-owned, or agency-branded)
- [ ] Transition slides placed between ownership changes
- [ ] One accent color maximum per slide verified
- [ ] No brand fonts in body copy verified
- [ ] Image treatment profile defined and applied consistently
- [ ] Brand row component sized and sorted correctly
- [ ] Conflict resolution documented for any brand guideline deviations

---

*The agency is the editor. The brands are the subjects. Layer 0 pours the foundation, Layer 1 draws the floor plan, Layer 2 furnishes the rooms. No tenant remodels the building.*

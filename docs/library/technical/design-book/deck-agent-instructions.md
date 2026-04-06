# Deck Agent Instructions

Read this before building any deck. It defines the template system, style guide, content schemas, and quality rules.

## Architecture

Decks are **views of data**, not artisan HTML. Every deck is composed from:

1. **`decks` table** — manifest: id, title, brand_slug, palette_mode, voice, status
2. **`deck_slides` table** — ordered slides with slide_type, bg_type, content (JSONB), entity_slugs
3. **Template components** — 13 React components that render structured content
4. **Style guide CSS** — `src/styles/deck-style-guide.css` — design tokens + component classes

The agent workflow:
1. Create a deck manifest row in `decks`
2. For each slide: pick a template, fill the content schema, reference entities by slug
3. The templates handle layout, logos, colors automatically
4. Human reviews at `/deck/{id}`, exports when ready

## The 13 Templates

| Template | When to use | Key content fields |
|----------|------------|-------------------|
| **CoverSlide** | Opening slide | title, subtitle, prepared_for, hero_image, logos[] |
| **ThesisSlide** | Core argument | title, body[], callout{title, body[], bg} |
| **OpportunitySlide** | Market gap, opportunity, value proposition | title, body[], cards[], images[], footer |
| **StatsSlide** | Data-driven argument | title, stats[{num, label}], body[] |
| **ProofSlide** | Evidence with visuals | title, body[], images[], quote, cards[] |
| **ComparisonSlide** | Side-by-side analysis, competition, before/after | title, columns[], cards[], hotel_table[], items[] |
| **PartnersSlide** | Stakeholder/partner overview | title, partner_cards[{role, entity, body}], footer |
| **ContentSlide** | Two-column editorial content | title, columns[{title, items[], calendar[]}] |
| **AskSlide** | The ask / CTA | title, cards[{title, body, cost}], footer, benchmarks |
| **GallerySlide** | Image showcase | images[{url, caption}], credits |
| **CloseSlide** | Final slide / CTA | title, body[], logos[], next_step, confidential |
| **ProductSlide** | Product spotlight with hero images | title, body[], quote, images[], footer |
| **DividerSlide** | Section break | section_label, title, number |

## Slide Type Aliases

Legacy slide types map to templates:
- `landscape` / `precedent` / `competitive` → **ComparisonSlide**
- `island` → **StatsSlide**
- `value` → **OpportunitySlide**

## Style Guide Tokens

All classes are prefixed with `dk-` and scoped under `.deck-root`.

### Background types
- `dk-light` — bone background, dark text
- `dk-dark` — charcoal background, light text
- `dk-brand` — brand primary color background (e.g., Ford blue)
- `dk-accent` — accent color background (e.g., marsh green)

Map `bg_type` values using `bgTypeToClass()`:
- `light` → `dk-light`
- `dark` → `dk-dark`
- `ford-blue` or `brand` → `dk-brand`
- `marsh` or `accent` → `dk-accent`

### Layout classes
- `dk-grid-2` / `dk-grid-3` / `dk-grid-4` — column grids
- `dk-card` — standard card box
- `dk-card--brand` — card with brand-color fill
- `dk-card--accent` — card with brand-color top border
- `dk-card--large` — card spanning full grid width

### Component classes
- `dk-stat-row` + `dk-stat` + `dk-stat-num` + `dk-stat-label` — stat blocks
- `dk-logo-bar` — centered logo row
- `dk-image-strip` — responsive image grid
- `dk-quote` + `dk-quote-text` + `dk-quote-attr` — blockquote with attribution
- `dk-source-line` — bottom-positioned citation
- `dk-hero-bg` — absolute-positioned background image
- `dk-conf` — confidential label

### Brand overrides
Set `data-brand` on `.deck-root` to override `--dk-brand-primary` and `--dk-brand-accent`:
```html
<div class="deck-root" data-brand="ford">
```
Currently supported: `ford` (`--dk-brand-primary: #003478`, `--dk-brand-accent: #c9a96e`).

## Content Schemas

### CoverContent
```json
{
  "title": "Luxe <strong>Fleet</strong>",
  "subtitle": "Saint-Barthelemy",
  "prepared_for": "Prepared for Ford Motor Company",
  "hero_image": "https://...",
  "hero_opacity": 0.35,
  "logos": ["ford-motor-company", "fouquets-stbarth"],
  "confidential": true
}
```

### ThesisContent
```json
{
  "section_label": "The Thesis",
  "title": "St. Barths is where brands go to be <strong>seen and validated.</strong>",
  "body": ["Paragraph 1...", "Paragraph 2..."],
  "callout": {
    "title": "Callout title",
    "body": ["Callout paragraph..."],
    "bg": "ford-blue"
  },
  "hero_image": "https://...",
  "hero_opacity": 0.1
}
```

### StatsContent
```json
{
  "section_label": "The Island",
  "title": "25 km<sup>2</sup>. 14 beaches.",
  "stats": [
    { "num": "168", "label": "Hours of product contact per guest" },
    { "num": "336x", "label": "vs a 30-min dealership test drive" }
  ],
  "body": ["A single Bronco on St. Barths is seen by hundreds..."],
  "sources": ["Source: LexisNexis 2025"]
}
```

### AskContent
```json
{
  "section_label": "The Ask",
  "title": "One vehicle. One ad buy. <strong>One season to prove it.</strong>",
  "cards": [
    { "title": "1. Place one Bronco", "body": "Details...", "cost": "Cost to Ford: ~$55K at invoice." }
  ],
  "footer": "Total Ford investment: ...",
  "benchmarks": "Benchmarks: Porsche PEC 80% purchase intent..."
}
```

### PartnersContent
```json
{
  "section_label": "The Partners",
  "title": "Every role is filled.",
  "partner_cards": [
    {
      "role": "Operations",
      "title": "FBM Automobiles",
      "entity": "fbm-automobiles",
      "body": "Airport-front since 1994...",
      "accent": "#2EA3F2"
    }
  ],
  "footer": "Nobody is asking Ford to fund the fleet..."
}
```

## Quality Rules

1. **Source every claim.** Stats need a source field or a `sources[]` array on the slide.
2. **McKinsey action titles.** Every slide title should tell the reader what to think, not just what the slide is about. "St. Barths is where brands go to be seen" not "Market Overview".
3. **12-16 slides.** A deck shorter than 12 lacks depth. Longer than 16 loses attention.
4. **Every entity needs logo variants.** Check `organizations.brand_design_language.logos` for each referenced entity. If missing, flag it before building.
5. **Never hardcode image URLs in templates.** Images come from content JSONB or org brand data.
6. **Never hardcode logo URLs.** Logos are resolved at render time via `getLogoForBg(org.brand_design_language, bgType)`.
7. **Use entity_slugs.** Every slide's `entity_slugs` array must list all org slugs referenced in that slide's content.
8. **bg_type drives the palette.** Don't fight it with inline styles. If a card needs brand color, set `bg: "ford-blue"` in the card data.

## Validation Checklist

Before marking a deck as `review`:

- [ ] Every slide has a `slide_type` that maps to a template
- [ ] Every slide has structured content (not just `html`)
- [ ] Every entity in `entity_slugs` exists in `organizations` with logo variants
- [ ] Every stat has a source
- [ ] Cover has `prepared_for`, `hero_image`, `logos`, `confidential`
- [ ] Close has `next_step` and matching `logos`
- [ ] Total slide count is 12-16
- [ ] No hardcoded external URLs in template code (only in content JSONB)

## Export Pipeline

1. User visits `/deck/{id}`
2. Templates render structured content with style guide classes
3. "Export HTML" button captures rendered DOM + computed CSS
4. Produces a standalone HTML file with inlined styles
5. No external dependencies in the export (except font + image URLs)

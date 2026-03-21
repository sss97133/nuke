# DICTIONARY: Enrichable Vehicle Fields

These 13 fields on the `vehicles` table have NO owner in `pipeline_registry`. They can be written by enrichment scripts but must follow the rules in PAPERS: enrichment-rules.md.

---

## equipment
**Type:** text (nullable)
**What goes here:** Factory and aftermarket equipment, comma-separated.
**Examples:** "A/C, power steering, power brakes, AM/FM radio, tilt steering, cruise control"
**Source:** Extract from description or listing page. VIN decode provides factory options.
**Do not:** Guess from year/make/model. Write "unknown" — leave NULL instead.
**Current gap:** 229,024 vehicles with description but NULL equipment.

## highlights
**Type:** text (nullable)
**What goes here:** What makes this vehicle notable or special. Seller-stated highlights.
**Examples:** "matching numbers, original paint, one-owner since new, documented service history, concours winner"
**Source:** Extract from description. Use seller's own words — do not editorialize.
**Do not:** Invent highlights. "Nice truck" is not a highlight. Leave NULL if nothing notable stated.
**Current gap:** 228,724 vehicles missing.

## known_flaws
**Type:** text (nullable)
**What goes here:** Defects, issues, damage, or concerns mentioned by seller or community.
**Examples:** "small tear in driver seat, surface rust on tailgate, A/C needs recharge, minor oil leak"
**Source:** Extract from description and/or auction comments (expert observations).
**Do not:** Assume problems from age/mileage. "Old car, probably has rust" is not data.
**Current gap:** 242,824 vehicles missing.

## modifications
**Type:** text (nullable)
**What goes here:** Aftermarket changes from factory specification.
**Examples:** "aftermarket exhaust, upgraded stereo, lowered 2 inches, LS swap, custom paint"
**Source:** Extract from description. Distinguish from factory equipment.
**Do not:** Write "none" — leave NULL. NULL means unknown, not stock.
**Current gap:** ~229,000 vehicles missing.

## trim
**Type:** text (nullable)
**What goes here:** Trim level (Scottsdale, Silverado, Custom Deluxe, GT, LX, S, etc.)
**Source:** Description, VIN decode (preferred), listing title.
**Do not:** Guess from photos. Trim is a factory designation.

## color
**Type:** text (nullable)
**What goes here:** Exterior color as described by seller.
**Examples:** "Guards Red", "Wimbledon White", "Dark Blue Metallic", "Burgundy"
**Source:** Description, listing page.
**Do not:** Color-correct from photos. If seller says "red" but it looks orange, write "red."

## interior_color
**Type:** text (nullable)
**What goes here:** Interior color as described.
**Source:** Description.

## transmission
**Type:** text (nullable)
**What goes here:** Transmission type. Normalize to standard forms.
**Standard values:** "4-Speed Manual", "5-Speed Manual", "6-Speed Manual", "3-Speed Automatic", "4-Speed Automatic", "Automatic", "Manual", "CVT", "Dual-Clutch"
**Source:** Description, VIN decode.

## engine_type
**Type:** text (nullable)
**What goes here:** Engine type descriptor.
**Examples:** "V8", "Inline-6", "Flat-4", "V12", "I4 Turbo"
**Source:** Description, VIN decode.
**Do not:** Write displacement here — that goes in `engine_size` or `displacement`.

## drivetrain
**Type:** text (nullable)
**What goes here:** Drive configuration.
**Standard values:** "4WD", "AWD", "FWD", "RWD", "4x4", "4x2"
**Source:** Description, VIN decode, model name (K=4WD, C=2WD for GM trucks).
**Note:** Model-name inference is acceptable ONLY for well-known patterns (GM K/C series).

## body_style
**Type:** text (nullable)
**What goes here:** Body configuration.
**Standard values:** "Sedan", "Coupe", "Convertible", "Wagon", "SUV", "Pickup", "Van", "Hatchback", "Roadster", "Targa", "Fastback", "Cab Chassis"
**Source:** Description, listing page, VIN decode.

## mileage
**Type:** integer (nullable)
**What goes here:** Odometer reading as integer.
**Source:** Description, listing page. Write exact number stated.
**Special values:** NULL = unknown. Write TMU note in description if "true mileage unknown" stated.
**Do not:** Average or estimate mileage from age.

## condition_rating
**Type:** integer (nullable), CHECK (1-10)
**What goes here:** Physical condition assessment, 1-10 scale.
**Scale:** 10=concours, 8-9=excellent, 6-7=good driver, 4-5=fair/project, 1-3=parts/salvage
**Source:** ONLY from explicit condition statements or multi-source verification.
**Do not:** Set from a single AI assessment. Requires human review or multiple corroborating sources.
**This field is the most dangerous to enrich incorrectly.** A wrong condition rating directly affects valuation.

---

## Owned Fields (DO NOT WRITE)

| Field | Owner | Action |
|-------|-------|--------|
| `completion_percentage` | `calculate-profile-completeness` | Call function after enriching other fields |
| `quality_grade` | `calculate-vehicle-scores` | Call function |
| `nuke_estimate` | `compute-vehicle-valuation` | Call function |
| `signal_score` | `analyze-market-signals` | Call function |
| `msrp` | `enrich-msrp` | Call function |
| `make`/`model`/`year` (via VIN) | `decode-vin-and-update` | Call function |
| `description` (AI-gen) | `generate-vehicle-description` | Call function, set `description_source` |

## Trigger Fields (Auto-Computed)

| Field | Trigger |
|-------|---------|
| `canonical_outcome` | `trg_resolve_canonical_columns` |
| `canonical_platform` | `trg_resolve_canonical_columns` |
| `canonical_sold_price` | `trg_resolve_canonical_columns` |
| `image_count` | Trigger on `vehicle_images` inserts |
| `observation_count` | Trigger on `vehicle_observations` inserts |

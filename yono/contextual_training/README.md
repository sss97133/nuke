# Contextual Training Data Format

Training models not just on images, but on **data packages** - images + full context.

## Core Concept

When our model sees an image, it also sees:
- Vehicle profile (year, make, model, specs)
- Listing context (description quality, photo count, documentation)
- Behavioral signals (comments, bids, views)
- Outcome (sale price, sold vs no sale)

This is how we train models to understand:
- What makes a **good listing** vs a bad one
- What makes a **good technician** (consistent documentation)
- How to **profile owners** from their garage/vehicle photos

## Training Data Schema

```json
{
  "image_id": "uuid",
  "image_url": "https://...",

  "vehicle_context": {
    "year": 1967,
    "make": "Shelby",
    "model": "GT350",
    "color": "White",
    "mileage": 45000,
    "transmission": "4-Speed Manual",
    "condition_rating": null
  },

  "listing_context": {
    "image_count": 275,
    "description_length": 2500,
    "has_service_records": true,
    "has_documentation": true,
    "seller_type": "dealer"
  },

  "behavioral_signals": {
    "comment_count": 1117,
    "bid_count": 45,
    "view_count": 150000,
    "avg_comment_sentiment": 0.85,
    "question_count": 23,
    "seller_responses": 18
  },

  "outcome": {
    "sale_price": 298350,
    "sold": true,
    "price_vs_estimate": 1.2,
    "days_on_market": 7
  },

  "training_labels": {
    "listing_quality": "excellent",
    "documentation_level": "comprehensive",
    "price_tier": "high"
  }
}
```

## What We're Training

### 1. Listing Quality Predictor
Given: image + vehicle_context + listing_context
Predict: Will this listing sell well? At what price?

### 2. Technician Quality Scorer
Given: work photos + documentation patterns
Predict: Documentation consistency score, skill level

### 3. Owner Profiler
Given: garage photo + vehicle photos
Predict: Owner type (collector, flipper, builder, driver)

## Data Sources

- **25.5M images** with vehicle context
- **10.8M comments** with sentiment
- **287K vehicles** with outcomes
- **130K BAT listings** with full metadata

## Extraction Query

```sql
-- Export contextual training data
SELECT jsonb_build_object(
  'image_id', vi.id,
  'image_url', vi.image_url,
  'vehicle_context', jsonb_build_object(
    'year', v.year,
    'make', v.make,
    'model', v.model,
    'color', v.color,
    'mileage', v.mileage
  ),
  'behavioral_signals', jsonb_build_object(
    'comment_count', bl.comment_count
  ),
  'outcome', jsonb_build_object(
    'sale_price', v.sale_price,
    'sold', v.sale_price IS NOT NULL
  )
)
FROM vehicle_images vi
JOIN vehicles v ON v.id = vi.vehicle_id
LEFT JOIN bat_listings bl ON bl.vehicle_id = v.id
WHERE v.sale_price > 0
LIMIT 1000;
```

# Yono Training Data Architecture

## Data Assets Available

| Source | Count | Content |
|--------|-------|---------|
| `vehicle_images` | 19.3M | Image URLs, labels, categories, angles, components |
| `auction_comments` | 9.3M | Text discussions, Q&A, expert opinions |
| `vehicles` | 255K | Year/make/model, VIN, specs, descriptions |
| `vehicle_observations` | 623K | Event store: repairs, inspections, parts |
| `bat_listings` | 112K | Full auction descriptions |

## Training Data Types

### 1. Image-Vehicle Pairs (Classification)
```sql
SELECT
  vi.image_url,
  v.year, v.make, v.model,
  vi.category,  -- exterior/interior/engine/damage/repair
  vi.angle,     -- front/rear/side/3-4
  vi.labels     -- AI-detected: ["Car", "Wheel", "Sports Car"]
FROM vehicle_images vi
JOIN vehicles v ON v.id = vi.vehicle_id
```

**Training tasks:**
- Vehicle identification (year/make/model from photo)
- Angle detection (front, rear, 3/4)
- Category classification (engine bay, interior, document)
- Component detection (wheels, seats, gauges)

### 2. Image-Text Pairs (Vision-Language)
```sql
SELECT
  vi.image_url,
  vi.caption,
  v.year || ' ' || v.make || ' ' || v.model as vehicle,
  ac.comment_text
FROM vehicle_images vi
JOIN vehicles v ON v.id = vi.vehicle_id
JOIN auction_comments ac ON ac.vehicle_id = vi.vehicle_id
```

**Training tasks:**
- Describe what's in this vehicle photo
- Answer questions about vehicle condition
- Generate parts recommendations from damage photos

### 3. Multi-Image Sequences (Work Documentation)
```sql
SELECT
  vehicle_id,
  array_agg(image_url ORDER BY created_at) as image_sequence,
  array_agg(category ORDER BY created_at) as categories
FROM vehicle_images
WHERE category IN ('repair', 'restoration', 'damage')
GROUP BY vehicle_id
```

**Training tasks:**
- Recognize repair sequences (before/during/after)
- Track restoration progress
- Identify what changed between photos

### 4. Comment-Context Pairs (Expert Knowledge)
```sql
SELECT
  ac.comment_text,
  v.year, v.make, v.model,
  bl.description
FROM auction_comments ac
JOIN vehicles v ON v.id = ac.vehicle_id
JOIN bat_listings bl ON bl.vehicle_id = ac.vehicle_id
WHERE length(ac.comment_text) > 100
```

**Training tasks:**
- Learn collector car vocabulary
- Understand condition terminology
- Extract parts references from text

## Export Pipeline

### Phase 1: Indexed Export (No Full Scans)
```bash
# Create export with cursor-based pagination
supabase functions deploy export-training-batch

# Export in 100K batches
curl -X POST "$SUPABASE_URL/functions/v1/export-training-batch" \
  -d '{"type": "image_vehicle", "cursor": null, "limit": 100000}'
```

### Phase 2: Storage Format
```
/training-data/
├── image_vehicle/
│   ├── batch_001.jsonl
│   ├── batch_002.jsonl
│   └── ...
├── image_text/
│   └── ...
└── comment_context/
    └── ...
```

JSONL format per record:
```json
{
  "image_url": "https://...",
  "vehicle": "1995 Porsche 993 Carrera",
  "labels": ["Car", "Sports Car", "Wheel"],
  "category": "exterior",
  "angle": "front_3_4"
}
```

### Phase 3: Image Download
```python
# Download images to local/cloud storage
# ~19M images × ~200KB avg = ~3.8TB storage needed
```

## Training Approaches

### A. Fine-tune Existing Vision Model
- Base: CLIP, SigLIP, or Florence-2
- Task: Vehicle-specific embedding space
- Output: Better image search, classification

### B. Train Custom Classifier
- Task: Component detection (gauges, seats, wheels, etc.)
- Architecture: EfficientNet or ConvNeXT
- Output: Structured tags for any vehicle photo

### C. Vision-Language Model
- Base: LLaVA, Qwen-VL, or Florence-2
- Training: Image + description/comment pairs
- Output: Answer questions about vehicle photos

### D. Embedding Model for Similarity
- Task: Find similar vehicles, similar damage, similar parts
- Output: Vector embeddings for image search

## Cost Estimates

| Item | Estimate |
|------|----------|
| GPU Training (A100 80GB) | $2-3/hr |
| 100 epochs on 1M images | ~$500-1000 |
| Full 19M dataset | ~$5000-10000 |
| Image storage (3.8TB) | ~$100/month |
| Export compute | ~$50 |

## Next Steps

1. [ ] Build `export-training-batch` edge function with cursor pagination
2. [ ] Create sample dataset (100K images) for validation
3. [ ] Decide primary training task (classification vs VLM)
4. [ ] Set up training infrastructure (RunPod, Lambda Labs, etc.)
5. [ ] Run pilot training on sample dataset
6. [ ] Evaluate and iterate

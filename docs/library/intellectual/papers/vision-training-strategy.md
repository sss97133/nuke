# Vision Training Strategy — From Borrowed Models to Nuke's Own Eyes

**Status:** Strategy document. No model training yet.
**Created:** 2026-03-23
**Prerequisite:** High-quality labeled data across all enrichment filters

---

## The Thesis

We have 33M vehicle images. Every image analysis model we use today (YONO EfficientNet, Florence-2, hypothetical YOLOv8) was trained on someone else's data for someone else's purpose. They work generically but fail on our specific domain: vintage vehicles, marketplace photos, build-in-progress shots, barn finds.

**The goal:** Train a model on OUR images, labeled by OUR text-side data (descriptions, comments, RPO codes, field evidence), that understands collector vehicles at the resolution WE need.

**The insight:** Text data labels vision data. We don't need humans to label 33M images. We need text extraction to be good enough that it becomes truth, then we use that truth to train the model.

---

## The Label Sources (text → vision ground truth)

### Identity Labels (what vehicle is this?)
- **vehicles.year/make/model** — 325K vehicles, 99% populated
- **vehicles.vin** → VIN decode → factory specs (76% have VIN)
- **gm_rpo_library** — 15,568 option codes with descriptions
- **oem_vehicle_specs** — 57,877 EPA/NHTSA specs

These label WHAT should be in the photo. A 1977 Blazer with RPO Z82 (trailering package) should have a transmission cooler visible in the engine bay. The model learns to see what the spec sheet predicts.

### Condition Labels (what state is it in?)
- **description_discoveries.raw_extraction** — 16K structured extractions with condition signals
- **comment_discoveries** — 126K with sentiment and condition mentions
- **vehicles.known_flaws** — 15,685 populated (explicit defect lists)
- **vehicles.condition_rating** — 29,396 populated (1-10 scale)
- **field_evidence** — 173K cited facts with confidence scores

These label CONDITION. A description saying "surface rust on rear wheel wells" + a comment saying "the rust looks cosmetic, not structural" → labels for what the rear quarter panel photo shows AND its severity.

### Zone Labels (what part of the vehicle?)
- **vehicle_images.vehicle_zone** — 292K classified (72% accuracy = ~210K usable)
- **auction listing photo ordering** — BaT lists photos in consistent order (hero, rear, side, interior, engine, detail). Position predicts zone.
- **Florence-2 photo_type** — coarse zone (exterior_side, engine_bay) but more reliable

### Provenance Labels (is it original?)
- **field_evidence.proposed_value** with source_type='extraction' — "matching numbers" claims
- **vehicles.modifications** — 20K populated (explicit mod lists)
- **RPO code presence/absence** — if RPO says factory A/C but no A/C visible → modification detected

---

## Training Phases

### Phase 0: Label Quality Audit (NOW)
Before training anything, measure label quality:
- Sample 100 vehicles with rich text data
- For each: does the text match what's in the photos?
- Compute: text-vision agreement rate per field
- This tells us which text labels are trustworthy enough to train on

### Phase 1: Zone Classifier Retrain (week 1-2)
- **Data:** 210K correctly-zoned images (from 292K at 72% accuracy, filter by confidence)
- **Augment with:** BaT photo ordering (position 1 = hero shot, position 5 = interior, etc.)
- **Model:** EfficientNet-B0 or MobileNetV3 (fast, local inference)
- **Target:** 85%+ accuracy on FB marketplace images (currently ~10%)
- **Validation:** 500 hand-labeled FB marketplace images

### Phase 2: Damage/Condition Detector (week 2-4)
- **Data:** Pre-trained YOLOv8 car-parts model → fine-tune on our images
- **Labels from text:** known_flaws + comment condition mentions → bounding box annotations
- **Target:** Detect dents, rust, scratches, paint issues, missing parts
- **Output:** (x, y, w, h, damage_type, severity) per detection per image
- **This enables:** 2D condition heatmap per vehicle

### Phase 3: Component Recognizer (month 2-3)
- **Data:** Engine bay photos + RPO-decoded specs
- **Labels:** RPO says Quadrajet carburetor → engine bay photo should contain Quadrajet-shaped object
- **Target:** Identify specific components in photos (carburetor type, valve cover style, exhaust manifold)
- **Validation:** Cross-reference with digital twin engine tables
- **This enables:** Visual verification of claimed specs

### Phase 4: The Nuke Eye (month 3-6)
- **Multi-task model:** zone + condition + component + originality in one pass
- **Trained on:** All of the above, with the model's own predictions from Phase 1-3 as additional labels (self-distillation)
- **Input:** Single vehicle image
- **Output:** {zone, zone_confidence, condition_score, damage_detections[], components_visible[], originality_flags[], photo_quality}
- **This IS the differentiator:** No one else has 33M vintage vehicle images labeled by 173K field evidence chains and 126K comment discoveries

---

## The Flywheel

```
Text extraction improves → better labels
  → Better labels train better models
  → Better models detect things text missed
  → Detections become new observations
  → Observations corroborate or contradict text
  → Text + vision together = higher confidence than either alone
  → Higher confidence = better labels for next training round
```

---

## Infrastructure Requirements

### Training Hardware
- **Phase 1-2:** Single T4 on Modal (~$0.59/hr, ~10 hours = $6)
- **Phase 3:** T4 or A10G on Modal (~$1.10/hr, ~20 hours = $22)
- **Phase 4:** A100 on Modal (~$3.00/hr, ~40 hours = $120)
- Total estimated: ~$150 for the full training sequence

### Inference (production)
- **Local (free):** ONNX on CPU for zone/condition (current YONO approach)
- **Modal ($0.59/hr):** GPU inference for damage detection (YOLOv8)
- **Batch processing:** Process images in batches during off-peak, cache results

### Data Pipeline
- Images must be accessible by URL (Supabase Storage for FB, BaT CDN for BaT)
- BaT CDN blocks server-side fetch → need to download to Supabase Storage first
- FB images already in Supabase Storage ✓

---

## What Needs to Happen First

1. **Text enrichment quality must reach a threshold.** If 50%+ of description extractions are accurate, those become trainable labels. We're running extraction now — need to MEASURE quality before using output as training data.

2. **BaT images need to be accessible.** 30M images on BaT CDN that we can't fetch server-side. Need a download-to-storage pipeline for the subset we'll train on.

3. **A hand-labeled validation set.** 500 images, manually labeled for zone + condition + visible components. This is the ground truth that measures everything else. Can't avoid this step.

4. **The Phase 0 audit.** Does text match photos? If a description says "rust on rear fender" — does the photo actually show rust? This is the text-vision alignment check that validates our entire training data strategy.

---

## The End State

A model that looks at a photo of a 1977 Chevrolet K5 Blazer engine bay and says:

```json
{
  "zone": "mech_engine_bay",
  "zone_confidence": 0.97,
  "components_detected": [
    {"name": "Rochester Quadrajet carburetor", "confidence": 0.92, "bbox": [120, 80, 280, 200]},
    {"name": "HEI distributor", "confidence": 0.89, "bbox": [300, 100, 380, 190]},
    {"name": "Air cleaner assembly (aftermarket)", "confidence": 0.85, "bbox": [100, 40, 310, 120]},
    {"name": "Valve covers (chrome aftermarket)", "confidence": 0.88, "bbox": [80, 120, 350, 180]}
  ],
  "condition": {
    "overall": 4,
    "rust_detected": false,
    "leak_detected": false,
    "modification_level": "mild",
    "cleanliness": "well_maintained"
  },
  "originality_assessment": {
    "air_cleaner": "aftermarket",
    "valve_covers": "aftermarket",
    "carburetor": "original_type",
    "distributor": "original_type"
  },
  "photo_quality": 4,
  "surface_coverage": {"u_range": [0.3, 0.7], "v_range": [0.2, 0.8]}
}
```

That's full resolution depth on a single image. Multiply by 141 median images per vehicle. Stack the results. You have the digital twin's eyes.

# Vision Gap Analysis — What Exists, What's Broken, What's Next

**Created:** 2026-03-23
**Status:** Diagnostic paper. Documents the chicken-and-egg problem and the path through it.

---

## The Situation

YONO has 12 ONNX models deployed, a 69-node condition taxonomy, a 5-pass scoring pipeline, a weekly retraining cron, and 1,600 lines of condition spectrometer code. The architecture is ambitious and largely complete on paper.

In practice: zone classification gets 9% confidence on real-world images. The condition spectrometer's Passes 2-3 have never been called from the server. The auto-labeling script is abandoned. The Y/M/M knowledge profiles are half-built. The session detector is orphaned.

We keep building new scripts instead of wiring the existing system together.

---

## What Exists (Complete Inventory)

### Working (deployed, tested, producing output)
| Component | What It Does | Quality |
|-----------|-------------|---------|
| EfficientNet flat classifier | Make classification (276 classes) | 23% accuracy — low but functional |
| Hierarchical classifier | Family → make (Tier-1: 70%, Tier-2: 50-60%) | Better than flat, still mediocre |
| Zone classifier | 41 zones from Florence-2 + custom head | 72.8% on clean images, ~10% on FB/real-world |
| Florence-2 condition head | condition_score (1-5), photo_quality (1-5) | Produces output but unvalidated |
| Florence-2 damage/mod flags | 7 damage + 8 modification binary flags | Mostly returns empty arrays |
| Modal inference server | /classify + /analyze endpoints | Working, 50-1200ms per image |
| Weekly retraining cron | Auto-retrains on 10K+ new images | Running but retrains on same bad labels |

### Written But Not Wired (code exists, never called in production)
| Component | File | Why Abandoned |
|-----------|------|---------------|
| Condition Spectrometer Pass 2 (contextual) | `condition_spectrometer.py:contextual_pass()` | Requires Y/M/M knowledge tables — partially built |
| Condition Spectrometer Pass 3 (sequence) | `condition_spectrometer.py:sequence_pass()` | Requires photo session grouping — detector exists but orphaned |
| Y/M/M Knowledge Builder | `build_ymm_knowledge.py` | Manual run only, never automated |
| Session Detector | `session_detector.py` | Code works, never integrated |
| Auto-Label Pipeline | `auto_label_images.py` | Claude Vision labeling, abandoned |
| Description Generator | `description_generator.py` | Condition → narrative, orphaned |
| COLMAP 3D Reconstruction | Referenced in VISION_ARCHITECTURE.md | Never started |
| Surface Coordinate Mapping | `surface_coord_u/v` columns on vehicle_images | Columns exist, always NULL |

### Schema Built But Empty
| Table | Purpose | Rows |
|-------|---------|------|
| `condition_taxonomy` | 69 descriptors across 5 domains | 69 ✓ |
| `condition_aliases` | Maps legacy flags → taxonomy nodes | 45 ✓ |
| `image_condition_observations` | Per-image multipass observations | ? (likely sparse) |
| `vehicle_condition_scores` | Vehicle-level 0-100 condition | ? (likely sparse) |
| `condition_distributions` | Per-Y/M/M statistics | ? (likely empty) |
| `vehicle_coverage_map` | Zone coverage per vehicle | Empty |

---

## The Chicken-and-Egg Problem

```
Can't train good zone classifier → without good zone labels
Can't get good zone labels      → without good zone classifier (or manual labeling)
Can't do condition assessment    → without knowing what zone we're looking at
Can't validate condition output  → without ground truth condition data
Can't build ground truth         → without running the pipeline at scale
Can't run at scale               → without trusting the output quality
```

### Why This Hasn't Been Solved

Every attempt to break the cycle has been abandoned:
1. **Auto-label with Claude Vision** → abandoned (script exists, never ran at scale)
2. **Train zone classifier** → trained on 2K images, needs 5K+ for real-world accuracy
3. **Run YONO at scale** → paused globally (NUKE_ANALYSIS_PAUSED flag) because output quality unknown
4. **Validate output quality** → no ground truth to validate against
5. **Build ground truth** → would require human labeling, which was deemed too expensive

### The Bridge We Missed

**Text data IS the ground truth.** We have:
- 173K field evidence rows (cited facts about vehicles)
- 126K comment discoveries (condition signals from auction comments)
- 15.5K RPO codes (factory specifications)
- 29.5K YMM knowledge profiles
- 57K OEM specs (EPA + NHTSA)

A description that says "surface rust on rear wheel wells" IS a zone label (rear exterior) AND a condition label (rust, surface-level) AND a severity label (cosmetic). We don't need Claude Vision to label images. We need to map text claims to the 69-node condition taxonomy and the 41-zone classification system.

This mapping exists conceptually in the condition_aliases table (45 rows). It needs to be expanded and automated.

---

## Issue Frequency Tally

How many times has each problem surfaced across sessions, documentation, and ACTIVE_AGENTS.md?

| Issue | Mentions | First Seen | Last Seen |
|-------|----------|-----------|-----------|
| Zone classifier accuracy too low | 5+ | Feb 2026 | Mar 23 2026 |
| YONO globally paused | 4+ | Feb 2026 | Mar 23 2026 |
| BaT images inaccessible server-side | 4+ | Feb 2026 | Mar 23 2026 |
| Condition spectrometer passes 2-3 not wired | 3 | Feb 2026 | Mar 23 2026 |
| Not enough zone training labels | 3+ | Feb 2026 | Mar 23 2026 |
| Text data not connected to vision labels | 2 | Mar 14 2026 | Mar 23 2026 |
| Session detector abandoned | 2 | Feb 2026 | Mar 23 2026 |
| No ground truth validation set | 3+ | Feb 2026 | Mar 23 2026 |
| Surface coordinates always NULL | 2 | Feb 2026 | Mar 23 2026 |
| 3D reconstruction never started | 2 | Feb 2026 | Mar 23 2026 |
| Y/M/M knowledge profiles incomplete | 2 | Feb 2026 | Mar 23 2026 |
| FB images in storage but never analyzed | 1 | Mar 23 2026 | Mar 23 2026 |
| Damage flags always empty | 2 | Mar 23 2026 | Mar 23 2026 |
| Model hallucinations (7B VL on car photos) | 1 | Mar 23 2026 | Mar 23 2026 |
| Using generic models for domain-specific tasks | 1 | Mar 23 2026 | Mar 23 2026 |

---

## The Path Through

### Step 1: Generate Zone Training Labels from Text (cost: $0)

We have 29.5K BaT vehicles with rich descriptions + 141 median photos each. BaT lists photos in a consistent order:
- Position 0: Hero shot (ext_front_driver)
- Position 1: Rear 3/4 (ext_rear_passenger)
- Position 2-3: Side profiles
- Position 4-5: Interior
- Position 6: Engine bay
- Position 7-8: Detail shots

This ordering IS a zone label. 29.5K vehicles × ~8 reliable positions = ~236K zone labels FOR FREE. No vision model needed. No human needed. Just photo position → zone mapping.

Combine with text claims: if description says "engine bay" and photo position is 6, that's a HIGH CONFIDENCE zone label.

### Step 2: Retrain Zone Classifier on 236K Labels (cost: ~$6 on Modal T4)

The current zone classifier was trained on 2K images. With 236K position-derived labels + text-claim reinforcement, accuracy should jump from 72.8% to 85%+ even on messy FB photos. The model doesn't need to be smart — it just needs volume of good labels.

### Step 3: Wire Condition Spectrometer Passes 2-3 into Server (cost: $0, just code)

The code EXISTS in `condition_spectrometer.py`. Passes 2-3 need:
- Pass 2: Y/M/M knowledge context → `build_ymm_knowledge.py` exists, run it
- Pass 3: Photo sequence grouping → `session_detector.py` exists, run it

Wire these into `modal_serve.py` so `/analyze` calls all 5 passes instead of just Pass 1.

### Step 4: Run on User's Vehicles First (cost: ~$1.50 on Modal)

The 1977 Blazer (1,686 images) and K10 (120 images) are 100% in Supabase Storage. Run the full 5-pass pipeline on these. User can personally validate every observation. This is the ground truth that validates the system.

### Step 5: Map Text Claims to Condition Taxonomy (cost: $0)

Expand `condition_aliases` from 45 rows to cover all common damage/modification terminology. Map field_evidence + comment_discoveries claims to taxonomy nodes. These become the expected condition labels that the vision system confirms or contradicts.

### Step 6: The Quadrant Grid (cost: $0 model, just prompting)

Don't ask the model "what do you see?" Ask:
- Divide image into 4x4 grid (16 quadrants)
- Per quadrant: material? (metal/glass/rubber/chrome/fabric/plastic/none)
- Per quadrant: condition? (intact/worn/damaged/missing/modified)
- Per quadrant: color match? (matches expected vehicle color or not)

A 7B model can answer these simple binary/categorical questions accurately. The vehicle-specific interpretation (which quadrant maps to which body panel) comes from US, not the model.

### Step 7: Selective BaT Image Mirroring (cost: ~$0 storage, time investment)

For the 186 NEEDS_WORK vehicles: mirror their BaT images to Supabase Storage during the next extraction pass. ~26K images, ~2.6GB. Piggyback on archiveFetch — when we visit a BaT page for any reason, also download the images.

---

## What NOT To Do

1. **Don't train on bad labels.** The weekly cron retrains on whatever data exists. If zone labels are 10% confidence garbage, retraining makes it worse. Fix labels FIRST.

2. **Don't use generic VL models for domain tasks.** llava:7b saying "rust and corrosion" is newspaper writing. Use the condition taxonomy (69 specific descriptors) as the vocabulary.

3. **Don't build more scripts.** The scripts exist. `condition_spectrometer.py`, `session_detector.py`, `auto_label_images.py`, `build_ymm_knowledge.py` — all written, all abandoned. Wire them together.

4. **Don't mirror all 27.8M BaT images.** Mirror selectively: user's vehicles first, NEEDS_WORK tier second, scale from proven quality.

5. **Don't ask "what do you see?" Ask "is this metal? is it rusted? how much?"** Simple questions get accurate answers from small models.

---

## Success Criteria

The vision system reaches full resolution when:

1. **Zone accuracy ≥ 85%** on real-world images (not just clean BaT photos)
2. **Condition observations use the 69-node taxonomy** (not generic "damage" flags)
3. **Each image produces a quadrant grid** of material × condition observations
4. **Observations are mapped to vehicle surface coordinates** (even coarse: front-left, rear-right)
5. **Text claims are confirmed or contradicted** by vision observations
6. **The user validates** on their own vehicles first

---

## Estimated Effort

| Step | Effort | Cost | Dependency |
|------|--------|------|------------|
| 1. Position-based zone labels | 2 hours | $0 | None |
| 2. Retrain zone classifier | 4 hours + 10hr training | $6 | Step 1 |
| 3. Wire passes 2-3 | 4 hours | $0 | build_ymm_knowledge |
| 4. Run on user vehicles | 1 hour | $1.50 | Steps 2-3 |
| 5. Text → taxonomy mapping | 3 hours | $0 | None |
| 6. Quadrant grid prompting | 4 hours | $0 | None |
| 7. Selective BaT mirror | 2 hours | $0 | None |
| **Total** | **~20 hours** | **~$7.50** | Sequential |

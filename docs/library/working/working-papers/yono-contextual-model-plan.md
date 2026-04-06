# YONO Contextual Model — Scoping Plan

> Given a vehicle's photos + specs + market comps, estimate fair market value.

Last updated: 2026-03-31

---

## 1. Problem Statement

The platform has 351K sold vehicles with prices and 290K with both `nuke_estimate` and `sale_price`. The current `nuke_estimate` baseline has **28% median absolute percentage error (MdAPE)** — better than nothing, but far from production-grade pricing. The goal is a model that combines visual features (what the vehicle *looks like*) with structured context (what it *is*) to predict fair market value with substantially lower error.

**Success metric:** MdAPE < 20% on held-out sold vehicles (30% relative improvement over current `nuke_estimate` baseline).

**Stretch goal:** MdAPE < 15%, which would make the estimate trustworthy enough for auction coaching and acquisition recommendations.

---

## 2. Current Infrastructure (What Exists)

### 2.1 Vision Pipeline (Live on Modal)

| Component | Status | Details |
|-----------|--------|---------|
| Make classifier | Live | EfficientNet-B2, hierarchical (8 families + per-family), ONNX, 58 makes, ~50ms/image |
| Zone classifier | Live | Florence-2 encoder + ZoneClassifierHead (768->512->256->41 zones), 72.8% val acc |
| Vision analyzer | Live | Florence-2 + VehicleVisionHead, outputs condition_score (1-5), damage_flags, modification_flags, photo_quality |
| Serving | Live | `modal_serve.py`, FastAPI on Modal, `/classify`, `/analyze`, `/analyze/batch` |
| Edge proxies | Live | `yono-classify/`, `yono-analyze/` Supabase edge functions |

### 2.2 Contextual Training (Scaffolded, Not Yet Trained)

| Component | Status | Details |
|-----------|--------|---------|
| `modal_contextual_train.py` | v2 scaffolded | EfficientNet-B0 + 7D context -> 5-class price tier (classification) |
| `featurizers.py` | Complete | 3 featurizers: YMM profile (~200D), vehicle instance (20D), user timeline (10D) — total ~230D |
| `export_contextual_data.py` | Complete | Exports training packages: image + YMM knowledge vector + vehicle context + labels |
| `build_ymm_knowledge.py` | Complete | Pre-computes YMM feature vectors from historical data |

### 2.3 Key Observation

The v2 contextual model trains a **classifier** (5 price tiers), not a **regressor** (continuous price). This is the wrong formulation for a pricing model. A vehicle predicted as "mid tier ($50-100K)" tells you nothing useful — you need to know it's worth $67,000.

---

## 3. Training Data

### 3.1 Volume

| Dataset | Count |
|---------|-------|
| Sold vehicles (year + make populated) | 351,968 |
| With `nuke_estimate` and `sale_price` | 290,226 |
| With photos (joins vehicle_images) | ~300K+ (query timed out on exact JOIN, but nearly all auction vehicles have photos) |

### 3.2 Price Distribution (Stratified)

| Tier | Vehicles | Avg Price |
|------|----------|-----------|
| Elite ($500K+) | 5,158 | $1,713,017 |
| High ($100-500K) | 37,965 | $181,916 |
| Mid ($50-100K) | 61,474 | $69,475 |
| Entry ($10-50K) | 191,789 | $25,423 |
| Budget (<$10K) | 55,582 | $5,893 |

**Note:** Heavy skew toward entry tier (54%). Stratified sampling is essential.

### 3.3 Top Makes by Sold Volume

| Make | Sold |
|------|------|
| Chevrolet | 62,806 |
| Ford | 44,381 |
| Porsche | 27,330 |
| Mercedes-Benz | 21,225 |
| BMW | 19,989 |
| Toyota | 11,209 |
| Dodge | 9,281 |
| Pontiac | 8,575 |
| Volkswagen | 7,335 |
| Ferrari | 6,462 |

**Implication:** Enough volume for per-make calibration heads or make-specific fine-tuning. Even the 10th make (Ferrari) has 6.4K examples — plenty for regression.

### 3.4 Available Features Per Vehicle

**Image features** (from existing YONO pipeline):
- EfficientNet-B0/B2 embeddings: 1280D
- Zone classification: 41-class categorical
- Condition score: 1-5 ordinal
- Damage flags: 7 binary flags
- Modification flags: 8 binary flags
- Photo quality: 1-5 ordinal

**Structured features** (from `featurizers.py`, ~230D):
- YMM knowledge profile: ~200D (market position, common mods, engine families, production era, etc.)
- Vehicle instance: 20D (year, mileage, drivetrain, transmission, color encoding, etc.)
- User timeline: 10D (photo-taking patterns, session count, etc.)

**Behavioral signals** (from DB):
- Comment count, bid count, view count
- Avg comment sentiment, question count, seller response rate
- Description length, has_service_records, has_documentation

---

## 4. Architecture Options

### Option A: Regression Head on Frozen EfficientNet + Tabular Features (Recommended First)

```
[Image] -> Frozen EfficientNet-B0 -> 1280D embedding
                                          |
[Tabular] -> MLP(230D -> 128D) ----------+-- concat -> 1408D
                                                          |
                                               MLP(1408 -> 512 -> 256 -> 1)
                                                          |
                                                   log(sale_price)
```

**Why log-price:** Sale prices span $500 to $50M. Log transform makes the distribution approximately normal and converts multiplicative errors (what matters for pricing) into additive errors (what MSE optimizes).

**Loss function:** Huber loss on log(price) — robust to outliers (misattributed sale prices, joke bids).

**Pros:**
- Fastest to train (~2-4 hours on A100 with 300K images)
- Leverages existing frozen backbone — no vision model risk
- Tabular features carry most of the signal (year/make/model/mileage explain ~70% of price variance)
- Easy to interpret: ablation shows vision vs tabular contribution

**Cons:**
- Frozen backbone may miss price-relevant visual features (paint quality, rarity cues, provenance documentation visible in photos)
- Linear combination may miss cross-modal interactions

**Estimated performance:** MdAPE 18-22% (substantially better than current 28%)

### Option B: Fine-tuned EfficientNet with Price Regression Loss

Same architecture as A, but unfreeze the last 2 blocks of EfficientNet and train end-to-end.

**Pros:**
- Vision encoder learns price-relevant features (shiny paint vs patina, professional vs amateur photos, garage queen vs daily driver)
- Potentially 2-5% MdAPE improvement over Option A

**Cons:**
- 3-5x longer training time (~12-20 hours)
- Risk of catastrophic forgetting if learning rate too high
- Needs careful LR scheduling: backbone 1e-5, heads 1e-3

**Estimated performance:** MdAPE 15-20%

### Option C: Contrastive Learning (Similar Vehicles -> Similar Prices)

Train a shared embedding space where visually/contextually similar vehicles cluster together, then use k-NN regression for price prediction.

**Pros:**
- Naturally handles the "comps" use case (find similar sold vehicles)
- Embedding space is reusable for search, recommendation, etc.
- No explicit price label needed during contrastive phase

**Cons:**
- Two-stage training (contrastive + regression head) is more complex
- k-NN inference is O(N) without approximate nearest neighbor index
- Harder to debug and explain

**Recommendation:** Defer to Phase 2. The embedding space is valuable but Option A/B solve the immediate pricing problem faster.

---

## 5. Recommended Build Sequence

### Phase 1: Tabular Baseline (0 GPU, 1 day)

Before touching images, establish a tabular-only baseline:
- Features: year, make, model, mileage, transmission, drivetrain, color, comment_count, bid_count, auction_source, description_length
- Model: XGBoost or LightGBM on log(sale_price)
- Expected: MdAPE ~20-25%
- **This tells us the ceiling for how much vision can help.**

### Phase 2: Frozen Vision + Tabular (Option A, 2 days)

- Stage 100K images to Modal volume (existing `stage_data` function works)
- Train EfficientNet-B0 frozen + 230D context MLP + regression head
- 30 epochs, batch 64, A100
- Evaluate: If MdAPE < 22%, ship it. If not, go to Phase 3.

### Phase 3: Fine-tuned Vision (Option B, 3 days)

- Unfreeze last 2 blocks of EfficientNet
- Differential LR: backbone 1e-5, context MLP 1e-4, regression head 1e-3
- Cosine annealing with warm restarts
- Mixed precision training (fp16) for speed

### Phase 4: Production Integration (2 days)

- Export best model to ONNX
- Add `/estimate` endpoint to `modal_serve.py`
- Create `yono-estimate` edge function (or add to existing `yono-analyze`)
- Write results to `vehicles.nuke_estimate` with provenance (`nuke_estimate_source = 'yono_contextual_v1'`)
- Backfill all vehicles with photos

---

## 6. Infrastructure

### Training

| Resource | Spec | Cost |
|----------|------|------|
| GPU | A100 40GB (Modal) | ~$3.00/hr |
| Phase 1 (tabular) | CPU only | ~$0 |
| Phase 2 (frozen) | ~4 hrs A100 | ~$12 |
| Phase 3 (fine-tuned) | ~16 hrs A100 | ~$48 |
| Image staging | CPU + network | ~$2 (80 concurrent downloads, ~2hrs) |
| **Total training cost** | | **~$62** |

### Inference

| Metric | Target |
|--------|--------|
| Latency (single image) | <200ms (ONNX on CPU) |
| Latency (batch 20) | <1s |
| Cost per inference | ~$0 (ONNX on CPU, same container as classify) |
| Cold start | Same as existing YONO serve (~15s, amortized by min_containers=2) |

### Storage

- Training data on Modal volume: ~50GB (100K images at ~500KB each)
- Model checkpoint: ~30MB (EfficientNet-B0 + heads)
- ONNX export: ~20MB

---

## 7. API Design

### Endpoint: `POST /estimate`

**Request:**
```json
{
  "image_url": "https://...",
  "vehicle_context": {
    "year": 1967,
    "make": "Shelby",
    "model": "GT350",
    "mileage": 45000,
    "transmission": "4-Speed Manual",
    "color": "White"
  }
}
```

If `vehicle_context` is omitted, the model uses YONO make classifier output + defaults. Performance degrades ~5% MdAPE without explicit context.

**Response:**
```json
{
  "estimate_usd": 298000,
  "confidence_interval": [245000, 365000],
  "log_price": 12.605,
  "log_std": 0.20,
  "price_tier": "high",
  "model_version": "yono_contextual_v1",
  "features_used": {
    "vision": true,
    "tabular": true,
    "ymm_knowledge": true
  },
  "ms": 180,
  "source": "yono_contextual"
}
```

**Confidence interval:** Derived from log-normal distribution: `exp(log_price +/- 1.0 * log_std)`. The `log_std` comes from a second output head trained on calibration data (or from bootstrap ensemble).

### Edge Function: `yono-estimate`

Proxies to Modal `/estimate`, same pattern as `yono-classify` and `yono-analyze`. Optionally writes to `vehicles.nuke_estimate` if `vehicle_id` is provided.

---

## 8. Evaluation Plan

### Metrics

| Metric | What It Measures | Target |
|--------|-----------------|--------|
| MdAPE | Median absolute percentage error | <20% |
| MAPE | Mean absolute percentage error (sensitive to outliers) | <30% |
| MAE | Mean absolute error in USD | <$15K |
| R-squared | Explained variance | >0.85 |
| Per-tier accuracy | Price tier classification (derived from regression) | >70% |

### Baselines for Comparison

| Baseline | Expected MdAPE |
|----------|---------------|
| `nuke_estimate` (current, LLM-generated) | 28% |
| Tabular-only (XGBoost on year/make/model/mileage) | ~22% |
| YONO contextual v1 (frozen vision + tabular) | ~18-22% |
| YONO contextual v2 (fine-tuned vision + tabular) | ~15-20% |

### Evaluation Protocol

1. **Hold-out set:** 10% of sold vehicles, stratified by price tier, never seen during training
2. **Temporal split:** Train on sales before 2025-07-01, validate on 2025-07 to 2025-12, test on 2026+
3. **Per-make breakdown:** Report MdAPE per top-15 make to catch systematic biases
4. **Calibration plot:** Predicted vs actual, binned — should be 45-degree line
5. **Confidence calibration:** 68% of actuals should fall within 1-sigma confidence interval

---

## 9. Timeline

| Phase | Work | Effort | Dependencies |
|-------|------|--------|-------------|
| Phase 1: Tabular baseline | Export features, train XGBoost | 1 day | None |
| Phase 2: Frozen vision | Stage images, train frozen model | 2 days | Phase 1 (for comparison) |
| Phase 3: Fine-tuned vision | Unfreeze backbone, retrain | 3 days | Phase 2 (if needed) |
| Phase 4: Production | ONNX export, endpoint, edge function, backfill | 2 days | Best model from 2 or 3 |
| **Total** | | **~8 days** | |

### What's Already Done (from existing code)

- Image staging pipeline (`stage_data` in `modal_contextual_train.py`) — works
- Featurizers (`featurizers.py`, ~230D) — complete
- YMM knowledge builder (`build_ymm_knowledge.py`) — complete
- Export pipeline (`export_contextual_data.py`) — complete
- Model architecture scaffold (`ContextualModel` in `modal_contextual_train.py`) — needs regression refactor
- Modal serving infra (`modal_serve.py`) — just add `/estimate` endpoint

### What Needs Building

1. **Regression refactor:** Change `ContextualModel` from 5-class classifier to log-price regressor with Huber loss
2. **Tabular baseline script:** XGBoost/LightGBM on exported features (new, ~100 lines)
3. **Temporal train/val/test split:** Replace random split with date-based split
4. **Confidence interval head:** Second output for log-standard-deviation (aleatoric uncertainty)
5. **`/estimate` endpoint** in `modal_serve.py`
6. **`yono-estimate` edge function** (or integrated into `yono-analyze`)
7. **Backfill script** to update `vehicles.nuke_estimate`

---

## 10. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Tabular features dominate, vision adds little | High | Low | Still useful — tabular baseline alone beats current nuke_estimate |
| Elite tier overfitting (only 5K examples) | Medium | Medium | Stratified sampling + class-weighted loss + data augmentation |
| Auction source bias (BaT prices != FB Marketplace prices) | High | Medium | Include `auction_source` as feature; consider source-specific calibration |
| Image quality variance (professional BaT photos vs phone FB photos) | Medium | Low | Photo quality score from vision head as input feature |
| Temporal drift (market prices change over time) | Medium | High | Temporal split evaluation; periodic retraining (monthly) |
| Modal cold starts slow /estimate | Low | Low | Same container as /classify — already warm with min_containers=2 |

---

## 11. Key Decisions Needed Before Building

1. **Regression vs classification:** This plan assumes regression. Confirm that continuous price output is the desired product behavior (vs "this is a $50-100K vehicle").

2. **Image selection strategy:** Use best N images per vehicle? Random? One per zone? The featurizers support per-image inference but the pricing model should aggregate across all images for a vehicle.

3. **Retraining cadence:** Monthly? Weekly? Triggered by new data volume? This affects whether to invest in automated retraining pipeline now vs later.

4. **Confidence interval display:** Should the API return a range? This is useful but requires either ensemble training or a heteroscedastic loss head.

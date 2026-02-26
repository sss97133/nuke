# YONO Continuation — Read This First

If you're a new Claude session picking this up: **read this entire file before touching anything.**

---

## What YONO Is (The Strategic Why)

Nuke pays $0.0001–$0.004 per image for cloud vision (Gemini Flash / GPT-4o). There are 32 million images pending analysis. That's $3,200–$128,000 to process the backlog. Cloud latency also makes real-time developer-facing classification impractical.

YONO is a locally-trained vehicle image classifier that runs for **free**. Trained on Nuke's own data (91K cached + 884K labeled in Supabase). Runs on CPU in 4ms. The model already exists and works.

But YONO is not just a cost-saver. It's the intelligence that makes the SDK worth paying for.

The developer promise:
```typescript
const result = await nuke.vision.analyze(photoUrl);
// Returns: make, model, year, condition, value estimate, comparable sales
// One photo. Everything we know. Zero manual input.
```

This is "give us the keys, we do the rest."

---

## Current State (as of 2026-02-25)

### Working Right Now
| Component | Status | Notes |
|-----------|--------|-------|
| Phase 5 EfficientNet | ✓ Done | `outputs/phase5_final_20260204_231224/best_model.pt` |
| ONNX export | ✓ Done | `models/yono_make_v1.onnx` — 0.5MB, 4ms CPU |
| `yono.py` wrapper | ✓ Done | `YONOClassifier` — HEIC, URL, batch |
| Photos library scan | ✓ Running | PID in `library_scan/scan.pid` |
| iPhoto overnight cron | ✓ Live | `scripts/iphoto-overnight.sh` at 1am |
| SDK `@nuke1/sdk` | ✓ v1.2.0 | On npm, no vision namespace yet |
| API v1 endpoints | ✓ 15 live | No vision endpoint yet |

### Not Built Yet (In Order)
1. **FastAPI sidecar** (`server.py`) — HTTP wrapper so edge functions can call YONO locally
2. **SQLite scan output** — scan.db alongside scan_results.json for fast queries
3. **Supabase training export** — stream 884K labeled images from DB for retraining
4. **Hierarchical retraining** — 3 tiers: vehicle/family/make (replaces flat 276-class model)
5. **yono-classify edge function** — Supabase function, gates Gemini/GPT calls
6. **analyze-image integration** — YONO as tier-0 before cloud
7. **api-v1-vision endpoint** — public `POST /classify` and `/analyze`
8. **SDK v1.3.0** — `nuke.vision.*` namespace
9. **Contextual model** — image + sale history → price estimate

---

## The Accuracy Problem (Don't Be Alarmed)

Phase 5 is 23% val_acc on 276 classes. This isn't a model failure — it's class imbalance. Porsche has 5,000+ training examples. Some obscure makes have 12. The fix is hierarchical:

- Tier 0: vehicle vs not-vehicle → binary → ~99% achievable
- Tier 1: make family (GM, Ford, Mopar, Import, Euro, Luxury, Exotic, Commercial) → 8 classes → ~90%
- Tier 2: specific make within family → 20-50 classes each → ~65%+

This is how every production vision system is structured. The existing 884K labeled images in Supabase are the training data for all three tiers. Export them with `scripts/export_supabase_training.py` (to be built).

---

## How the Pipeline Connects

```
Photo uploaded (user, auction, dealer, iPhoto)
         ↓
   Apple Vision Swift (free, on-device, 50ms)
   "Is this a vehicle?"
         ↓ yes
   YONO Tier 0: vehicle/nonvehicle (4ms, free)
         ↓ is_vehicle
   YONO Tier 1: make family (4ms, free)
         ↓
   YONO Tier 2: specific make (4ms, free)
         ↓
   If confidence > 0.7: done. Store result.
   If confidence < 0.7: call Gemini Flash ($0.0001)
         ↓
   Result stored in vehicle_images.ai_scan_metadata
   ai_processing_status = 'yono_complete' or 'completed'
```

Right now only Gemini/GPT runs (no YONO gate). Adding the gate is Phase 3.

---

## Quick Commands

```bash
cd /Users/skylar/nuke/yono

# Check scan progress
python3 -c "
import json
d = json.load(open('library_scan/scan_results.json'))
makes = {}
for p in d['photos']: makes[p['make']] = makes.get(p['make'],0)+1
print(f'{d[\"automotive_count\"]} automotive photos')
[print(f'  {m}: {c}') for m,c in sorted(makes.items(), key=lambda x:-x[1])[:10]]
"

# Test YONO inference
source .venv/bin/activate
python -c "
from yono import YONOClassifier
clf = YONOClassifier()
result = clf.predict('.image_cache/<any>.jpg')
print(result)
"

# Re-export ONNX if model updated
source .venv/bin/activate && python scripts/export_onnx.py --verify

# Check if scan is still running
kill -0 $(cat library_scan/scan.pid) && echo "Running" || echo "Dead"
```

---

## Key Architecture Decisions Made

1. **ONNX over TensorFlow.js** — Deno doesn't have mature ONNX runtime. Solution: Python FastAPI sidecar that edge functions proxy to. Production: Modal endpoint.

2. **EfficientNet-B0 over YOLOv8** — Vehicle photos are vehicle-centric (already framed). No localization needed. EfficientNet is faster, simpler, easier to train.

3. **Hierarchical over flat** — 276-class flat model is the wrong architecture. Decompose into 3 tiers. Each tier is a separately trained model.

4. **Continuous training loop** — Every user confirmation/correction = training signal. Nightly retrain. Weekly Modal cloud run if >1K new examples. Model versioned as `yono_make_v1.onnx`, `v2.onnx`, etc.

5. **YONO gates cloud, doesn't replace** — If confidence < threshold, fall through to Gemini. Saves ~70-80% of cloud spend even at current accuracy.

---

## The Business Case

| Metric | Without YONO | With YONO |
|--------|-------------|-----------|
| Cost per image | $0.0001–$0.004 | ~$0.00002 (20% cloud fallback) |
| 32M backlog cost | $3,200–$128,000 | ~$640 |
| Real-time classify | 800ms (cloud) | 4ms (local) |
| API can offer free tier | No | Yes |
| Self-improving | No | Yes (RLHF loop) |

The free tier for the API exists because YONO makes it economically viable. That's what drives developer adoption. That's what builds the moat.

---

## Files to Build Next Session

Priority order:

1. `yono/server.py` — FastAPI sidecar
   ```python
   # POST /classify → {image_url} → {make, confidence, top5, is_vehicle, tier}
   # POST /health → {status: ok, model_version}
   ```

2. `yono/scripts/export_supabase_training.py` — stream labeled data from Supabase
   ```python
   # Queries vehicle_images + vehicles where make IS NOT NULL + ai analysis complete
   # Saves to training-data/supabase_images/ as JSONL batches
   # This gives us 884K labeled examples vs current 91K
   ```

3. `yono/scripts/train_hierarchical.py` — 3-tier training
   ```python
   # train_tier0() → vehicle_vs_nonvehicle.onnx
   # train_tier1() → make_family.onnx
   # train_tier2(family) → make_gm.onnx, make_ford.onnx, etc.
   ```

4. `supabase/functions/yono-classify/index.ts` — edge function
5. Modify `supabase/functions/analyze-image/index.ts` — add YONO gate

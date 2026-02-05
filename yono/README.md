# YONO - You Only Nuke Once

Vehicle image classification models trained on Nuke's 18M+ image dataset.

## What It Does

YONO identifies vehicle makes from photos. Upload a car photo → get "Porsche", "BMW", "Ford", etc.

### Use Cases

| Use Case | Description |
|----------|-------------|
| **Auto-tag uploads** | User uploads photo → YONO identifies make → auto-link to vehicle record |
| **Photo validation** | Listing says "Ford" but photos show Chevy → flag mismatch |
| **Smart search** | "Show me all Porsche photos" without manual tags |
| **Filter junk** | Detect non-vehicle images in uploads |

## Current Status (Feb 2024)

### Trained Models

| Model | Images | Classes | Accuracy | Size |
|-------|--------|---------|----------|------|
| `phase1_warmup` | 25K | 152 makes | 31.3% | 16MB |
| `phase2_expand` | 35K | 192 makes | 29.1% | 16MB |
| `phase3_full` | 50K | 213 makes | 27.3% | 17MB |
| `phase4_refine` | 75K | 246 makes | *training* | 17MB |
| `phase5_final` | 100K | ~300 makes | *pending* | - |

### Training Data

- **100,000 labeled records** exported from Nuke database
- **74,000+ images** downloaded (130GB cached)
- **246+ vehicle makes** represented

## Quick Start

### 1. Setup

```bash
cd /Users/skylar/nuke/yono
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. Run Inference

```bash
# Classify a single image
python scripts/inference.py \
  --model outputs/phase3_full_*/best_model.pt \
  --url "https://example.com/car.jpg"

# Output: [("Porsche", 0.87), ("BMW", 0.05), ("Mercedes-Benz", 0.03), ...]
```

### 3. Train Your Own

```bash
# Download images first (faster training)
python scripts/download_images.py --limit 25000

# Train make classifier
python scripts/train_classifier.py --task make --epochs 20

# Or run continuous multi-phase training
python scripts/train_continuous.py
```

## Architecture

```
EfficientNet-B0 (pretrained on ImageNet)
    ↓
Fine-tuned on Nuke vehicle images
    ↓
Softmax over N vehicle makes
```

- **Base model**: EfficientNet-B0 (5M params, fast inference)
- **Input**: 224x224 RGB image
- **Output**: Probability distribution over vehicle makes

## Directory Structure

```
yono/
├── README.md
├── requirements.txt
├── training.log              # Live training progress
│
├── scripts/
│   ├── train_continuous.py   # Multi-phase training (recommended)
│   ├── train_classifier.py   # Single training run
│   ├── train_overnight.py    # Unattended overnight training
│   ├── download_images.py    # Bulk image downloader
│   └── inference.py          # Run predictions
│
├── data/
│   └── loader.py             # PyTorch dataset classes
│
├── outputs/                  # Trained models
│   ├── phase1_warmup_*/
│   │   ├── best_model.pt     # PyTorch checkpoint
│   │   ├── labels.json       # Class index → make name
│   │   └── history.json      # Training metrics
│   ├── phase2_expand_*/
│   ├── phase3_full_*/
│   └── ...
│
└── .image_cache/             # Downloaded images (130GB+)
```

## Training Pipeline

### Data Export (from Nuke)

```bash
# Export image metadata from Supabase
cd /Users/skylar/nuke
./scripts/export-training-data.sh image_vehicle 100000 1000
```

Creates `/Users/skylar/nuke/training-data/images/*.jsonl` with:
```json
{
  "id": "uuid",
  "image_url": "https://...",
  "make": "Porsche",
  "model": "911",
  "year": 1973,
  "category": "exterior"
}
```

### Training Phases

The `train_continuous.py` script runs 5 progressive phases:

1. **Warmup** (15K images, 10 epochs) - Quick baseline
2. **Expand** (30K images, 15 epochs) - More data
3. **Full** (50K images, 20 epochs) - Full training
4. **Refine** (75K images, 25 epochs) - Fine-tuning
5. **Final** (100K images, 30 epochs) - Best model

Each phase:
- Downloads more images if needed
- Trains with decreasing learning rate
- Saves best checkpoint by validation accuracy

### Monitor Training

```bash
# Live log
tail -f /Users/skylar/nuke/yono/training.log

# Check process
ps aux | grep train_continuous

# See saved models
ls -la outputs/phase*/best_model.pt
```

## Integration (TODO)

### Supabase Edge Function

```typescript
// supabase/functions/classify-vehicle-image/index.ts
import { classifyImage } from './yono-inference.ts'

Deno.serve(async (req) => {
  const { image_url } = await req.json()
  const predictions = await classifyImage(image_url)
  return Response.json({ predictions })
})
```

### Python API

```python
from yono import YONOClassifier

classifier = YONOClassifier("outputs/phase3_full_*/best_model.pt")
results = classifier.predict("https://example.com/car.jpg")
# [("Porsche", 0.92), ("BMW", 0.04), ...]
```

## Roadmap

- [x] Data export pipeline (100K records)
- [x] Training infrastructure (PyTorch + timm)
- [x] Multi-phase continuous training
- [x] Make classifier (246+ classes)
- [ ] ONNX export for fast inference
- [ ] Supabase edge function integration
- [ ] Make+Model classifier (5000+ classes)
- [ ] Angle detection (front/rear/side/3-4)
- [ ] Category detection (exterior/interior/engine/damage)
- [ ] CLIP fine-tuning for embeddings

## Hardware

Trained on:
- **Apple Silicon M-series** (MPS backend)
- ~10 hours for full 5-phase training
- 130GB disk for image cache

For faster training, use cloud GPU (A100):
```bash
python scripts/train_continuous.py  # ~2 hours on A100
```

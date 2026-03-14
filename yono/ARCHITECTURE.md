# YONO Architecture — Complete Pipeline Reference

> **YONO = You Only Nuke Once.** Zero-cost vehicle image intelligence.
> A photo goes in. Make, model, year, condition, value, comps come out. No cloud API bill.

Last updated: 2026-03-09

---

## 1. System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                         DATA SOURCES                              │
│                                                                    │
│  vehicle_images (876K+ rows)           auction_comments (364K)     │
│    └─ image_url (public storage URL)     └─ comment_text           │
│    └─ vehicle_id ──FK──┐                 └─ vehicle_id ──FK──┐     │
│                        │                                     │     │
│                    vehicles (812K+)                           │     │
│                      ├─ make, model, year                    │     │
│                      ├─ sale_price, description              │     │
│                      ├─ vin, mileage, auction_source         │     │
│                      └───────────────────────────────────────┘     │
└───────────┬─────────────────────────────────┬────────────────────┘
            │                                 │
            │  VISION TRACK                   │  LLM TRACK
            ▼                                 ▼
┌─────────────────────────┐     ┌──────────────────────────────────┐
│ modal_train.py           │     │ generate_rich_training_data.py    │
│ EfficientNet-B0          │     │ 7 categories, 14K+ examples      │
│ A100 GPU, 500K images    │     │ Queries vehicles + comments       │
│ Streams from Supabase    │     │ Template-based, no LLM API cost  │
│ ~24h per run             │     │                                  │
└───────────┬─────────────┘     └──────────────┬───────────────────┘
            │                                   │
            │                                   ▼
            │                        ┌──────────────────────────────┐
            │                        │ modal_nuke_agent_train.py     │
            │                        │ Qwen2.5-7B + QLoRA            │
            │                        │ A100 GPU, 4-bit quantized     │
            │                        │ ~25h per run                  │
            │                        └──────────────┬───────────────┘
            │                                       │
            ▼                                       ▼
┌─────────────────────────┐     ┌──────────────────────────────────┐
│ Modal Volume: /data/     │     │ Modal Volume: /data/              │
│  models/                 │     │  nuke-agent-runs/{id}/final/      │
│   ├─ yono_make_v1.onnx   │     │   ├─ adapter_config.json          │
│   ├─ hier_family.onnx    │     │   ├─ adapter_model.safetensors    │
│   ├─ hier_german.onnx    │     │   └─ tokenizer files              │
│   └─ yono_labels.json    │     │                                   │
└───────────┬─────────────┘     └──────────────┬───────────────────┘
            │                                   │
            ▼                                   ▼
┌─────────────────────────┐     ┌──────────────────────────────────┐
│ modal_serve.py           │     │ modal_serve_llm.py                │
│ CPU inference            │     │ T4 GPU inference                  │
│ /classify (ONNX, 50ms)  │     │ /chat (Qwen+LoRA, ~5s)           │
│ /analyze (Florence-2)    │     │ Loads latest adapter from volume  │
│ min_containers=2         │     │ min_containers=0 (scale to zero)  │
└───────────┬─────────────┘     └──────────────┬───────────────────┘
            │                                   │
            └──────────────┬────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│              SUPABASE EDGE FUNCTIONS (proxy layer)                │
│                                                                    │
│  yono-classify/index.ts   → POST Modal /classify                  │
│  yono-analyze/index.ts    → POST Modal /analyze + DB auto-write   │
│  api-v1-vision/index.ts   → Public API: /classify /analyze /batch │
│                              Auth: JWT, API key (nk_live_*)        │
│                              Runs /classify + /analyze in parallel │
│                              Optional: comps lookup via api-v1-comps│
└───────────────────────────────────┬──────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────┐
│                    SDK / Consumer                                  │
│                                                                    │
│  nuke.vision.analyze(photoUrl)                                    │
│  → { make, confidence, condition_score, damage_flags,             │
│       vehicle_zone, modification_flags, comps, cost_usd: 0 }     │
└──────────────────────────────────────────────────────────────────┘

         ┌───────────────────────────────────────┐
         │         modal_continuous.py            │
         │  Cron: Sunday 2am UTC                  │
         │  Checks for new data → triggers runs   │
         └───────────────────────────────────────┘
```

---

## 2. The Journey of a Single Image Through Vision Training

This traces one image from its URL in Supabase to a weight update inside EfficientNet-B0.

**File:** `yono/modal_train.py` — runs on Modal A100, 24h timeout

### 2a. Data Fetch

The training function connects to Supabase and fetches image records with vehicle metadata:

```python
# modal_train.py:85-88
supabase_url = os.environ["SUPABASE_URL"]
supabase_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
supabase = create_client(supabase_url, supabase_key)
```

```python
# modal_train.py:98-121 — paginated fetch
response = supabase.table("vehicle_images").select(
    "id, image_url, vehicles!vehicle_images_vehicle_id_fkey(make, model, year)"
).range(offset, offset + page_size - 1).execute()
```

**What this means:**
- Fetches from `vehicle_images` table
- Joins to `vehicles` table via the FK constraint `vehicle_images.vehicle_id → vehicles.id`
- Selects: image URL + the vehicle's make, model, year
- Pagination: 1,000 rows per page (Supabase REST API hard limit)
- Continues until `limit` records (default 1M) or data exhausted

**Filtering** (line 106-114): Each record must have:
- A `vehicles` row (the join didn't produce null)
- A non-null `make` on that vehicle
- A non-null `image_url`

Records missing any of these are silently skipped. No filter on `ai_processing_status` — the vision model trains on ALL labeled images regardless of their analysis state.

### 2b. Label Assignment — How "Porsche" Becomes Integer 47

```python
# modal_train.py:126-136
make_counts = Counter(r["make"] for r in all_records)
valid_makes = {m for m, c in make_counts.items() if c >= 20}  # min_samples_per_class
filtered_records = [r for r in all_records if r["make"] in valid_makes]
sorted_makes = sorted(valid_makes)                # Alphabetical
label_to_idx = {m: i for i, m in enumerate(sorted_makes)}  # {"Abarth": 0, "AC": 1, ...}
idx_to_label = {i: m for m, i in label_to_idx.items()}
```

**Rules:**
- Any make with fewer than 20 images is dropped entirely
- Remaining makes are sorted alphabetically
- Each gets a sequential integer: 0, 1, 2, ...
- Saved to `/data/runs/{datetime}/labels.json` as `{0: "Abarth", 1: "AC", ...}`

The last run had **276 classes** with 91K images. The current run (500K images) will likely have more classes since rare makes cross the 20-sample threshold.

### 2c. Image Download — URL → Bytes → PIL

```python
# modal_train.py:176-191 — StreamingImageDataset.__getitem__()
url = self.records[idx]["url"]
try:
    with urllib.request.urlopen(url, timeout=10) as response:
        img_data = response.read()
    img = Image.open(io.BytesIO(img_data)).convert("RGB")
    tensor = self.transform(img)
except Exception:
    tensor = torch.zeros(3, 224, 224)  # Black placeholder
label = self.label_to_idx[self.records[idx]["make"]]
return tensor, label
```

**Key details:**
- Images are fetched live from their URLs on every access (no disk cache)
- Timeout: 10 seconds per image
- Always converted to RGB (handles RGBA PNGs, grayscale, CMYK)
- On ANY error (timeout, 404, corrupt JPEG, etc.): returns a **black tensor** (all zeros)
  - The label is still attached — so the model occasionally trains on "black = Porsche"
  - At 500K images, a few hundred failures are noise; the model learns to ignore them

### 2d. Pixel Transforms — The Exact Math on Each Pixel

**Training transforms** (modal_train.py:150-156):
```
Step 1: RandomResizedCrop(224)
  - Pick random scale: 8% to 100% of image area
  - Pick random aspect ratio: 3/4 to 4/3
  - Crop that rectangle, resize to 224×224 with bilinear interpolation
  - Effect: forces model to recognize vehicles at different scales and framings

Step 2: RandomHorizontalFlip()
  - 50% chance: mirror the image left↔right
  - Effect: car facing left ≡ car facing right (vehicles are symmetric)

Step 3: ColorJitter(brightness=0.3, contrast=0.3, saturation=0.3)
  - Randomly adjust each ±30%
  - Effect: resilient to lighting conditions (garage vs outdoor vs auction stage)

Step 4: ToTensor()
  - uint8 [0, 255] → float32 [0.0, 1.0]
  - Rearrange: (H, W, 3) → (3, H, W)

Step 5: Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
  - Per-channel: pixel = (pixel - mean) / std
  - These are ImageNet statistics (the standard for transfer learning)
  - After normalization: values roughly in [-2.5, 2.5]
```

**Validation transforms** (modal_train.py:158-163):
```
Resize(256) → CenterCrop(224) → ToTensor() → Normalize(μ, σ)
No randomness. Every val image processed identically.
```

**Final tensor shape:** `(3, 224, 224)` float32, ImageNet-normalized.

### 2e. Batching

```python
# modal_train.py:213-215
train_loader = DataLoader(
    train_dataset, batch_size=64, shuffle=True,
    num_workers=8, pin_memory=True
)
```

- 8 worker processes fetch+transform images in parallel
- `pin_memory=True`: copies tensors to CUDA-pinned memory for faster GPU transfer
- Batch tensor shape: `(64, 3, 224, 224)` — 64 images, moved to GPU

### 2f. Forward Pass — Through EfficientNet-B0

```python
# modal_train.py:218-219
model = timm.create_model("efficientnet_b0", pretrained=True, num_classes=num_classes)
model = model.to(device)  # Move to A100 GPU
```

**Architecture traversal:**
```
Input: (64, 3, 224, 224)

Stem:
  Conv2d(3→32, kernel=3×3, stride=2, padding=1) → BatchNorm → Swish
  Output: (64, 32, 112, 112)

16 MBConv Blocks (Mobile Inverted Bottleneck):
  Each block: Expand → Depthwise Conv → Squeeze-Excite → Project
  Key specs:
    Block 1:    32→16,  kernel=3, stride=1, expand=1
    Block 2-3:  16→24,  kernel=3, stride=2, expand=6
    Block 4-5:  24→40,  kernel=5, stride=2, expand=6
    Block 6-8:  40→80,  kernel=3, stride=2, expand=6
    Block 9-11: 80→112, kernel=5, stride=1, expand=6
    Block 12-16: 112→192→320, kernel=5/3, stride=2, expand=6

Head:
  Conv2d(320→1280, kernel=1×1) → BatchNorm → Swish
  AdaptiveAvgPool2d → (64, 1280)     # Global average: spatial→vector
  Dropout(0.2)
  Linear(1280→num_classes)            # Final classification layer

Output: (64, num_classes) raw logits
```

**Total parameters:** ~5.3M (tiny by modern standards — this is why it's fast)
**Pretrained:** ImageNet weights. Only the final Linear layer starts random; all feature layers transfer knowledge about edges, textures, shapes.

### 2g. Loss — CrossEntropyLoss

```python
# modal_train.py:235
criterion = nn.CrossEntropyLoss()

# In training loop:
with torch.amp.autocast(device_type="cuda"):  # FP16 forward pass
    outputs = model(images)                    # (64, num_classes) logits
    loss = criterion(outputs, labels)          # scalar
```

**Math:**
```
loss = -log(softmax(logits[i, correct_class]))

If logits = [0.2, 4.1, -1.3, ...] and correct_class = 1:
  softmax = [0.02, 0.87, 0.005, ...]
  loss = -log(0.87) = 0.14  (low loss — model is confident and correct)

If logits = [4.1, 0.2, -1.3, ...] and correct_class = 1:
  softmax = [0.87, 0.02, 0.005, ...]
  loss = -log(0.02) = 3.91  (high loss — model is wrong)
```

The loss is averaged across all 64 images in the batch.

### 2h. Backward Pass + Optimizer

```python
# modal_train.py:263-266
scaler.scale(loss).backward()     # Compute gradients (∂loss/∂weight for every parameter)
scaler.step(optimizer)             # Update weights
scaler.update()                    # Adjust FP16 loss scaling
optimizer.zero_grad()              # Clear gradients for next batch
```

**Optimizer** (line 236):
```python
optimizer = optim.AdamW(model.parameters(), lr=1e-4, weight_decay=1e-4)
```
- AdamW: Adam with decoupled weight decay
- Learning rate: 1e-4 (0.0001)
- Weight decay: 1e-4 (gentle L2 regularization)

**Update rule per parameter w:**
```
m = β1*m + (1-β1)*∂loss/∂w          # Momentum (β1=0.9)
v = β2*v + (1-β2)*(∂loss/∂w)²       # Variance (β2=0.999)
w = w - lr * m/(√v + 1e-8) - λ*w    # AdamW update + weight decay
```

**Scheduler** (line 237):
```python
scheduler = optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=30)
# Called once per epoch:
# lr(epoch) = lr_min + 0.5 * (lr_max - lr_min) * (1 + cos(π * epoch / 30))
# Epoch 0: lr = 1e-4, Epoch 15: lr ≈ 5e-5, Epoch 30: lr → 0
```

**Mixed precision** (line 240):
```python
scaler = torch.amp.GradScaler()
```
- Forward pass runs in FP16 (half precision) → 2× faster on A100, same accuracy
- Backward pass runs in FP32 for numerical stability
- GradScaler adjusts loss magnitude to prevent FP16 underflow

### 2i. Checkpoint — What Gets Saved

```python
# modal_train.py:323-334
if val_acc > best_val_acc:
    best_val_acc = val_acc
    torch.save({
        "epoch": epoch,
        "model_state_dict": model.state_dict(),      # All 5.3M parameters as float32
        "optimizer_state_dict": optimizer.state_dict(), # Adam m,v buffers
        "val_acc": val_acc,
        "num_classes": num_classes,
    }, f"{output_dir}/best_model.pt")
```

**Saved to Modal Volume:**
```
/data/runs/{YYYYMMDD_HHMMSS}/
├── best_model.pt     # ~21MB (5.3M params × 4 bytes/float32)
├── latest.pt         # Latest epoch (even if not best)
├── config.json       # {"batch_size": 64, "epochs": 30, "learning_rate": 0.0001, ...}
├── labels.json       # {"0": "Abarth", "1": "AC", ..., "275": "Volvo"}
└── history.json      # [{epoch: 0, train_loss: 2.3, val_acc: 0.12}, ...]
```

### 2j. ONNX Export — PyTorch → Portable Inference

```python
# scripts/export_onnx.py:67-105
dummy = torch.randn(1, 3, 224, 224)
torch.onnx.export(
    model, dummy, "yono_make_v1.onnx",
    export_params=True,              # Weights embedded in the file
    opset_version=17,                # ONNX IR version (compat with ORT 1.12+)
    input_names=["image"],
    output_names=["logits"],
    dynamic_axes={
        "image": {0: "batch_size"},  # Batch dimension is variable
        "logits": {0: "batch_size"},
    },
)
```

**Result:** `yono_make_v1.onnx` — 17.9MB single file
- Contains all weights + computation graph
- No Python/PyTorch dependency at inference time
- 4ms inference on CPU via ONNX Runtime
- Works on any platform: macOS, Linux, Windows, iOS, Android, WASM

---

## 3. The Journey of a Vehicle Record Through LLM Training

This traces one vehicle from the `vehicles` table through training data generation, tokenization, and QLoRA fine-tuning of Qwen2.5-7B.

### 3a. Data Fetch — What the Generator Queries

**File:** `scripts/generate_rich_training_data.py`

```python
# generate_rich_training_data.py:96-140 — DataLoader class
def vehicles(self, limit=50000):
    response = self.sb.table("vehicles").select(
        "id, year, make, model, sale_price, description, auction_source, "
        "vin, mileage, engine, transmission, exterior_color, interior_color, ..."
    ).gt("sale_price", 1000)          # Exclude junk ($1 listings, free giveaways)
     .not_.is_("make", "null")
     .not_.is_("year", "null")
     .not_.is_("model", "null")
     .not_.is_("description", "null")  # Must have a description to generate from
     .range(offset, offset + 999)      # 1000 rows per page
     .execute()
```

**Post-fetch filters** (lines 158-168):
```python
# Remove garbage:
if len(v.get("description", "")) < 100:          continue  # Too short to learn from
if any(w in make_lower for w in ["acrylic", "sculpture", "model by", "canvas"]):
    continue  # Art/models, not vehicles
if year < 1900 or year > 2026:                    continue  # Invalid years
```

**Auction comments query** (lines 180-195):
```python
response = self.sb.table("auction_comments").select(
    "comment_text, author_username, posted_at"
).eq("vehicle_id", vehicle_id)
 .neq("is_seller", "True")           # IMPORTANT: is_seller is STRING not boolean
 .order("posted_at", desc=False)
 .limit(20)
```

**Note:** The `is_seller` column stores `"True"`/`"False"` as strings, not booleans. Using `.eq("is_seller", False)` returns 0 results. This was a bug fixed during this session.

### 3b. Data Grouping — Y/M/M Clustering

```python
# generate_rich_training_data.py:142-155
def ymm_groups(self):
    groups = defaultdict(list)
    for v in self._vehicles_cache:
        key = f"{v['year']}_{v['make']}_{v['model']}"
        groups[key].append(v)
    return groups
```

Each group contains all vehicles with the same Year/Make/Model combination. Example:
- `"1972_Porsche_911"` → [vehicle_1, vehicle_2, vehicle_3, ...]
- Groups with 3+ vehicles enable comparable analysis
- Groups with 1 vehicle still generate deep_analysis and condition examples

### 3c. Template-Based Generation — 7 Categories

Each category queries specific data and fills structured answer templates:

#### Category 1: Deep Vehicle Analysis (~5K examples)

**Source:** Individual vehicles with rich descriptions + sale prices
**Question templates:** "Analyze this {year} {make} {model}", "Tell me about this {year} {make} {model} that sold on {source}"
**Answer structure:**
```
Year Significance: Why this year matters for this model
Key Specs: Engine, transmission, mileage from DB fields
Market Position: Price tier (budget/entry/mid/high/elite), auction source
Description Analysis: Extracted from first 500 chars of listing description
Comparable Context: If Y/M/M group has >1 vehicle, mentions price range
```

#### Category 2: Comparable Market Analysis (~4K examples)

**Source:** Y/M/M groups with 3+ vehicles
**Question:** "What are comparable sales for {year} {make} {model}?"
**Answer:** Lists each vehicle in the group with price, source, mileage, then analyzes why prices differ (condition, mileage, auction platform).

#### Category 3: Modification/Conflict Detection (~16 examples)

**Source:** Vehicles where VIN-decoded data conflicts with listing claims
**Answer:** Multi-step reasoning: What does VIN say? What does listing claim? Is this a common mod? How does it affect value?

#### Category 4: Condition Assessment (~2.2K examples)

**Source:** Vehicles with descriptions containing condition keywords
**Answer:** Extracts condition signals, maps to taxonomy, scores condition, explains reasoning.

#### Category 5: Upgrade Analysis (~3.5K examples)

**Source:** Vehicles in the entry/mid price tiers with comparable higher-tier examples
**Answer:** "What would it take" to upgrade: common issues for this Y/M/M, typical restoration costs, expected value after improvements.

#### Category 6: Auction Comment Intelligence (~326 examples)

**Source:** Vehicles with 5+ non-seller auction comments
**Answer:** Analyzes expert commentary, extracts condition signals, modification flags, market sentiment.

#### Category 7: Platform Architecture (~17 examples)

**Source:** Hard-coded knowledge about Nuke platform internals
**Examples:** Edge function architecture, pipeline debugging, data quality investigation.

### 3d. JSONL Format

Every training example is a 3-message chat:

```json
{
  "messages": [
    {
      "role": "system",
      "content": "You are the Nuke vehicle data agent. Expert in collector vehicles..."
    },
    {
      "role": "user",
      "content": "Analyze this 1972 Porsche 911S Targa. Sold on BaT for $185,000. 89K miles."
    },
    {
      "role": "assistant",
      "content": "The 1972 911S Targa is a significant year — last of the 2.4L naturally aspirated S cars before the Carrera RS arrived in '73...\n\nMarket position: At $185,000, this sits in the 'high' tier...\n\nComparables from BaT 2024-2025:\n- 1973 911S Targa, 67K mi: $198K\n- 1971 911S Targa, 91K mi: $142K..."
    }
  ],
  "category": "deep_analysis"
}
```

**Current stats:** 14,428 training examples, 761 validation. Average response: 1,390 characters (was 447 in the previous shallow version).

### 3e. Upload to Modal

```bash
modal volume put yono-data training-data/nuke-agent/train.jsonl nuke-agent/train.jsonl --force
modal volume put yono-data training-data/nuke-agent/val.jsonl nuke-agent/val.jsonl --force
```

Files land at `/data/nuke-agent/train.jsonl` and `/data/nuke-agent/val.jsonl` on the Modal persistent volume.

### 3f. Tokenization — Chat Template → Token IDs

**File:** `yono/modal_nuke_agent_train.py`

```python
# modal_nuke_agent_train.py:153-161
def format_chat(example):
    text = tokenizer.apply_chat_template(
        example["messages"],
        tokenize=False,
        add_generation_prompt=False,
    )
    return {"text": text}
```

**What `apply_chat_template` produces for Qwen2.5:**
```
<|im_start|>system
You are the Nuke vehicle data agent...<|im_end|>
<|im_start|>user
Analyze this 1972 Porsche 911S Targa...<|im_end|>
<|im_start|>assistant
The 1972 911S Targa is a significant year...<|im_end|>
```

```python
# modal_nuke_agent_train.py:165-173
def tokenize(example):
    result = tokenizer(
        example["text"],
        truncation=True,
        max_length=4096,        # Max sequence length
        padding="max_length",   # Pad shorter sequences to 4096
    )
    result["labels"] = result["input_ids"].copy()  # Autoregressive: predict next token
    return result
```

**After tokenization:**
- `input_ids`: `[151644, 8948, 198, ...]` — 4096 integers (token IDs)
- `attention_mask`: `[1, 1, 1, ..., 0, 0, 0]` — 1 for real tokens, 0 for padding
- `labels`: identical to `input_ids` — the model learns to predict each token from the previous ones

**Training objective:** Given tokens 1..N, predict token N+1. The loss is computed only on non-padding positions.

### 3g. Model Loading — 4-Bit Quantization

```python
# modal_nuke_agent_train.py:101-118
bnb_config = BitsAndBytesConfig(
    load_in_4bit=True,                     # Each weight stored as 4 bits
    bnb_4bit_quant_type="nf4",             # NormalFloat4 quantization
    bnb_4bit_compute_dtype=torch.bfloat16, # Dequantize to bf16 for computation
    bnb_4bit_use_double_quant=True,        # Quantize the quantization constants
)

model = AutoModelForCausalLM.from_pretrained(
    "Qwen/Qwen2.5-7B-Instruct",
    quantization_config=bnb_config,
    device_map="auto",
    trust_remote_code=True,
)
```

**What NF4 quantization does:**
- Normal 7B model: 7 billion × 2 bytes (FP16) = **14GB VRAM**
- NF4 quantized: 7 billion × 0.5 bytes (4-bit) = **~3.5GB VRAM**
- NF4 uses a non-uniform codebook optimized for normally-distributed weights
- Double quantization: the 8-bit scaling constants get quantized to 4-bit too
- At compute time: weights are dequantized to bfloat16 on-the-fly per layer

### 3h. LoRA Injection — Which Layers Get Adapters

```python
# modal_nuke_agent_train.py:129-139
lora_config = LoraConfig(
    r=64,                          # Rank of the low-rank matrices
    lora_alpha=128,                # Scaling factor
    target_modules=[
        "q_proj", "k_proj", "v_proj", "o_proj",     # All 4 attention projections
        "gate_proj", "up_proj", "down_proj",          # All 3 MLP projections
    ],
    lora_dropout=0.05,
    bias="none",
    task_type="CAUSAL_LM",
)
```

**How LoRA works:**

For each targeted weight matrix W (shape d×d, where d=3584 for Qwen2.5-7B):

```
Original output:  y = W·x              (W is frozen, 4-bit quantized)
LoRA output:      y = W·x + (A·B)·x × (α/r)

Where:
  A = random matrix (d × 64)       ← initialized from normal distribution
  B = zero matrix (64 × d)         ← initialized to zero (so LoRA starts as identity)
  α/r = 128/64 = 2.0               ← scaling factor

Total LoRA params per layer: d×64 + 64×d = 2 × 3584 × 64 = 458,752
```

**Qwen2.5-7B has 28 transformer layers. Per layer: 7 target modules × 458,752 = 3.2M. Total: 28 × 3.2M ≈ 90M trainable parameters.**

Only the A and B matrices train. The original 7B parameters stay frozen in 4-bit.

### 3i. Training Loop

```python
# modal_nuke_agent_train.py:187-210
training_args = TrainingArguments(
    per_device_train_batch_size=2,           # 2 sequences per forward pass
    gradient_accumulation_steps=16,          # Accumulate 16 steps before optimizer update
    # Effective batch size: 2 × 16 = 32 sequences per optimizer step
    learning_rate=2e-4,
    warmup_ratio=0.03,                       # First 3% of steps: LR ramps 0→2e-4
    lr_scheduler_type="cosine",              # Then cosine decay to 0
    num_train_epochs=3,
    bf16=True,                               # bfloat16 training
    gradient_checkpointing=True,             # Recompute activations during backward (saves VRAM)
    optim="paged_adamw_8bit",                # 8-bit Adam optimizer (saves VRAM)
    logging_steps=10,                        # Log loss every 10 steps
    eval_strategy="steps",
    eval_steps=100,                          # Evaluate every 100 steps
    save_strategy="steps",
    save_steps=200,                          # Checkpoint every 200 steps
    save_total_limit=3,                      # Keep only 3 most recent checkpoints
)
```

**Step count math:**
```
14,428 examples ÷ 32 effective batch ÷ 3 epochs = ~451 steps/epoch
451 × 3 = 1,353 total steps
At ~67.5s/step → ~25 hours total
```

**Memory usage on A100-40GB:**
- Model (4-bit): ~3.5GB
- LoRA adapters (bf16): ~0.4GB
- Optimizer states (8-bit Adam): ~0.4GB
- Activations (2 sequences × 4096 tokens × gradient checkpointing): ~15-20GB
- Total: ~25GB of 40GB

### 3j. What Gets Saved

```python
# modal_nuke_agent_train.py:223-225
final_path = f"{output_dir}/final"
trainer.save_model(final_path)         # LoRA adapter only (not full model)
tokenizer.save_pretrained(final_path)  # Tokenizer files for inference
```

```
/data/nuke-agent-runs/{YYYYMMDD_HHMMSS}/
├── final/
│   ├── adapter_config.json            # LoRA hyperparameters (r, alpha, targets)
│   ├── adapter_model.safetensors      # A,B matrices (~360MB)
│   ├── special_tokens_map.json
│   ├── tokenizer.json                 # Full tokenizer vocabulary
│   └── tokenizer_config.json
├── checkpoint-200/                    # Intermediate checkpoints
├── checkpoint-400/
├── checkpoint-600/
└── metadata.json                      # {run_id, loss, runtime, examples, ...}
```

**The LoRA adapter is ~360MB** — it contains only the A,B matrices, not the full 7B model. At inference time, you load the base Qwen2.5-7B model + this adapter.

### 3k. Merge and Export (Optional)

```python
# modal_nuke_agent_train.py:267-299
def merge_and_export(run_id):
    base_model = AutoModelForCausalLM.from_pretrained(
        "Qwen/Qwen2.5-7B-Instruct",
        torch_dtype=torch.bfloat16,
    )
    model = PeftModel.from_pretrained(base_model, run_dir)
    model = model.merge_and_unload()  # W_merged = W_base + (alpha/rank) * A @ B
    model.save_pretrained(output_dir) # Full 14GB merged model
```

**Merge math:** For each LoRA-adapted layer:
```
W_final = W_base + (128/64) × A @ B
        = W_base + 2.0 × (d×64) @ (64×d)
        = W_base + low-rank update
```

After merging, the model is a standard Qwen2.5-7B with no LoRA dependency.

---

## 4. Hierarchical Classification — Tier-1 → Tier-2

**File:** `yono/scripts/train_hierarchical.py`

The flat 276-class classifier achieves ~23% accuracy. The hierarchical approach decomposes this into easier problems.

### Family Taxonomy (8 classes)

```python
MAKE_FAMILIES = {
    "american": ["Chevrolet", "Ford", "Dodge", "Chrysler", "Cadillac", "Lincoln",
                 "Buick", "Pontiac", "Oldsmobile", "Plymouth", "GMC", "Jeep",
                 "Tesla", "Rivian", ...],                          # 35+ makes
    "german":   ["BMW", "Mercedes-Benz", "Porsche", "Audi",
                 "Volkswagen", "Opel", "Maybach", "Smart", "Wiesmann"], # 9 makes
    "british":  ["Jaguar", "Aston Martin", "Bentley", "Rolls-Royce",
                 "McLaren", "Lotus", "MG", "Land Rover", ...],    # 29 makes
    "japanese": ["Toyota", "Honda", "Mazda", "Nissan", "Subaru",
                 "Lexus", "Acura", "Infiniti", ...],              # 13 makes
    "italian":  ["Ferrari", "Lamborghini", "Alfa Romeo", "Maserati",
                 "Fiat", "Lancia", "Pagani", "De Tomaso", ...],   # 14 makes
    "french":   ["Citroën", "Peugeot", "Renault", "Bugatti",
                 "Alpine", "Panhard", "Delahaye", "Talbot"],      # 8 makes
    "swedish":  ["Volvo", "Saab"],                                 # 2 makes
    "other":    [],                                                 # Catch-all
}
```

### Differences from Flat Training

| Aspect | Flat (modal_train.py) | Hierarchical (train_hierarchical.py) |
|--------|----------------------|--------------------------------------|
| Split | 90/10 random | 90/10 **stratified by class** (seed=42) |
| Balancing | Filter <20 samples | **WeightedRandomSampler** (inverse frequency) |
| Label smoothing | None | **0.1** (prevents overconfidence) |
| Augmentation | Basic | + RandomGrayscale(5%) |
| LR (Tier-1) | 1e-4 | **5e-5** (half — less aggressive) |
| LR (Tier-2) | 1e-4 | 1e-4 |
| Batch (Tier-2) | 64 | **32** (smaller families → smaller batches) |

### Inference Cascade

```
Image → preprocess(224×224, ImageNet norm)
  │
  ├─ Tier-1: hier_family.onnx
  │   Input:  (1, 3, 224, 224)
  │   Output: (1, 8) logits → softmax → argmax
  │   Result: family="german", confidence=0.92
  │
  └─ Tier-2: hier_german.onnx (selected by Tier-1 result)
      Input:  same (1, 3, 224, 224) tensor
      Output: (1, 9) logits → softmax → top-5
      Result: [("Porsche", 0.87), ("BMW", 0.05), ("Mercedes-Benz", 0.04), ...]

FALLBACK chain:
  - No Tier-2 model for this family → return family name as make
  - No Tier-1 model → fall back to flat yono_make_v1.onnx (276 classes)
  - No flat model → return {make: null, source: "unavailable"}
```

---

## 5. Vision Analysis — Florence-2 Pipeline

**File:** `yono/modal_serve.py` (lines 205-660)

### Architecture

Florence-2-base (870M params) is a vision-language model. We use only its **image encoder** — no text generation on the happy path.

```
Image URL
  ↓ httpx.AsyncClient.get() (20s timeout)
  ↓ PIL.Image.open().convert("RGB")
  ↓ Florence-2 processor (resize, normalize, pad)
  ↓
Florence-2 Image Encoder (ViT)
  Input:  pixel_values (1, 3, H, W)
  Output: image_features (1, 577, 768)
          577 = 1 CLS token + 576 spatial tokens (24×24 grid)
          768 = hidden dimension
  ↓
  ├─ VisionHead (fine-tuned, 1.7MB safetensors)
  │   Mean-pool: (1, 577, 768) → (1, 768)
  │   Bottleneck: LayerNorm(768) → Linear(768→512) → GELU → Dropout(0.2)
  │   ├─ condition_head:       Linear(512→5)  → argmax+1 → score 1-5
  │   ├─ photo_quality_head:   Linear(512→5)  → argmax+1 → quality 1-5
  │   ├─ interior_quality_head: Linear(512→5) → argmax+1 → 1-5 (or null if not interior)
  │   ├─ damage_head:          Linear(512→7)  → sigmoid → flags where p≥0.4
  │   ├─ mod_head:             Linear(512→8)  → sigmoid → flags where p≥0.4
  │   └─ photo_type_head:      Linear(512→9)  → argmax → type string
  │
  └─ ZoneClassifierHead (2.1MB safetensors, 72.8% val accuracy)
      LayerNorm(768) → Linear(768→512) → GELU → Dropout(0.2)
                     → Linear(512→256) → GELU → Dropout(0.2)
                     → Linear(256→41)  → softmax → zone_code
```

### Damage Flags (7 categories, sigmoid threshold 0.4)

`rust`, `dent`, `crack`, `paint_fade`, `broken_glass`, `missing_parts`, `accident_damage`

### Modification Flags (8 categories, sigmoid threshold 0.4)

`lift_kit`, `lowered`, `aftermarket_wheels`, `roll_cage`, `engine_swap`, `body_kit`, `exhaust_mod`, `suspension_mod`

### Photo Types (9 classes)

`exterior_front`, `exterior_rear`, `exterior_side`, `interior`, `engine`, `wheel`, `detail`, `undercarriage`, `other`

### Zero-Shot Fallback

If the fine-tuned VisionHead isn't available, Florence-2 generates a `<DETAILED_CAPTION>` and we extract features via keyword matching:

```python
# modal_serve.py:554-652
# Caption: "A rusty red 1972 Porsche 911 with faded paint, front view"
damage_flags = [f for f, kws in _DAMAGE_KEYWORDS.items()
                if any(kw in caption for kw in kws)]
# → ["rust", "paint_fade"]
```

This is slower (~1200ms vs ~800ms) and less accurate, but works without any training.

---

## 6. Inference Endpoints

### modal_serve.py — Vision Server (CPU, no GPU)

| Endpoint | Method | Max Batch | Timeout | Latency |
|----------|--------|-----------|---------|---------|
| `/health` | GET | — | — | <1ms |
| `/classify` | POST | 1 | 600s | ~50-100ms |
| `/classify/batch` | POST | 50 | 600s | ~2-5s |
| `/analyze` | POST | 1 | 600s | ~800-1200ms |
| `/analyze/batch` | POST | 20 | 600s | ~15-20s |

**Auth:** Bearer token via `MODAL_SIDECAR_TOKEN` environment variable. `/health` is public.

### modal_serve_llm.py — LLM Chat Server (T4 GPU)

| Endpoint | Method | Timeout | Latency |
|----------|--------|---------|---------|
| `/health` | GET | — | <1ms |
| `/chat` | POST | 120s | ~3-10s |

**Request:**
```json
{
  "messages": [
    {"role": "user", "content": "Analyze a 1972 Porsche 911S Targa, 89K miles, $185K on BaT"}
  ],
  "max_tokens": 2048,
  "temperature": 0.7
}
```

**Response:**
```json
{
  "response": "The 1972 911S Targa is a significant year...",
  "tokens": 342,
  "ms": 4520,
  "tokens_per_second": 75.7,
  "model": "Qwen/Qwen2.5-7B-Instruct",
  "has_lora": true
}
```

**Generation parameters:**
- `temperature`: 0.7 default (set to 0 for deterministic)
- `top_p`: 0.9 (nucleus sampling)
- `repetition_penalty`: 1.1 (mild penalty for repeated tokens)
- System prompt auto-prepended if not present in messages

---

## 7. Edge Function Gating Layer

### yono-classify/index.ts

**Purpose:** Proxy from Supabase → Modal `/classify` with health-check gate.

```
Request arrives at Supabase
  ↓ Ping YONO_SIDECAR_URL/health (45s timeout — covers Modal cold start)
  ├─ Health OK → POST /classify (60s timeout)
  │   ↓ Return {available: true, make, confidence, family, top5, source: "yono"}
  └─ Health FAIL → Return {available: false, reason: "YONO sidecar not running"}
```

**Always returns HTTP 200.** The caller decides whether to fall back to Gemini/GPT-4o. This design means a sidecar outage never breaks the API — it just returns `available: false`.

### api-v1-vision/index.ts

**Purpose:** The consumer-facing API. `nuke.vision.analyze(photoUrl)` hits this.

**Auth:** JWT, service role key, or `X-API-Key: nk_live_*` via `authenticateRequest()`.

**Routes:**
- `GET /api-v1-vision` — Discovery endpoint with model status
- `POST /api-v1-vision/classify` → calls Modal `/classify`
- `POST /api-v1-vision/analyze` → calls Modal `/classify` + `/analyze` **in parallel**, merges results
- `POST /api-v1-vision/batch` → calls Modal `/classify` for up to 100 images in parallel

**The /analyze route is the main deliverable:**
```
SDK call → api-v1-vision/analyze
  ↓ authenticateRequest()
  ↓ Promise.all([
      callYonoClassify(image_url),    // → {make, family, confidence, top5}
      callYonoAnalyze(image_url),     // → {zone, condition, damage, mods}
    ])
  ↓ if include_comps: fetchComps(make) // → api-v1-comps edge function
  ↓ Merge into single response
  ↓ Return {make, confidence, condition_score, vehicle_zone, damage_flags, comps, cost_usd: 0}
```

---

## 8. Continuous Training Cron

**File:** `yono/modal_continuous.py` — deployed on Modal, runs Sunday 2am UTC

### Weekly Cycle

```
Sunday 2am UTC → weekly_training_check()
  │
  ├─ check_for_new_data()
  │   ├─ Vision: count vehicles with make ≠ null
  │   │   Compare to state.last_vision_image_count
  │   │   Threshold: 10,000 new images → trigger training
  │   │
  │   └─ LLM: count lines in /data/nuke-agent/train.jsonl
  │       Compare to state.last_llm_example_count
  │       Threshold: 1,000 new examples → trigger training
  │
  ├─ trigger_vision_training()  [if threshold met]
  │   └─ modal.Function.from_name("yono-training", "train_make_classifier")
  │      .spawn(limit=500000, epochs=30, batch_size=64)
  │      → Fire-and-forget, trains independently on A100
  │
  └─ trigger_llm_training()  [if threshold met]
      └─ modal.Function.from_name("nuke-agent-train", "train_nuke_agent")
         .spawn(epochs=3, batch_size=2, gradient_accumulation=16, max_seq_length=4096)
         → Fire-and-forget, trains independently on A100
```

### Manual Control

```bash
modal run yono/modal_continuous.py --action status       # Full status report
modal run yono/modal_continuous.py --action check        # Check data thresholds
modal run yono/modal_continuous.py --action train-vision  # Force vision training
modal run yono/modal_continuous.py --action train-llm     # Force LLM training
modal run yono/modal_continuous.py --action train-all     # Force both
```

### State Persistence

```json
// /data/continuous/state.json (on Modal volume)
{
  "last_vision_train": "2026-03-09T17:52:00",
  "last_llm_train": "2026-03-09T17:52:53",
  "last_vision_image_count": 245000,
  "last_llm_example_count": 14428
}
```

---

## 9. Database Schema Reference

### Tables Used by YONO

| Table | Rows | Key Columns for YONO | Relationship |
|-------|------|---------------------|--------------|
| `vehicles` | 812K+ | id, year, make, model, sale_price, description, vin, mileage, engine, transmission, exterior_color, interior_color, auction_source | Primary entity |
| `vehicle_images` | 876K+ labeled | id, image_url, vehicle_id, ai_processing_status | FK → vehicles.id |
| `auction_comments` | 364K | vehicle_id, comment_text, author_username, is_seller (string!), posted_at | FK → vehicles.id |

### Key Gotchas

- **`auction_comments.is_seller`** is stored as STRING `"True"`/`"False"`, not boolean. Use `.neq("is_seller", "True")` not `.eq("is_seller", False)`.
- **`vehicle_images.image_url`** may point to expired/moved storage URLs. The training pipeline silently returns a black tensor on fetch failure.
- **`vehicles.make`** is not normalized. "Mercedes-Benz" and "Mercedes" are different values. The hierarchical training normalizes via aliases.

---

## 10. File Map

| File | Purpose | Run Command |
|------|---------|-------------|
| **Training** | | |
| `yono/modal_train.py` | Vision model training on Modal A100 | `modal run yono/modal_train.py --action train --limit 500000` |
| `yono/modal_nuke_agent_train.py` | LLM fine-tuning on Modal A100 | `modal run yono/modal_nuke_agent_train.py` |
| `yono/scripts/train_hierarchical.py` | Hierarchical training (local) | `python yono/scripts/train_hierarchical.py` |
| `scripts/generate_rich_training_data.py` | LLM training data from DB | `dotenvx run -- yono/.venv/bin/python3 scripts/generate_rich_training_data.py` |
| `scripts/export_nuke_agent_data.py` | Original shallow exporter (deprecated) | — |
| **Inference** | | |
| `yono/modal_serve.py` | Vision inference on Modal (CPU) | `modal deploy yono/modal_serve.py` |
| `yono/modal_serve_llm.py` | LLM chat inference on Modal (T4) | `modal deploy yono/modal_serve_llm.py` |
| `yono/yono.py` | Local ONNX classifier | `from yono import YONOClassifier` |
| `yono/server.py` | Local FastAPI sidecar (port 8472) | `./scripts/yono-server-start.sh` |
| **Export** | | |
| `yono/scripts/export_onnx.py` | ONNX export from PyTorch checkpoint | `python yono/scripts/export_onnx.py` |
| **Infrastructure** | | |
| `yono/modal_continuous.py` | Weekly training cron | `modal deploy yono/modal_continuous.py` |
| `yono/scripts/scan_photos_library.py` | iPhoto vehicle scan | `python yono/scripts/scan_photos_library.py` |
| **Edge Functions** | | |
| `supabase/functions/yono-classify/` | Classify proxy → Modal | Auto-deployed |
| `supabase/functions/yono-analyze/` | Analyze proxy → Modal + DB write | Auto-deployed |
| `supabase/functions/api-v1-vision/` | Public vision API (SDK endpoint) | Auto-deployed |
| `supabase/functions/yono-batch-process/` | Batch processor for 32M pending images | Auto-deployed |
| **Models on Volume** | | |
| `/data/models/yono_make_v1.onnx` | Flat classifier (276 classes, 17.9MB) | — |
| `/data/models/hier_family.onnx` | Tier-1 family classifier (8 classes) | — |
| `/data/models/hier_{family}.onnx` | Tier-2 per-family classifiers | — |
| `/data/models/yono_labels.json` | Flat model label index | — |
| `/data/models/hier_labels.json` | Hierarchical label indices | — |
| `/data/models/yono_vision_v2_head.safetensors` | Florence-2 fine-tuned head (1.7MB) | — |
| `/data/models/yono_zone_head.safetensors` | Zone classifier head (2.1MB) | — |
| `/data/nuke-agent-runs/{id}/final/` | LoRA adapter for Qwen2.5-7B | — |

---

## Appendix: The Data Growth Loop

This is how the system gets smarter over time without manual intervention:

```
1. New vehicles enter Supabase (BaT scraper, C&B extractor, FB marketplace, user uploads)
   └─ vehicles + vehicle_images tables grow

2. Sunday 2am: modal_continuous.py wakes up
   ├─ Counts new labeled images → if >10K since last run, spawns vision training
   └─ Counts new training examples → if >1K since last run, spawns LLM training

3. Vision training completes → new ONNX models saved to volume
   └─ Redeploy modal_serve.py to pick up new weights

4. LLM training completes → new LoRA adapter saved to volume
   └─ Redeploy modal_serve_llm.py to pick up new adapter

5. Better models → better API responses → more developers → more vehicles → step 1
```

**Current gap:** LLM training data generation (`generate_rich_training_data.py`) is not yet automated. Someone must re-run it and re-upload to grow the LLM training set. The vision model pulls directly from the growing database, so it's fully automatic.

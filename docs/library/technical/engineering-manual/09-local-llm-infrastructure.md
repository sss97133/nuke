# Chapter 9: Local LLM Infrastructure

## What This Subsystem Does

The local LLM infrastructure provides on-device and cloud-GPU inference for vehicle intelligence tasks. It consists of three layers: local models running on Ollama (M4 Max, 36GB), cloud fine-tuning on Modal (A100 GPUs), and a training data export pipeline that converts Nuke's database into instruction-tuning examples.

The local models serve two purposes:
1. **Zero-cost inference** — overnight reconciliation, continuous enrichment, user-facing interactions
2. **Domain-specialized reasoning** — fine-tuned models that have internalized market patterns from 100K+ vehicle sales

---

## Key Components

### Local Inference (Ollama)

| Component | Path | Purpose |
|-----------|------|---------|
| Ollama server | `/Applications/Ollama.app` | Local inference engine |
| Model storage | `/Volumes/NukePortable/ollama-models/` | External SSD, 2TB |
| Internal backup | `~/.ollama/models/` | 41GB backup on internal storage |
| Shell config | `~/.zshrc` → `OLLAMA_MODELS=...` | Persists SSD path |

### Available Models

| Model | Size | Speed (M4 Max) | Purpose |
|-------|------|----------------|---------|
| `nuke` | 19.9 GB | ~15 tok/s | DeepSeek R1 32B + full Nuke system prompt |
| `deepseek-r1:32b` | 19.9 GB | ~15 tok/s | Raw reasoning, no system prompt |
| `qwen3:30b-a3b` | 18.6 GB | 100+ tok/s | Fast daily work (MoE architecture) |
| `qwen2.5:7b` | 4.7 GB | ~35 tok/s | Light tasks, existing comment mining |
| `nuke-agent` | ~5 GB | ~25 tok/s | Fine-tuned specialist (after training) |

### Modelfiles

| File | Base Model | Purpose |
|------|-----------|---------|
| `yono/Modelfile.nuke` | `deepseek-r1:32b` | Fat system prompt: schema, pipelines, domain knowledge, hard rules |
| `yono/Modelfile.nuke-agent` | GGUF from training | Template for fine-tuned model import |

---

## Cloud Training Pipeline (Modal)

### Architecture

```
Export Data → Modal Volume → Train on A100 → Merge LoRA → Export GGUF → Download → Ollama
```

### Scripts

| Script | Purpose | Cost |
|--------|---------|------|
| `yono/export_nuke_market_intelligence.py` | Export cohort comparisons, gap analyses, comment intelligence | ~$0.50 |
| `yono/export_squarebody_intelligence.py` | Export all 73-91 GM truck data with comments | ~$0.50 |
| `yono/export_nuke_training_data.py` | Export extraction pairs (description → structured) | ~$0.50 |
| `yono/modal_nuke_agent_train.py` | QLoRA fine-tuning on A100 + merge + GGUF export | ~$10-25 |

### Training Pipeline Commands

```bash
# Step 1: Export training data
modal run yono/export_nuke_market_intelligence.py

# Step 2: Full pipeline (train → merge → GGUF)
modal run yono/modal_nuke_agent_train.py --action full --epochs 5

# Step 3: Download GGUF to local
modal volume get yono-data nuke-agent-gguf/<run_id>/nuke-agent-Q4_K_M.gguf /Volumes/NukePortable/ollama-models/

# Step 4: Create Ollama model
ollama create nuke-agent -f yono/Modelfile.nuke-agent
```

### Training Configuration

| Parameter | Default | Notes |
|-----------|---------|-------|
| Base model | `Qwen/Qwen2.5-7B-Instruct` | 7B fits A100 with QLoRA |
| LoRA rank | 64 | Higher = more capacity, more VRAM |
| LoRA alpha | 128 | 2x rank is standard |
| Batch size | 2 | Limited by VRAM with 4-bit quant |
| Gradient accumulation | 16 | Effective batch = 32 |
| Learning rate | 2e-4 | Standard for QLoRA |
| Max sequence length | 4096 | Covers most training examples |
| Quantization | 4-bit NF4 | BitsAndBytes double quantization |

### Telegram Dispatch

All training scripts send progress notifications to Telegram via `claude-notify` infrastructure.

Modal secret `nuke-sidecar-secrets` contains:
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Progress is dispatched:
- On training start (GPU info, config)
- Every 100 training steps (loss, learning rate, epoch, elapsed time)
- On evaluation (eval loss)
- On completion (final loss, runtime, next steps)
- On merge completion
- On GGUF export completion (file size, download command)

---

## Training Data Design

### What Makes Good Training Data

The model should learn **market intelligence patterns**, not JSON extraction.

**Good training examples:**
- "What separates a $15K C10 from an $80K C10?" → Cohort analysis with price drivers
- "Analyze this comment thread" → Extract community intelligence, sentiment, expert claims
- "Here's my 1979 K10 with 8 photos — what should I do?" → Gap analysis + action plan
- "Manual vs automatic on squarebodies?" → Data-backed comparison from real sales

**Bad training examples:**
- "Extract fields from this description" → Haiku does this for $0.001
- "Parse this JSON" → Not intelligence, just formatting

### Training Data Categories

| Category | Count | What It Teaches |
|----------|-------|-----------------|
| Cohort comparisons | ~750 | What drives price within a segment |
| Vehicle gap analyses | ~2,250 | What's holding specific vehicles back |
| Comment intelligence | ~300 | How to read auction comment threads |
| Year-by-year analysis | ~20 | Temporal market patterns |
| Price driver analysis | ~5 | 4x4 premium, manual premium, body style premium |
| User-facing interactions | ~5 | "Here's my truck, what do I do?" pattern |
| Era/segment knowledge | ~5 | Deep domain knowledge by segment |

### Squarebody Specialist Data

Separate training corpus at `/data/nuke-squarebody/`:
- 3,465 individual vehicle profiles (every priced squarebody in the DB)
- 299 comment thread analyses (top-commented trucks)
- 19 year-by-year market analyses (1973-1991)
- 3 comparative price driver studies
- 2 user-facing interaction examples

---

## Cost Analysis

### Training Costs

| Component | Cost | Notes |
|-----------|------|-------|
| Data export | $0.50-1.00 | Modal CPU container, 5-15 min |
| Training (3K examples, 5 epochs) | $10-15 | A100 ~2-3 hours |
| Merge + GGUF export | $2-3 | A100 ~20 min |
| Total per training run | $13-19 | |

### Inference Cost Comparison

| Provider | Cost per vehicle | 100K vehicles | Speed |
|----------|-----------------|---------------|-------|
| Claude Haiku API | ~$0.003 | ~$300 | Instant |
| Modal Qwen 7B (T4) | ~$0.0003 | ~$30 | ~200/min |
| Local Ollama (M4 Max) | $0 | $0 | ~2/min |
| Fine-tuned nuke-agent (local) | $0 | $0 | ~2/min, shorter prompts |

### Break-Even Analysis

Fine-tuning costs ~$15. Local inference is free. The model pays for itself after processing ~5,000 vehicles that would otherwise cost $0.003/each on Haiku ($15 equivalent).

---

## Ollama Server Management

### Starting with SSD Models Path

The Ollama desktop app does not respect shell environment variables. To use the SSD:

```bash
# Kill the app
osascript -e 'quit app "Ollama"'
pkill -f "ollama serve"

# Start manually with SSD path
OLLAMA_MODELS=/Volumes/NukePortable/ollama-models \
  nohup /Applications/Ollama.app/Contents/Resources/ollama serve > /tmp/ollama-ssd.log 2>&1 &
```

### Creating a Model from Modelfile

```bash
cd /Users/skylar/nuke
ollama create nuke -f yono/Modelfile.nuke
ollama run nuke
```

### Background Pull Script

For downloading large models unattended:

```bash
# Script at /tmp/ollama-pull-all.sh
# Pulls models sequentially, creates nuke model, sends Telegram notification
nohup /tmp/ollama-pull-all.sh > /dev/null 2>&1 &
```

---

## Known Problems

1. **Ollama desktop app ignores `OLLAMA_MODELS` env var.** Must start server manually from terminal for SSD usage. If the app auto-launches on login, it will use internal storage.

2. **Telegram dispatch markdown formatting.** Emoji + backticks + asterisks in Markdown can trigger Telegram API 400 errors. The training callback now uses plain text fallback for safety.

3. **Training data export column mismatches.** The Supabase schema evolves faster than the export scripts. Column names must be verified against `information_schema.columns` before each export run. Known renames: `exterior_color` → `color`, `engine` → `engine_type`, `username` → `author_username`, `field_value` → `proposed_value`, `comments_count` → `comment_count`, `highest_bid` → `high_bid`.

4. **Training data NULL handling.** Supabase returns `null` for empty fields, which Python's `.get(key, 0)` does NOT catch (returns `None`, not `0`). Must use `(v.get(key) or 0)` pattern throughout.

5. **GGUF image build is slow first time.** Compiling llama.cpp takes ~10 min on Modal. The image is cached after first build.

6. **Comment intelligence export is slow.** Fetching 20 comments per vehicle via Supabase REST API = ~500ms per vehicle. For 25K vehicles = ~3.5 hours. Needs batch query optimization or direct SQL.

---

## Target Architecture

### Phase 1 (Current)
- Fat system prompt on DeepSeek R1 for interactive use
- QLoRA fine-tuning on Qwen 7B for batch processing
- Manual training runs triggered by user

### Phase 2 (Next)
- Fine-tuned model runs reconciliation on Modal A100, writes through `ingest-observation`
- `agent_tier` column tracks which model produced each observation
- Automated weekly retraining as new data accumulates

### Phase 3 (Future)
- User-facing intake: drop photos + VIN → local model analyzes instantly
- Model serves as first-pass for all new vehicles, Haiku/Sonnet only for edge cases
- Continuous learning loop: new sales data → retrain → better predictions

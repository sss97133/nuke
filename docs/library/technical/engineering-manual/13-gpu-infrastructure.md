# Chapter 9: GPU Infrastructure and Batch LLM Processing

**Status**: Production (Modal), Local (Ollama)
**Last updated**: 2026-03-20
**Author**: Claude Opus 4.6

---

## 9.1 The Problem

Nuke has 235K+ vehicle descriptions that need structured fact extraction. Each description requires an LLM to read 500-6,000 characters of seller testimony and return a JSON object with every factual claim: dates, mileage, owners, shops, locations, work performed, parts, documentation, condition notes, provenance, rarity claims.

At local Ollama speeds (~2/min), that's 117 days. At cloud API prices ($0.15-0.60/M tokens), that's $500-2,000. The solution: self-hosted LLM inference on rented GPUs.

---

## 9.2 The Compute Stack

### Modal (modal.com) — Primary

Modal provides serverless GPU containers. You define a Python class, Modal provisions a container with the GPU, loads your model, and runs your code. You pay per-second of GPU time. No reserved instances, no idle costs (if scaledown is configured).

**How it works in Nuke:**

```
yono/modal_description_discovery.py
  → @app.cls(gpu="T4", max_containers=10)
  → class DescriptionExtractor:
      @modal.enter() → load Qwen2.5-7B once per container
      @modal.method() → extract_batch(vehicles) → JSON results

yono/modal_vllm_serve.py
  → @app.function(gpu="T4") + @modal.asgi_app()
  → FastAPI server serving OpenAI-compatible /v1/chat/completions
  → Used by scripts via --provider modal
```

**The two patterns:**

| Pattern | When to use | Pros | Cons |
|---------|------------|------|------|
| **Standalone worker** (`modal_description_discovery.py`) | Batch jobs, one-off runs | Self-contained, no external dependency, `.map()` parallelism | Each container loads model independently, transformers.generate() is sequential per container |
| **HTTP server** (`modal_vllm_serve.py`) | Multiple callers, interactive use | Shared warm containers, concurrent request handling, any client can call it | Cold start on first request, HTTP overhead, server can scale to zero unexpectedly |

### Ollama — Local Fallback

Free inference on Apple Silicon (M-series) or any machine with sufficient RAM. Qwen2.5:7b runs in ~4GB RAM. Throughput: ~2 extractions/min on M1 Pro.

```bash
ollama pull qwen2.5:7b
dotenvx run -- node scripts/local-description-discovery.mjs --provider ollama --max 1000
```

Use Ollama for: testing prompts, small batches (<100), overnight free runs, development.

### The Multi-Provider Script

`scripts/local-description-discovery.mjs` abstracts all providers behind one interface:

```bash
--provider ollama    # Free, ~2/min, local
--provider modal     # $0.59/hr per T4, ~8-10/min via HTTP server
--provider openai    # gpt-4o-mini, $0.15/M input tokens
--provider gemini    # gemini-2.0-flash-lite, free tier 1000 RPD
--provider groq      # llama-3.1-8b-instant, free tier 14,400 RPD
```

Each provider writes the same schema to `description_discoveries` with `model_used` tracking which model produced the extraction. This enables multi-model corroboration — the same vehicle extracted by different models → agreement increases confidence.

---

## 9.3 Cost Reference

### GPU Pricing (Modal, as of 2026-03)

| GPU | $/hr | VRAM | Use case |
|-----|------|------|----------|
| T4 | $0.59 | 16 GB | 7B models in 4-bit (6GB VRAM), inference |
| A10G | $1.10 | 24 GB | 13B models, training small models |
| A100 40GB | $3.40 | 40 GB | 70B models, serious training |
| H100 | $4.89 | 80 GB | Frontier models, large-scale training |

### Actual Measured Costs (Description Extraction)

| Method | Cost per 1K vehicles | Throughput | Notes |
|--------|---------------------|------------|-------|
| Standalone Modal (transformers) | **$13.70** | ~0.12/s | 10 containers, 20s-50s/vehicle, sequential generate() |
| Modal HTTP server + JS script | **~$1.20** | ~8/min | 2 containers shared, concurrent requests, vLLM-style batching |
| Ollama local | **$0** | ~2/min | Free but slow. Good for overnight runs |
| OpenAI gpt-4o-mini | **~$0.50** | ~30/min | Cheap and fast but external dependency |
| Gemini flash-lite | **$0** | ~15/min | Free tier, 1000 requests/day limit |

**The critical lesson:** The standalone Modal worker using `transformers.generate()` is 10x more expensive than the HTTP server approach because `generate()` processes one sequence at a time. vLLM and similar serving frameworks batch multiple requests and share KV-cache across concurrent generations. Always prefer the HTTP server pattern for batch work unless you need complete isolation.

### Cold Start Costs

| What | Time | Cost impact |
|------|------|-------------|
| Container provision | 5-15s | Negligible |
| Model download (first build only) | 60-120s | One-time, baked into image |
| Model load (4-bit Qwen2.5-7B) | 15-25s | ~$0.003 per container start |
| Container scaledown window | 5 min default | Keeps container warm between batches |

---

## 9.4 The Extraction Pipeline Architecture

```
description_discoveries table
  ├── vehicle_id (FK → vehicles)
  ├── model_used (which LLM: 'qwen2.5:7b', 'claude-haiku-4-5-20251001', etc.)
  ├── raw_extraction (JSONB — the full structured output)
  ├── keys_found (top-level key count)
  ├── total_fields (recursive leaf field count)
  ├── description_length (input size)
  ├── sale_price (for filtering/analysis)
  └── UNIQUE(vehicle_id, model_used) — one extraction per model per vehicle
```

**Candidate selection:**
```sql
SELECT v.id, v.year, v.make, v.model, v.description,
       COALESCE(v.sale_price, v.winning_bid, v.high_bid, v.bat_sold_price) AS sale_price
FROM vehicles v
WHERE v.description IS NOT NULL
  AND length(v.description) >= 100
  AND v.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM description_discoveries dd
    WHERE dd.vehicle_id = v.id AND dd.model_used = $model
  )
LIMIT $batch_size
```

**Warning:** This query is expensive at scale. The `NOT EXISTS` subquery with `length(description) >= 100` requires a sequential scan when the discovery count is low relative to the vehicle count. At 14K discoveries vs 250K candidates, it takes ~23s on the postgres role. Through PostgREST (15s timeout), it will fail. Solutions:
1. Use `execute_sql` RPC (postgres role, 120s timeout) for small batches
2. For large batches (>5K), fetch paginated vehicles + existing discovery IDs separately, dedup client-side

**Batch upsert pattern:**
```
Results collected from GPU workers
  → Chunked into 500-row batches
  → POST to /rest/v1/description_discoveries with Prefer: resolution=merge-duplicates
  → 200ms delay between batches (prevents lock contention)
  → On failure: retry with 50-row sub-batches
```

---

## 9.5 Quality Metrics

From 1,010 extractions via `qwen2.5:7b-modal`:

| Metric | Value |
|--------|-------|
| Parse success rate | 81% (189/1010 parse failures) |
| Avg keys per extraction | 9.3 |
| Avg leaf fields per extraction | 26.5 |
| Avg inference time | 39.9s per vehicle |
| Most common key categories | dates, vehicle specs, provenance, work history, condition |

Parse failures occur when the LLM returns malformed JSON (trailing commas, unclosed brackets, markdown fences despite instructions). The raw response is still stored in `raw_extraction` with `parse_failed: true` for later re-parsing.

**Multi-model comparison** (from `description_discoveries`):

| Model | Count | Avg Fields | Notes |
|-------|-------|------------|-------|
| claude-haiku-4-5 | 9,562 | 30 | Best quality, most expensive |
| qwen2.5:7b (local) | 3,626 | 26 | Free, slow, good quality |
| qwen2.5:7b-modal | 1,010 | 27 | Same model on GPU, faster |
| qwen2.5-7b (HTTP) | 53 | 34 | Via vLLM server |
| llama3.1:8b | 42 | 29 | Comparable to qwen |

Claude Haiku extracts ~15% more fields per description than the 7B open models. Whether those extra fields are signal or noise requires validation against the reference library.

---

## 9.6 Secrets and Configuration

All Modal apps use the `nuke-sidecar-secrets` secret which contains:
- `VITE_SUPABASE_URL` (or `SUPABASE_URL`)
- `SUPABASE_SERVICE_ROLE_KEY`

Set via: `modal secret create nuke-sidecar-secrets VITE_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...`

The local entrypoint reads secrets from the local environment (via `dotenvx run --`), not from Modal secrets. Modal secrets are only available inside the GPU worker containers.

---

## 9.7 Operational Runbook

### Start a batch extraction
```bash
# Test (5 vehicles, dry run)
dotenvx run -- modal run yono/modal_description_discovery.py --limit 5 --dry-run

# Small batch (100 vehicles, writes to DB)
dotenvx run -- modal run yono/modal_description_discovery.py --limit 100

# Large batch (high-value vehicles first)
dotenvx run -- modal run yono/modal_description_discovery.py --limit 5000 --min-price 10000

# Full backlog
dotenvx run -- modal run yono/modal_description_discovery.py --limit 235000
```

### Monitor progress
```bash
# DB count
psql ... -c "SELECT count(*) FROM description_discoveries WHERE model_used='qwen2.5:7b-modal';"

# Modal dashboard
open https://modal.com/apps/sss97133/main

# Log file (if tee'd)
tail -f /tmp/modal-desc-*.log
```

### Deploy/redeploy vLLM server
```bash
modal deploy yono/modal_vllm_serve.py
curl -s https://sss97133--nuke-vllm-serve.modal.run/health
```

### Kill stuck processes
```bash
# Find
ps aux | grep "modal run\|local-description-discovery" | grep -v grep

# Kill
kill $(ps aux | grep local-description-discovery | grep -v grep | awk '{print $2}')
```

### Check extraction quality
```sql
SELECT model_used, count(*) as cnt,
       avg(total_fields)::int as avg_fields,
       avg(keys_found)::int as avg_keys,
       count(*) FILTER (WHERE raw_extraction->>'parse_failed' = 'true') as parse_fails
FROM description_discoveries
GROUP BY model_used ORDER BY cnt DESC;
```

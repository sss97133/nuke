# GPU and LLM Inference Costs

**Last updated**: 2026-03-20
**Source**: Modal billing, measured runs, API pricing pages

---

## Modal GPU Rates

| GPU | $/hr | $/min | VRAM | Fits |
|-----|------|-------|------|------|
| T4 | $0.59 | $0.0098 | 16 GB | Qwen2.5-7B 4-bit (6GB), GLiNER, EfficientNet |
| L4 | $0.73 | $0.012 | 24 GB | 13B 4-bit models |
| A10G | $1.10 | $0.018 | 24 GB | Training small models, 13B inference |
| A100-40 | $3.40 | $0.057 | 40 GB | 70B 4-bit, serious training |
| A100-80 | $4.53 | $0.076 | 80 GB | 70B full precision |
| H100 | $4.89 | $0.082 | 80 GB | Frontier, large-scale |

## Nuke Measured Costs (Description Extraction)

| Run | Vehicles | Wall Time | Containers | Cost | Per 1K |
|-----|----------|-----------|------------|------|--------|
| Standalone test (10) | 10 | 8.8 min | 1 T4 | $0.09 | $8.60 |
| Standalone 1K | 1,000 | 139.3 min | 10 T4 | $13.70 | $13.70 |
| Standalone 5K | 5,000 | (in progress) | 10 T4 | ~$68 est | ~$13.70 |

## Cold Start Budget

| Component | Time | Cost |
|-----------|------|------|
| Container provision | 5-15s | ~$0.001 |
| Qwen2.5-7B 4-bit load | 15-25s | ~$0.003 |
| GLiNER load | 3-5s | ~$0.001 |
| Image build (first time only) | 2-5 min | ~$0.05 |

## API Pricing (for comparison)

| Provider | Model | Input $/M tok | Output $/M tok | Per 1K vehicles est |
|----------|-------|---------------|----------------|---------------------|
| Anthropic | claude-haiku-4-5 | $0.80 | $4.00 | ~$50 |
| OpenAI | gpt-4o-mini | $0.15 | $0.60 | ~$5 |
| Google | gemini-2.0-flash-lite | Free (1K RPD) | Free | $0 (rate-limited) |
| Groq | llama-3.1-8b | Free (14.4K RPD) | Free | $0 (rate-limited) |

## Key Threshold

The **break-even point** between Modal self-hosted and Claude Haiku API:
- Modal T4 standalone: $13.70/1K (poor — sequential generate())
- Modal T4 via HTTP server: ~$1.20/1K (good — concurrent batching)
- Claude Haiku API: ~$50/1K (best quality)

**Rule of thumb:** Use Modal HTTP for volume. Use Claude Haiku for high-value vehicles (sale_price > $50K). Use Ollama for free overnight backfill.

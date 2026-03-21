# Study: Description Extraction Quality Across Models and Scale

**Date**: 2026-03-20
**Dataset**: 14,420 description discoveries across 7 models
**Method**: Same prompt (DISCOVERY_PROMPT v1), same target table, different LLMs

---

## Findings

### 1. Model Quality Varies by ~15%, Not 10x

The assumption was that Claude Haiku would dramatically outperform 7B open models. Reality: Claude extracts ~30 fields/description vs ~26 for Qwen2.5:7b. That's 15% more — meaningful but not transformative. The open models capture the same high-signal facts (year, engine, mileage, ownership history). Claude captures more edge-case details (specific part numbers, nuanced condition language, implicit provenance claims).

| Model | Avg Fields | Avg Keys | Parse Fail Rate |
|-------|-----------|----------|----------------|
| claude-haiku-4-5 | 30 | — | <5% |
| qwen2.5:7b (local) | 26 | — | ~15% |
| qwen2.5:7b-modal | 27 | 9.3 | 19% |
| llama3.1:8b | 29 | — | ~12% |

### 2. Parse Failure Rate Is the Real Quality Gap

Claude almost never returns malformed JSON. Qwen2.5:7b fails to produce valid JSON 15-19% of the time (trailing commas, markdown fences, truncated output). The raw text is stored and could be re-parsed with a cleanup pass, but this represents wasted compute.

**Implication:** A 2-pass strategy may be optimal — extract with the cheap model, then re-extract parse failures with Claude.

### 3. Description Length Correlates with Extraction Richness (Obvious but Quantified)

Descriptions under 500 characters yield ~8-12 fields. Descriptions over 3,000 characters yield ~35-50 fields. The relationship is roughly logarithmic — doubling description length adds ~30% more fields, not 100%.

BaT descriptions average ~1,500 characters. Barrett-Jackson averages ~800. Cars & Bids averages ~2,000. Platform choice determines extraction ceiling.

### 4. Multi-Model Agreement as Confidence Signal

When two models extract the same fact from the same description (e.g., both report mileage as 47,200), confidence in that fact should increase. When they disagree (one says "matching numbers," the other doesn't mention it), the disagreement is itself informative — the claim may be ambiguous in the source text.

**Not yet implemented.** The `description_discoveries` table stores one row per (vehicle_id, model_used). Cross-model comparison requires a join and field-level diff. This is a future capability that the multi-model extraction strategy enables but doesn't yet exploit.

### 5. Cost-Effectiveness Ranking

| Strategy | Cost/10K vehicles | Quality (fields) | Speed | Recommendation |
|----------|-------------------|-------------------|-------|----------------|
| Ollama overnight | $0 | 26 | 83 hours | Best for non-urgent backfill |
| Modal vLLM HTTP | ~$12 | 27 | ~20 hours | Best for medium batches |
| Modal standalone | ~$137 | 27 | ~14 hours | Too expensive — avoid |
| Gemini free tier | $0 | ~25 | 11 hours (rate-limited) | Good for supplemental pass |
| Claude Haiku API | ~$50 | 30 | ~5 hours | Best quality, use for high-value vehicles |

**The optimal strategy:** Run Ollama overnight for free coverage. Use Modal vLLM for large batches when time matters. Reserve Claude Haiku for vehicles with sale_price > $50K where the extra 15% extraction quality justifies the cost.

---

## Open Questions

1. **Do parse failures correlate with description complexity?** Hypothesis: longer, more complex descriptions with nested lists and technical jargon cause more parse failures. Not yet tested.

2. **What's the field overlap between models?** If Claude and Qwen agree on 80% of fields, the remaining 20% from each model adds ~40% more total coverage via union. If they agree on 95%, multi-model adds almost nothing. The answer determines whether multi-model extraction is worth the compute.

3. **Do extracted fields match the reference library?** When the LLM extracts "engine: L48 350", does that match the RPO code library entry for L48? This validation would close the loop between the extraction pipeline and the reference knowledge base.

# Session Handoff — 2026-03-21

## CURRENT SESSION: Unified Multi-LLM Integration

### What's happening
Building unified LLM router (`_shared/llmRouter.ts`) per approved plan at `.claude/plans/mossy-exploring-wall.md`.

### What's complete
- DeepSeek R1 32B + Qwen3 30B-A3B + Kimi K2.5 cloud downloaded to SSD
- `nuke` Ollama model (fat prompt) created and live
- `nuke-agent` fine-tuned model (market intelligence, loss 0.084) merged + GGUF exported + live on Ollama
- Phase 0.3 done (agent_tier, extraction_method, raw_source_ref on vehicle_observations)
- Phase 0.4 done (CHECK constraint fixed)
- Market intelligence training data exported (3,213 examples)
- Squarebody training data exported (3,788 examples)
- 3 PAPERS written (entity resolution, trust scoring, market intelligence patterns)
- ALMANAC platform metrics snapshot
- Engineering Manual Ch.9 (LLM infrastructure)

### What's in progress
- Building `_shared/llmRouter.ts` — unified provider router for all LLM calls
- Plan approved at `.claude/plans/mossy-exploring-wall.md` — 7 phases, 14 steps

### What's next (in order)
1. Finish `_shared/llmRouter.ts`
2. Make `agentTiers.ts` a backward-compat shim
3. Migration: agent_model + agent_cost_cents on vehicle_observations
4. `llm_cost_tracking` table
5. Update `ingest-observation` for provenance fields
6. Migrate edge functions one by one
7. `scripts/overnight-enrichment.mjs`

### Key files
- Plan: `.claude/plans/mossy-exploring-wall.md`
- Router: `supabase/functions/_shared/llmRouter.ts` (NEW)
- Existing: `supabase/functions/_shared/agentTiers.ts` (381 lines, keep as shim)
- Training: `yono/modal_nuke_agent_train.py`, `yono/export_*.py`
- Models: `/Volumes/NukePortable/ollama-models/` (nuke, nuke-agent, deepseek-r1, qwen3, kimi-k2.5)

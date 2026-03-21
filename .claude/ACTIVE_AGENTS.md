# Active Agents

*Register yourself when starting. Remove yourself when done.*
*Format: `HH:MM | AGENT-NAME | task description | files/areas touched`*

---

08:15 | OVERNIGHT-STREAMS | 5 background streams running:
  - Stream A (snapshots PID 15389): mass-extract-snapshots.mjs (regex, no LLM)
  - Stream B (Modal mining PID 29330): mine-comments-for-library.mjs --provider modal (500 groups)
  - Stream C (Modal extraction PID 29404): local-description-discovery.mjs --provider modal (10K vehicles)
  - Stream C2 (Ollama extraction PID 29507): local-description-discovery.mjs --provider ollama (5K vehicles, free)
  - Modal vLLM: https://sss97133--nuke-vllm-serve.modal.run (2x T4 containers, $0.59/hr each)
  Post-processing: Run `dotenvx run -- bash scripts/overnight-run.sh --post-only` after streams complete

20:XX | MODAL-CONSOLIDATION | DONE — modal_description_discovery.py built + tested (10 rows written) | yono/modal_description_discovery.py, TOOLS.md
09:05 | OVERNIGHT-OPS | DONE — Album intake running unattended (PID 34560, 3,194 iphoto images so far). Photo ingest MVP deployed (MCP + CLI).
09:00 | UNIVERSAL-EXTRACTOR | AI extraction pipeline: snapshot-to-markdown bridge + Haiku fallback extractor | scripts/snapshot-to-markdown.mjs, supabase/functions/batch-extract-snapshots/index.ts, scripts/mass-extract-snapshots.mjs
  - BJ markdown bridge running in background (PID 38616)
  - batch-extract-snapshots deployed with AI fallback mode
09:20 | LOCAL-LLM-SETUP | Downloading DeepSeek R1 32B + Qwen3 30B-A3B to SSD, built Modelfile + Modal fine-tuning pipeline | yono/Modelfile.nuke, yono/Modelfile.nuke-agent, yono/export_nuke_training_data.py, yono/modal_nuke_agent_train.py
Fri Mar 20 17:31:17 PDT 2026
17:31 | MCP-ONBOARDING | Implementing user onboarding + account linking (5 MCP tools, migration, both servers) | supabase/functions/mcp-connector/index.ts, mcp-server/src/index.ts, DB migration

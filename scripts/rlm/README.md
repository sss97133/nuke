# RLM Wrapper for Ralph

This wrapper implements a lightweight Recursive Language Model (RLM) workflow to preprocess long-context documents, generate a distilled prompt, and run Ralph with that prompt.

## Quick Start

```bash
./scripts/rlm/ralph_wrapper.sh --project-dir /path/to/ralph/project
```

## Options

- `--project-dir <path>`: Ralph project directory (default: current directory)
- `--config <path>`: Config file (default: `scripts/rlm/rlm.config.json`)
- `--output <path>`: Output prompt path (default: `scripts/rlm/rlm_context.md`)
- `--base-prompt <path>`: Base prompt file (default: `<project-dir>/PROMPT.md`)
- `--goal "<text>"`: Override summarization goal
- `--dry-run`: Build context but skip Claude calls

## What It Does

1. Builds a long-context string from configured files.
2. Runs recursive summarization with Claude.
3. Writes `rlm_context.md` containing:
   - Base prompt (if provided)
   - `RLM_CONTEXT` summary
   - `RLM_INPUT_FILES` list
4. Starts Ralph using `ralph --prompt rlm_context.md`.

## Notes

- Requires `claude` CLI in PATH.
- Uses `npx tsx` to run TypeScript scripts.
- Logs sub-call metadata to `scripts/rlm/rlm_calls.jsonl`.

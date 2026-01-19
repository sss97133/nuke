#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PROJECT_DIR="$PWD"
CONFIG_PATH="$SCRIPT_DIR/rlm.config.json"
OUTPUT_PATH="$SCRIPT_DIR/rlm_context.md"
GOAL=""
BASE_PROMPT=""
DRY_RUN="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-dir)
      PROJECT_DIR="$2"
      shift 2
      ;;
    --config)
      CONFIG_PATH="$2"
      shift 2
      ;;
    --output)
      OUTPUT_PATH="$2"
      shift 2
      ;;
    --goal)
      GOAL="$2"
      shift 2
      ;;
    --base-prompt)
      BASE_PROMPT="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN="true"
      shift 1
      ;;
    *)
      echo "Unknown argument: $1"
      exit 1
      ;;
  esac
done

if ! command -v ralph >/dev/null 2>&1; then
  echo "ralph command not found in PATH."
  exit 1
fi

if ! command -v claude >/dev/null 2>&1; then
  echo "claude CLI not found in PATH."
  exit 1
fi

if [[ -z "$BASE_PROMPT" ]]; then
  if [[ -f "$PROJECT_DIR/PROMPT.md" ]]; then
    BASE_PROMPT="$PROJECT_DIR/PROMPT.md"
  fi
fi

CMD=(npx tsx "$SCRIPT_DIR/rlm_cli.ts" --config "$CONFIG_PATH" --project-root "$PROJECT_DIR" --output "$OUTPUT_PATH")
if [[ -n "$GOAL" ]]; then
  CMD+=(--goal "$GOAL")
fi
if [[ -n "$BASE_PROMPT" ]]; then
  CMD+=(--base-prompt "$BASE_PROMPT")
fi
if [[ "$DRY_RUN" == "true" ]]; then
  CMD+=(--dry-run)
fi

echo "Running RLM preprocessing..."
"${CMD[@]}"

echo "Starting Ralph with RLM context..."
cd "$PROJECT_DIR"
ralph --prompt "$OUTPUT_PATH"

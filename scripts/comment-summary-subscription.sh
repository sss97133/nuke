#!/bin/bash
# Comment summaries from the owner's Claude subscription, for when the API credit is spent.
#
#   dotenvx run -- scripts/comment-summary-subscription.sh [max_lots]     (default 20 lots)
#   FORCE=1 dotenvx run -- scripts/comment-summary-subscription.sh 1      (skip the credit check; a test)
#
# It first asks batch-comment-discovery for one summary the normal way. If the API answers, the credit is still
# good and this script stops: the 10-minute schedule is doing the work. If the API refuses for billing or auth,
# it asks the function for the owed lots' prompts ("prepare"), answers each with `claude -p` signed in to the
# subscription (no tools, no API key), and hands each answer back ("store"). The function applies the same quote
# check and writes the same row as the API path, marked written_via "subscription".
set -euo pipefail
: "${SUPABASE_SERVICE_ROLE_KEY:?run under dotenvx run --}"
URL="https://qkgaybvrernstplzjaam.supabase.co/functions/v1/batch-comment-discovery"
MAX="${1:-20}"
MODEL="${MODEL:-claude-haiku-5-5}"
CLAUDE="${CLAUDE:-$HOME/.local/bin/claude}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

call() {  # call <json body file> <output file>
  curl -sS -m 150 -X POST "$URL" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" --data-binary "@$1" -o "$2"
}

if [ "${FORCE:-0}" != "1" ]; then
  echo '{"batch_size":1}' > "$TMP/probe.json"; call "$TMP/probe.json" "$TMP/probe.out"
  if ! jq -e '(.credit_exhausted == true) or ((.error_details // []) | any(test("Anthropic (401|403)")))' "$TMP/probe.out" >/dev/null; then
    echo "API path answered (discovered $(jq -r '.discovered // 0' "$TMP/probe.out"), remaining $(jq -r '.remaining // 0' "$TMP/probe.out")); nothing to do here."
    exit 0
  fi
  echo "API path refused (billing or auth); using the subscription."
fi

jq -n --argjson n "$MAX" '{step:"prepare", batch_size:$n}' > "$TMP/prep.json"; call "$TMP/prep.json" "$TMP/prep.out"
n=$(jq '(.samples // []) | length' "$TMP/prep.out")
echo "owed lots prepared: $n (more waiting: $(jq -r '.remaining // 0' "$TMP/prep.out"))"
stored=0; failed=0
for i in $(seq 0 $((n - 1))); do
  id=$(jq -r ".samples[$i].vehicle_id" "$TMP/prep.out")
  jq -r ".samples[$i].prompt" "$TMP/prep.out" > "$TMP/prompt.txt"
  # The subscription login, never an API key; no tools, since the prompt carries text strangers wrote.
  # A one-line system prompt and no settings: the default session context is ~112,000 tokens a call, this is ~600
  # (measured 2026-11-12).
  if ! env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u CLAUDECODE "$CLAUDE" -p --model "$MODEL" --tools "" \
      --system-prompt "Answer the request exactly as it asks. Output only the answer." --setting-sources "" \
      --strict-mcp-config --output-format json --no-session-persistence < "$TMP/prompt.txt" > "$TMP/answer.json" 2> "$TMP/answer.err"; then
    echo "  $id: model call failed: $(head -c 200 "$TMP/answer.err")"; failed=$((failed + 1)); continue
  fi
  jq -n --arg id "$id" --arg model "$MODEL" --rawfile a "$TMP/answer.json" \
    '{step:"store", vehicle_ids:[$id], model:$model, text:(($a | fromjson).result // "")}' > "$TMP/store.json"
  call "$TMP/store.json" "$TMP/store.out"
  if jq -e '.discovered == 1' "$TMP/store.out" >/dev/null; then stored=$((stored + 1)); echo "  $id: stored"
  else failed=$((failed + 1)); echo "  $id: not stored: $(jq -c '.error // .error_details' "$TMP/store.out" | head -c 200)"; fi
done
echo "stored $stored, failed $failed"
[ "$failed" -eq 0 ]

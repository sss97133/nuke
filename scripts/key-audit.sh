#!/bin/bash
# Key Guardian Daily Audit
# Run: bash scripts/key-audit.sh
# Scans for exposed secrets in codebase and recent commits, emails report

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

# Extract env vars via dotenvx into temp file, then source
TMPENV=$(mktemp)
dotenvx run -- env 2>/dev/null | grep -E "^(RESEND_API_KEY|VITE_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=" > "$TMPENV" || true
source "$TMPENV"
rm -f "$TMPENV"

echo "[key-audit] Scanning git history (last 50 commits)..."
HISTORY_FINDINGS=$(gitleaks detect --config .gitleaks.toml --no-banner --log-opts="-50" 2>&1 || true)

echo "[key-audit] Scanning working tree..."
TREE_FINDINGS=$(gitleaks detect --config .gitleaks.toml --no-banner --source . 2>&1 || true)

echo "[key-audit] Checking .env for unrotated known-bad keys..."
BAD_KEYS=""
# Check for known-bad patterns (add any rotated keys here)
if grep -q "AIzaSyAU1luvizvOniiVfso60B29ggppvzD5h1o" .env 2>/dev/null; then
  BAD_KEYS="$BAD_KEYS\n- GEMINI_API_KEY: original key still present — rotate at https://aistudio.google.com/app/apikey"
fi
if grep -q "whsec_dCdCvyVecYrwSUocJqxKdq0teAiElJYQ" .env 2>/dev/null; then
  BAD_KEYS="$BAD_KEYS\n- STRIPE_WEBHOOK_SECRET: key shared in chat — rotate at https://dashboard.stripe.com/test/webhooks"
fi

HISTORY_COUNT=$(echo "$HISTORY_FINDINGS" | grep -c "finding" 2>/dev/null; true)
TREE_COUNT=$(echo "$TREE_FINDINGS" | grep -c "finding" 2>/dev/null; true)
HISTORY_COUNT=${HISTORY_COUNT:-0}
TREE_COUNT=${TREE_COUNT:-0}
ISSUES=$(( ${HISTORY_COUNT} + ${TREE_COUNT} ))

if [ "$ISSUES" -eq 0 ] && [ -z "$BAD_KEYS" ]; then
  STATUS="CLEAN — no secrets detected"
else
  STATUS="ACTION REQUIRED — $ISSUES finding(s)"
fi

echo "[key-audit] Status: $STATUS"

# Send email report via agent-email edge function (has RESEND_API_KEY in Supabase secrets)
AUDIT_DATE=$(date +%Y-%m-%d)
AUDIT_DATETIME=$(date)
EMAIL_BODY="KEY GUARDIAN DAILY AUDIT
${AUDIT_DATETIME}

Status: ${STATUS}

Unrotated known-bad keys:
${BAD_KEYS:-none}

Git history scan (last 50 commits):
${HISTORY_FINDINGS:-clean}

Working tree scan:
${TREE_FINDINGS:-clean}

— Key Guardian, Nuke"

curl -s -X POST "${VITE_SUPABASE_URL}/functions/v1/agent-email" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d "$(jq -n \
    --arg from "key-guardian" \
    --arg to "founder" \
    --arg subject "[Key Guardian] Daily Audit — ${STATUS} — ${AUDIT_DATE}" \
    --arg message "$EMAIL_BODY" \
    '{action: "send", from: $from, to: $to, subject: $subject, message: $message}'
  )" | jq -r '.id // .resend_id // .message // "sent"'

echo "[key-audit] Done."

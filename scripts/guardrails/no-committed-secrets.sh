#!/usr/bin/env bash
# guardrail: no-committed-secrets
#
# Blocks committing secrets into the Nuke repo:
#   - key-material FILES: *.pem, *.key, *.p12, *.pfx, private_key*, id_rsa*, id_ed25519*, id_ecdsa*
#   - PEM private-key blocks in file content
#   - provider API keys by high-precision prefix (Anthropic, AWS, GitHub, Slack, Google, Stripe, Supabase sbp_)
#   - Supabase SERVICE_ROLE JWTs (payload is decoded; anon-role JWTs are publishable and allowed)
#   - hardcoded secret assignments: secretish_var = "40+ char literal"
#
# Usage:
#   no-committed-secrets.sh            scan STAGED files (pre-commit mode; exits 0 if nothing staged)
#   no-committed-secrets.sh --tracked  scan ALL tracked files (audit mode)
#
# Exit codes: 0 = clean, 1 = violations found, 2 = setup error.
#
# INERT until wired: install as a pre-commit hook / Claude Code hook in the Wire phase.

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "no-committed-secrets: not in a git repo" >&2; exit 2; }
cd "$REPO_ROOT" || exit 2

MODE="staged"
[ "${1:-}" = "--tracked" ] && MODE="tracked"

SELF="scripts/guardrails/no-committed-secrets.sh"
VIOLATIONS=0
TMP="$(mktemp -d "${TMPDIR:-/tmp}/nosecrets.XXXXXX")" || exit 2
trap 'rm -rf "$TMP"' EXIT

# ---------------------------------------------------------------- file list
# Paths we never scan: lockfiles, minified bundles, sourcemaps, vendored deps.
EXCLUDE_PATH_RE='(^|/)(node_modules|dist|build|vendor|\.git)/|package-lock\.json$|pnpm-lock\.yaml$|yarn\.lock$|\.lock$|\.min\.js$|\.map$'

if [ "$MODE" = "staged" ]; then
  git diff --cached --name-only --diff-filter=ACM -z
else
  git ls-files -z
fi | tr '\0' '\n' | grep -vE "$EXCLUDE_PATH_RE" | grep -vFx "$SELF" > "$TMP/files" || true

# .gitignore sanity: priv/ and *.pem must stay ignored so key files (e.g. the
# local priv/kalshi/private_key.pem) can't be staged accidentally.
for probe in "priv/_guardrail_probe.pem" "_guardrail_probe.pem"; do
  if ! git check-ignore -q "$probe"; then
    echo "WARN [.gitignore] '$probe' would NOT be ignored -- ensure 'priv/' and '*.pem' are in .gitignore" >&2
  fi
done

if [ ! -s "$TMP/files" ]; then
  echo "no-committed-secrets: OK (no files to scan)"
  exit 0
fi

report() { # report <rule> <location> <detail>
  VIOLATIONS=$((VIOLATIONS + 1))
  printf 'VIOLATION [%s] %s  %s\n' "$1" "$2" "$3"
}

# ------------------------------------------------------- 1. forbidden files
# Key material must never be a tracked/staged file at all, regardless of content.
grep -E '(\.pem|\.key|\.p12|\.pfx|\.jks)$|(^|/)(private_key|id_rsa|id_ed25519|id_ecdsa)[^/]*$' "$TMP/files" \
  | while IFS= read -r f; do
      report "key-file" "$f" "key-material filename must not be committed"
    done > "$TMP/fileviol"
# (subshell can't bump VIOLATIONS; count from output)
if [ -s "$TMP/fileviol" ]; then
  cat "$TMP/fileviol"
  VIOLATIONS=$((VIOLATIONS + $(wc -l < "$TMP/fileviol")))
fi

# --------------------------------------------------------- content scanning
# git grep --cached searches the INDEX, i.e. exactly what a commit would contain
# (covers both staged-hunk content and tracked content). -I skips binaries.
#
# Perf: ONE combined pass over the index collects all candidate lines; each rule
# then classifies against that (small) hit set locally.

# Lines that are clearly placeholders / env lookups, not live secrets.
PLACEHOLDER_RE='YOUR|EXAMPLE|PLACEHOLDER|SAMPLE|CHANGE_?ME|REDACTED|XXXX|\*\*\*|<[A-Za-z][A-Za-z0-9_ -]*>|\$\{|\$[A-Z_]{3,}|process\.env|Deno\.env|import\.meta\.env|os\.environ|getenv\(|dotenv'

RULE_NAMES=(
  "private-key-block"
  "anthropic-key"
  "openai-key"
  "aws-access-key-id"
  "github-token"
  "slack-token"
  "google-api-key"
  "stripe-live-key"
  "supabase-access-token"
)
RULE_PATTERNS=(
  '[-]{5}BEGIN [A-Z ]*PRIVATE KEY[-]{5}'
  'sk-ant-[A-Za-z0-9_-]{24,}'
  'sk-(proj|svcacct)-[A-Za-z0-9_-]{32,}|\bsk-[A-Za-z0-9]{48}\b'
  '\bAKIA[0-9A-Z]{16}\b'
  '\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{22,}'
  '\bxox[baprs]-[A-Za-z0-9-]{10,}'
  '\bAIza[0-9A-Za-z_-]{35}\b'
  '\b(sk|rk)_live_[0-9a-zA-Z]{24,}\b'
  '\bsbp_[0-9a-f]{40}\b'
)
# Generic: secret-ish variable assigned a long literal. JWT values (eyJ...) are
# excluded from this rule because the dedicated JWT rule decodes and judges them.
GENERIC_PAT="(api[_-]?key|secret|passwd|password|private[_-]?key|service_role[_-]?key|auth[_-]?token|access[_-]?token)['\"]?[[:space:]]*[:=][[:space:]]*['\"][A-Za-z0-9+/=_.-]{40,}['\"]"
JWT_PAT='eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}'

# Single index pass with all patterns OR'd together.
GREP_ARGS=()
for pat in "${RULE_PATTERNS[@]}" "$GENERIC_PAT" "$JWT_PAT"; do
  GREP_ARGS+=(-e "$pat")
done
tr '\n' '\0' < "$TMP/files" \
  | xargs -0 git grep --cached -I -n -E "${GREP_ARGS[@]}" -- 2>/dev/null \
  > "$TMP/hits" || true

emit_rule_hits() { # emit_rule_hits <rule-name> <ERE> [extra-filter-cmds already applied via stdin]
  local rule="$1" pat="$2" out
  out="$(grep -E -e "$pat" "$TMP/hits" 2>/dev/null | grep -vE "$PLACEHOLDER_RE" || true)"
  [ -z "$out" ] && return 0
  while IFS= read -r hit; do
    report "$rule" "${hit%%:*}:$(printf '%s' "$hit" | cut -d: -f2)" \
      "$(printf '%s' "$hit" | cut -d: -f3- | cut -c1-80)"
  done <<< "$out"
}

i=0
for rule in "${RULE_NAMES[@]}"; do
  emit_rule_hits "$rule" "${RULE_PATTERNS[$i]}"
  i=$((i + 1))
done

out="$(grep -E -e "$GENERIC_PAT" "$TMP/hits" 2>/dev/null | grep -vE "$PLACEHOLDER_RE" | grep -viE "[:=][[:space:]]*['\"]eyJ" || true)"
if [ -n "$out" ]; then
  while IFS= read -r hit; do
    report "hardcoded-secret-assignment" "${hit%%:*}:$(printf '%s' "$hit" | cut -d: -f2)" \
      "$(printf '%s' "$hit" | cut -d: -f3- | cut -c1-80)"
  done <<< "$out"
fi

# ------------------------------------------------- 2. service_role JWT check
# Anon-role Supabase JWTs are publishable client keys and intentionally live in
# this repo. Only a decoded payload containing "service_role" is a violation.
grep -E -e "$JWT_PAT" "$TMP/hits" 2>/dev/null \
  | grep -oE '^[^:]+:[0-9]+:.*' > "$TMP/jwtlines" || true
if [ -s "$TMP/jwtlines" ]; then
  while IFS= read -r line; do
    loc="${line%%:*}:$(printf '%s' "$line" | cut -d: -f2)"
    printf '%s' "$line" | grep -oE 'eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}' \
      | while IFS= read -r jwt; do
          payload="$(printf '%s' "$jwt" | cut -d. -f2 | tr '_-' '/+')"
          pad=$(( (4 - ${#payload} % 4) % 4 ))
          i=0; while [ $i -lt $pad ]; do payload="${payload}="; i=$((i+1)); done
          if printf '%s' "$payload" | base64 -d 2>/dev/null | grep -q 'service_role'; then
            echo "$loc"
          fi
        done
  done < "$TMP/jwtlines" | sort -u > "$TMP/srviol"
  if [ -s "$TMP/srviol" ]; then
    while IFS= read -r loc; do
      report "service-role-jwt" "$loc" "Supabase SERVICE_ROLE key committed (decoded JWT payload)"
    done < "$TMP/srviol"
  fi
fi

# -------------------------------------------------------------------- result
if [ "$VIOLATIONS" -gt 0 ]; then
  echo "no-committed-secrets: BLOCKED -- $VIOLATIONS violation(s) [$MODE mode]"
  exit 1
fi
echo "no-committed-secrets: OK ($(wc -l < "$TMP/files" | tr -d ' ') files scanned, $MODE mode)"
exit 0

#!/usr/bin/env bash
# subscription-token.sh — take the Claude subscription token for the later steps of one Actions job.
#
# The one place a workflow reads the repo secret CLAUDE_CODE_OAUTH_TOKEN (.github/workflows/photo-keys.yml, both jobs).
# The stored secret was saved wrapped (2026-11-24: the CLI refused it as "contains a line break at character 80";
# `claude auth status` does not catch that). A token holds no whitespace, so every whitespace character is removed,
# the joined value is masked (GitHub masks a multi-line secret line by line, never the joined value), and it is
# exported through GITHUB_ENV, so the job's later steps read the cleaned value and must not name the secret again
# (a step's own env: would put the stored value back over it). scripts/guardrails/workflow-log-counts-only.mjs fails
# a workflow that names the secret twice.
#
# Prints the token's shape only: how many characters were removed, its length, and whether it has the subscription
# prefix. Never the value. Exit 4 when the secret is empty (the keys lane's authentication code), 2 outside Actions.
#
#   - name: Take the subscription token
#     shell: bash
#     env:
#       CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
#     run: bash scripts/ci/subscription-token.sh
#
# Runs on ubuntu and macOS runners (bash 3.2). Contract: scripts/ci/subscription-token.test.mjs.
set -euo pipefail

raw="${CLAUDE_CODE_OAUTH_TOKEN:-}"
if [ -z "$raw" ]; then echo "::error::CLAUDE_CODE_OAUTH_TOKEN (subscription) not set."; exit 4; fi
if [ -z "${GITHUB_ENV:-}" ]; then echo "::error::GITHUB_ENV not set: this runs inside a GitHub Actions step."; exit 2; fi

token="$(printf '%s' "$raw" | tr -d '[:space:]')"
if [ -z "$token" ]; then echo "::error::CLAUDE_CODE_OAUTH_TOKEN (subscription) holds only whitespace."; exit 4; fi
# Masked before anything else is written: from here on the runner replaces the joined value in every log line.
echo "::add-mask::$token"
printf 'CLAUDE_CODE_OAUTH_TOKEN=%s\n' "$token" >> "$GITHUB_ENV"

prefix=no
case "$token" in sk-ant-oat*) prefix=yes ;; esac
echo "token shape | removed: $(( ${#raw} - ${#token} )) whitespace, length: ${#token}, subscription prefix: $prefix"

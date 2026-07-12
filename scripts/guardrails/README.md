# Guardrails — Nuke repo rails for agents

Six self-contained checks (zero deps, chmod +x) that keep agents from repeating the
failure classes the 2026-07-12 ledger audit found. **All are currently INERT** — nothing
is hooked into git or Claude Code. Enabling is opt-in (Skylar's call); instructions below.

Authority: `docs/ledger/` (CANONICAL_LEDGER.md, CAPABILITY_MAP.md, ledger.json).

## The suite

| Script | Catches | Violations today (2026-07-12) |
|---|---|---|
| `no-raw-fetch.sh` | Edge functions fetching external pages directly instead of via `_shared/archiveFetch` (results must land in `listing_page_snapshots`). Allowlists internal/LLM/OAuth calls; escape hatch `// guardrail-allow: raw-fetch`. | **144** (~70-80% genuine raw scrapes; rest internal-in-disguise — wire as a ratchet, not a hard block) |
| `no-raw-testimony-insert.mjs` | Raw INSERT/UPSERT into testimony tables (`vehicle_observations`, `vehicle_user_permissions`) bypassing the `ingest-observation` front door — in migrations (incl. DO blocks) and edge functions. Marker bypass: `ALLOW_RAW_TESTIMONY_WRITE`. | **2** (+1 grandfathered baseline) |
| `no-committed-secrets.sh` | Committed private keys, PEM blocks, service_role JWTs (decoded, not pattern-matched — anon keys pass), provider API keys, secret-named assignments. Default mode scans the git index (0.04s, pre-commit safe); `--tracked` = full audit. | **0** |
| `check-capability-before-mint.mjs` | Minting a function/table/page whose capability already has a canonical owner, or resurrecting a DEAD/RETIRED name. Per-name preflight: `check-capability-before-mint.mjs "<name>"` → exit 0 CLEAR / 1 STOP. `--json`, `--test` available. | n/a (preflight, not a sweeper) |
| `no-schema-baked-labels.mjs` | New migrations baking world-labels as CHECK enums / CREATE TYPE (doctrine: labels are projections of measurement). Advisory — always exits 0. Default scopes to staged migrations; `--all` = full audit. | **282** across 143 historical migrations (`--all`); staged mode currently clean |
| `no-dead-asset-references.mjs` | Live code referencing dropped tables (`.from('vehicle_image_tags')` → silent 404) or DEAD edge functions. ERROR = DB-confirmed ghost on a live path; WARNING = ledger-DEAD. `--no-db`, `--json`, `--strict`. | **190** (150 relations, 40 edge fns; **50 confirmed-ghost ERRORs on live UI paths**) |

Exit convention: 0 = clean, 1 = violation, 2 = setup/usage error.

## Opt-in enablement (do NOT enable without Skylar's sign-off)

### (a) Git pre-commit hook — the three safe fail-on-violation guards

`no-committed-secrets` is safe as a hard block today (0 violations). `no-raw-fetch` has 144
pre-existing violations and `no-raw-testimony-insert` has 2 — the hook below runs them as
**ratchets** (fail only if the count grows) so day-one commits aren't bricked.

```bash
cat > /Users/skylar/nuke/.git/hooks/pre-commit <<'HOOK'
#!/bin/bash
# Nuke guardrails pre-commit — see scripts/guardrails/README.md
set -u
R=/Users/skylar/nuke
fail=0

# Hard block: secrets in the index (0 baseline — any hit is new)
"$R/scripts/guardrails/no-committed-secrets.sh" || fail=1

# Ratchets: fail only if violation count exceeds recorded baseline
check_ratchet() { # name, baseline, cmd...
  local name=$1 base=$2; shift 2
  local out n
  out=$("$@" 2>&1); n=$(grep -cE '^[^ ].*:[0-9]+' <<<"$out" || true)
  # fall back to script exit semantics if count parse fails
  if [ "${n:-0}" -gt "$base" ]; then
    echo "GUARDRAIL RATCHET FAIL: $name went from $base to $n violations"; echo "$out" | tail -20; fail=1
  fi
}
check_ratchet no-raw-fetch          144 "$R/scripts/guardrails/no-raw-fetch.sh"
check_ratchet no-raw-testimony      2   "$R/scripts/guardrails/no-raw-testimony-insert.mjs"

exit $fail
HOOK
chmod +x /Users/skylar/nuke/.git/hooks/pre-commit
```

To disable: `rm /Users/skylar/nuke/.git/hooks/pre-commit`. As violations get burned down,
lower the baseline numbers in the hook (ratchet down, never up).

### (b) Claude Code PreToolUse hook — capability preflight + dead-asset warning

Add to `/Users/skylar/nuke/.claude/settings.json` under `"hooks"` (merge with existing keys).
Fires when an agent is about to Write/Edit a new edge function or migration: blocks a
duplicate mint (exit 1 → deny), and prints dead-asset warnings non-blockingly.

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "jq -r '.tool_input.file_path // empty' | grep -qE 'supabase/(functions/[^/]+/index\\.ts|migrations/[^/]+\\.sql)$' && { NAME=$(jq -r '.tool_input.file_path' <<<\"$CLAUDE_TOOL_INPUT\" 2>/dev/null | sed -E 's|.*functions/([^/]+)/index.ts|\\1|; s|.*migrations/[0-9_]*([a-z_]+)\\.sql|\\1|'); /Users/skylar/nuke/scripts/guardrails/check-capability-before-mint.mjs \"$NAME\" || exit 2; /Users/skylar/nuke/scripts/guardrails/no-dead-asset-references.mjs --no-db 2>/dev/null | head -5; }; exit 0"
          }
        ]
      }
    ]
  }
}
```

Copy-paste apply (backs up settings first):

```bash
cd /Users/skylar/nuke/.claude
cp settings.json settings.json.bak-$(date +%Y%m%d)
# then merge the JSON above into settings.json (jq -s '.[0] * .[1]' or by hand)
```

Notes: exit 2 from a PreToolUse hook blocks the tool call and feeds stderr back to the
agent — that's the STOP verdict. The dead-asset check is informational only (head -5,
always exit 0). `no-schema-baked-labels.mjs` needs no hook: it is advisory and its
default staged mode can simply be added to the pre-commit hook body if wanted.

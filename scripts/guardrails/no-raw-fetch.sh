#!/usr/bin/env bash
#
# Guardrail: no-raw-fetch
#
# Block raw fetch() in Supabase edge functions. All external page/HTTP scraping
# must go through archiveFetch() from supabase/functions/_shared/archiveFetch.ts,
# which caches, archives to listing_page_snapshots, and routes direct/Firecrawl.
#
# Scope:    supabase/functions/**/*.ts, excluding _shared/ (archiveFetch and its
#           internal fetchers legitimately use raw fetch).
# Allowed:  - lines referencing archiveFetch
#           - comment lines
#           - clearly-internal targets on the same line (Supabase storage/REST/
#             functions, signed/public URLs, localhost, sidecars)
#           - service-API hosts that archiveFetch cannot and should not wrap
#             (LLM providers, OAuth token endpoints, Telegram/Resend/Mux)
#           - lines carrying an explicit escape hatch: // guardrail-allow: raw-fetch
# Violates: everything else — notably direct scrapes of listing pages, sitemaps,
#           BaT/auction endpoints, and direct api.firecrawl.dev calls (Firecrawl
#           must be reached via archiveFetch so results land in the archive).
#
# Exit 0 = clean. Exit 1 = violations (listed on stdout). Exit 2 = setup error.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FUNCS_DIR="$REPO_ROOT/supabase/functions"

if [ ! -d "$FUNCS_DIR" ]; then
  echo "no-raw-fetch: cannot find $FUNCS_DIR" >&2
  exit 2
fi

# Internal targets: fetches that never leave our own infrastructure.
INTERNAL_RE='SUPABASE_URL|supabaseUrl|\.supabase\.co|signedUrl|publicUrl|localhost|127\.0\.0\.1|/functions/v1/|SIDECAR_URL'

# Service APIs archiveFetch is not designed for (JSON POST APIs, not page fetches).
# Deliberately NOT allowed: api.firecrawl.dev — Firecrawl goes through archiveFetch.
SERVICE_API_RE='api\.openai\.com|api\.anthropic\.com|api\.x\.ai|generativelanguage\.googleapis\.com|api\.moonshot\.ai|api\.deepseek\.com|openrouter\.ai|api\.telegram\.org|api\.resend\.com|api\.mux\.com|oauth2\.googleapis\.com'

violations="$(
  grep -rnE '\bfetch\(' "$FUNCS_DIR" \
      --include='*.ts' \
      --exclude-dir=_shared \
    | grep -v  'archiveFetch' \
    | grep -v  'guardrail-allow: raw-fetch' \
    | grep -vE '^[^:]*:[0-9]+:[[:space:]]*(//|\*|/\*)' \
    | grep -viE "$INTERNAL_RE" \
    | grep -viE "$SERVICE_API_RE" \
    | sed "s|^$REPO_ROOT/||"
)" || true

if [ -z "$violations" ]; then
  echo "no-raw-fetch: clean"
  exit 0
fi

count="$(printf '%s\n' "$violations" | wc -l | tr -d ' ')"
echo "no-raw-fetch: $count raw fetch() call(s) in edge functions — use archiveFetch() from _shared/archiveFetch.ts"
echo "(internal/service-API calls that genuinely cannot use archiveFetch may append: // guardrail-allow: raw-fetch)"
echo
printf '%s\n' "$violations"
exit 1

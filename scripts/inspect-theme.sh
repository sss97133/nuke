#!/bin/bash
# Theme inspection script: find places that might cause light color schemes in dark mode.
# Run from repo root: ./scripts/inspect-theme.sh
# Used by theme-inspection agent / manual audit.

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FRONTEND="$ROOT/nuke_frontend/src"

echo "═══════════════════════════════════════════════════════════"
echo "  THEME INSPECTION (light/dark mode)"
echo "═══════════════════════════════════════════════════════════"
echo ""

echo "1. data-theme or colorScheme set outside ThemeContext (should be empty except ThemeContext):"
rg -n "setAttribute\s*\([^)]*data-theme|\.colorScheme\s*=" "$FRONTEND" -g '*.tsx' -g '*.ts' 2>/dev/null || true
echo "   (ThemeContext.tsx is the only allowed place.)"
echo ""

echo "2. CSS color-scheme (should not force light when dark):"
rg -n "color-scheme\s*:" "$ROOT/nuke_frontend" -g '*.css' 2>/dev/null || true
echo ""

echo "3. Tailwind bg-white / text-gray-900 without dark: (sample; manual review for full list):"
rg -n "bg-white(?!\s+dark:)|text-gray-900(?!\s+dark:)" "$FRONTEND" -g '*.tsx' 2>/dev/null | head -20
echo "   (Prefer var(--surface), var(--text), or add dark: variants.)"
echo ""

echo "Done. See .cursor/rules/theme-inspection.mdc and .cursor/agents/theme-inspection-agent.md for fix guidance."

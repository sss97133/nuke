# COORD: Pre-Commit Audit & Coordination Protocol

**Run this before committing any non-trivial change.** This is the shared prompt all concurrent sessions use to avoid overlap, catch violations, and coordinate merges.

---

## Phase 1: Self-Audit (30 seconds)

Before you commit, verify your work against the library. Run these checks mentally or with grep:

### 1.1 Design System Check
```bash
# Find violations in your changed files
git diff --cached --name-only | xargs grep -n 'border-radius\|box-shadow\|linear-gradient\|radial-gradient' 2>/dev/null
git diff --cached --name-only | xargs grep -n 'font-family:.*sans-serif' 2>/dev/null | grep -v 'Arial'
git diff --cached --name-only | xargs grep -n '#[0-9a-fA-F]\{3,8\}' 2>/dev/null | grep -v 'var(--'
```

Rules (from `.claude/rules/frontend.md`):
- Zero border-radius. Zero shadows. Zero gradients.
- Arial only (Courier New for monospace data).
- ALL CAPS labels at 8-9px.
- Colors via CSS variables only — no hardcoded hex in components.
- 2px solid borders.
- Animation: 180ms `cubic-bezier(0.16, 1, 0.3, 1)`.

### 1.2 Computation Surface Check
For any vehicle profile changes, verify:
- [ ] No parallel systems created (feeds into existing tables, not new ones)
- [ ] No empty shells (every widget/section guards with `if (!data) return null`)
- [ ] No cached values displayed (computed on render, not stored)
- [ ] Popup is the deep dive (clickable elements open detail popups)
- [ ] Timeline is the vehicle (no separate tracking systems)

### 1.3 Sticky Stack Check
If you touched any `position: sticky` or `top:` values:
```bash
git diff --cached | grep -n 'position.*sticky\|top:' | grep -v 'var(--vp-'
```
All sticky positioning MUST use `--vp-stick-*` tokens. No hardcoded px values.

### 1.4 Hard Rules Check
- [ ] No new edge functions without TOOLS.md entry
- [ ] No new tables without migration comment justification
- [ ] No new scripts without package.json entry
- [ ] No unbounded UPDATE/DELETE on large tables
- [ ] No raw `fetch()` for external URLs (use `archiveFetch`)

---

## Phase 2: Deconfliction (60 seconds)

Check what other agents are doing and avoid collisions:

```bash
# Who else is working right now?
cat .claude/agents/active/*.md 2>/dev/null

# What files do they claim?
# (Each agent file format: "HH:MM | TASK | description | files/areas")

# What files am I about to commit?
git diff --cached --name-only

# Any overlap? If your files appear in another agent's area, STOP.
# Message them or pick different work.
```

### Conflict Resolution Priority
1. **Same file, same lines**: The agent who registered first wins. The other rebases.
2. **Same file, different sections**: Both can commit. Second committer rebases after first pushes.
3. **Same feature area, different files**: Coordinate via HANDOFF.md — note what you built so the other agent doesn't rebuild it.
4. **Different areas entirely**: No conflict. Both commit freely.

### Check for stale agents
```bash
# Agents idle > 2 hours are likely dead
find .claude/agents/active/ -mmin +120 -exec echo "STALE: {}" \;
# Clean them if you're confident they're gone
find .claude/agents/active/ -mmin +120 -delete
```

---

## Phase 3: Verify Build (30 seconds)

```bash
# TypeScript
cd nuke_frontend && npx tsc --noEmit 2>&1 | tail -5

# If you touched CSS
grep -r 'border-radius' nuke_frontend/src/styles/ | grep -v '0\|none\|\/\/'

# If you touched edge functions
# (just check syntax — don't deploy yet)
deno check supabase/functions/YOUR_FUNCTION/index.ts 2>&1 | tail -5
```

---

## Phase 4: Commit & Coordinate (30 seconds)

```bash
# Stage only YOUR files — never `git add -A`
git add [specific files]

# Commit with conventional format
git commit -m "feat(area): short description

Longer description if needed.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"

# Log your work (atomic, flock-protected)
claude-log-done "area" "description of what was built"

# Update handoff so other agents know what you did
claude-handoff "what I built, what files I touched, what's next"

# Deregister
rm -f .claude/agents/active/$PPID.md
```

---

## Phase 5: Post-Commit Verification (optional, 60 seconds)

After push, verify nothing broke:

```bash
# Quick smoke test
npm run ops:smoke 2>&1 | tail -10

# Check for lock impact (if you ran migrations)
dotenvx run -- bash -c 'psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -c "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='\''Lock'\'';"'

# Verify PostgREST didn't break (if you ran DDL)
curl -s "https://qkgaybvrernstplzjaam.supabase.co/rest/v1/vehicles?select=id&limit=1" -H "apikey: $SUPABASE_ANON_KEY" | head -1
```

---

## Common Violations Checklist

| Violation | How to spot it | Fix |
|-----------|---------------|-----|
| Hardcoded color | `#fff`, `#333`, `rgb(...)` in TSX | Use `var(--text)`, `var(--border)`, etc. |
| Border radius | `borderRadius`, `rounded-` | Remove entirely. Zero radius is the rule. |
| Box shadow | `boxShadow`, `shadow-` | Remove entirely. Zero shadows. |
| Wrong font | `sans-serif` without Arial | `fontFamily: 'Arial, Helvetica, sans-serif'` |
| Hardcoded sticky top | `top: 40px`, `top: calc(...)` | Use `var(--vp-stick-*)` tokens |
| Empty shell | Widget renders with "No data" | Add `if (!data) return null` guard |
| Parallel system | New table for existing data type | Feed into existing tables (see computation surface doc) |
| Unclaimed script | Script in `scripts/` | Add to `package.json` |
| Raw fetch | `fetch('https://...')` | Use `archiveFetch()` |
| Inline position sticky | `style={{ position: 'sticky' }}` | Use CSS class with token |

---

## When to Run This

- **Always**: Before any commit that touches frontend components
- **Always**: Before any commit that touches the vehicle profile
- **Always**: Before any commit that creates new files (tables, functions, scripts)
- **Optional**: For documentation-only commits
- **Skip**: For `.claude/` internal files (HANDOFF, agents, checkpoints)

---

*This prompt replaces ad-hoc "did I break anything?" checks. Every session runs the same protocol. The library is the ground truth.*

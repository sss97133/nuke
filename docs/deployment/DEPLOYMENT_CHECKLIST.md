# Deployment Checklist - VERIFY THESE ARE DEPLOYED

## ✅ Code Changes That Must Be Deployed

### 1. Homepage Header Fixes
**File**: `nuke_frontend/src/pages/CursorHomepage.tsx`

- [ ] Line 214: `viewMode = 'grid'` (default view)
- [ ] Line 766: `var(--grey-600)` (grey buttons when selected)
- [ ] Line 790: `var(--grey-600)` (view mode buttons)
- [ ] Line 809: `var(--grey-600)` (filters button)
- [ ] Lines 698-822: Unified header layout

### 2. Supabase Relationship Fix
**File**: `nuke_frontend/src/pages/CursorHomepage.tsx`

- [ ] Lines 394-416: Separate image query (no embedded relationship)
- [ ] Uses `.in('vehicle_id', vehicleIds)` instead of embedded select

### 3. TypeScript Config
**File**: `nuke_frontend/tsconfig.app.json`

- [ ] Has `baseUrl` and `paths` for `@/*` alias

### 4. Deployment Safeguards
**Files**: 
- `.github/workflows/pre-deploy-check.yml`
- `.husky/pre-commit`
- `scripts/pre-commit-check.sh`

## 🚀 Deployment Commands

```bash
# 1. Commit everything
cd /Users/skylar/nuke
git add -A
git commit -m "fix: deploy all changes"
git push origin main

# 2. Force deploy via Vercel CLI
cd nuke_frontend
vercel --prod --force --yes
```

## ✅ Verification

After deployment, verify:
1. Homepage loads without errors
2. Buttons are grey when selected (not black)
3. Default view is grid (not technical)
4. Header is unified (single card layout)
5. Vehicles and images load correctly


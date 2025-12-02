# Deployment Reliability Guide

## 🎯 Goal: Zero-Failure Deployments

This document outlines the rules, checks, and processes to ensure every deployment succeeds.

---

## 🚨 Common Build Failures & Prevention

### 1. Missing Files (Most Common)

**Problem**: Files exist locally but aren't committed to git.

**Symptoms**:
- `Could not resolve "../parts/SpatialPartPopup"`
- `Module not found: Can't resolve './Component'`

**Prevention**:
- ✅ Pre-commit hook checks for missing files
- ✅ GitHub Actions validates before merge
- ✅ Always run `git status` before committing

**Fix**:
```bash
git add -A
git status  # Verify all files are staged
git commit -m "feat: your changes"
```

---

### 2. TypeScript Path Resolution

**Problem**: `@/` alias not configured in TypeScript.

**Symptoms**:
- `Could not resolve "@/components/..."`
- TypeScript errors on build

**Prevention**:
- ✅ `tsconfig.app.json` must have `baseUrl` and `paths`
- ✅ Pre-commit validates TypeScript config
- ✅ CI checks TypeScript compilation

**Required Config**:
```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

---

### 3. Environment Variables Missing

**Problem**: Build succeeds but app fails at runtime.

**Symptoms**:
- Blank page
- "Missing required Supabase configuration"
- API calls fail

**Prevention**:
- ✅ Document all required env vars
- ✅ CI uses placeholder values for build
- ✅ Vercel dashboard shows missing vars
- ✅ Runtime error messages guide users

**Required Variables**:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

---

### 4. Import Path Errors

**Problem**: Wrong import paths (relative vs absolute).

**Symptoms**:
- `Could not resolve "../components/..."`
- Works locally, fails on Vercel

**Prevention**:
- ✅ Use consistent import style
- ✅ Prefer relative paths for same-level imports
- ✅ Use `@/` alias for cross-directory imports
- ✅ CI validates all imports resolve

**Rules**:
- Same directory: `./Component`
- Parent directory: `../components/Component`
- Cross-directory: `@/components/Component` (if alias configured)

---

## 🛡️ Safety Mechanisms

### 1. Pre-Commit Hook

**Location**: `.husky/pre-commit`

**Checks**:
- ✅ All required files exist
- ✅ TypeScript config valid
- ✅ Quick type check passes

**Setup**:
```bash
chmod +x scripts/pre-commit-check.sh
chmod +x .husky/pre-commit
```

---

### 2. GitHub Actions Pre-Deploy

**Location**: `.github/workflows/pre-deploy-check.yml`

**Checks**:
- ✅ TypeScript compilation
- ✅ Full build succeeds
- ✅ All required files present
- ✅ TypeScript config valid

**Runs**: On every PR and push to `main`

---

### 3. Local Build Validation

**Before pushing, always run**:
```bash
cd nuke_frontend
npm run build
```

If build fails locally, it will fail on Vercel.

---

## 📋 Deployment Checklist

Before every deployment:

- [ ] Run `npm run build` locally - **MUST PASS**
- [ ] Run `git status` - verify all files are committed
- [ ] Check for TypeScript errors: `npm run type-check`
- [ ] Verify environment variables in Vercel dashboard
- [ ] Push to `main` branch
- [ ] Monitor Vercel deployment logs

---

## 🔧 Quick Fixes

### Build Fails: Missing File

```bash
# Find missing file
git status

# Add missing file
git add path/to/missing/file.tsx

# Commit and push
git commit -m "fix: add missing file"
git push origin main
```

### Build Fails: TypeScript Error

```bash
# Check TypeScript errors
cd nuke_frontend
npm run type-check

# Fix errors, then rebuild
npm run build
```

### Build Succeeds, App Fails: Missing Env Vars

1. Go to Vercel Dashboard → Project → Settings → Environment Variables
2. Add missing variables
3. Redeploy

---

## 🎯 Responsibility

**Developer Responsibility**:
- ✅ Run local build before committing
- ✅ Ensure all files are committed
- ✅ Fix TypeScript errors before pushing
- ✅ Verify environment variables are set

**Automated Checks**:
- ✅ Pre-commit hook catches issues early
- ✅ GitHub Actions validates before merge
- ✅ Vercel shows clear error messages

**If Build Fails**:
1. Check Vercel build logs
2. Reproduce locally: `npm run build`
3. Fix the issue
4. Push fix
5. Verify deployment succeeds

---

## 📊 Success Metrics

**Target**: 100% deployment success rate

**Tracking**:
- Failed deployments per week
- Time to fix failed deployments
- Common failure causes

**Goal**: < 5 minutes to fix any deployment issue

---

## 🚀 Continuous Improvement

1. **Monitor**: Track common failure patterns
2. **Automate**: Add checks for new failure types
3. **Document**: Update this guide with new issues
4. **Prevent**: Fix root causes, not just symptoms

---

## 📚 Related Docs

- [Deployment Setup](./DEPLOYMENT_SETUP.md)
- [Environment Variables](./VERCEL_ENV_SETUP.md)
- [Troubleshooting](./TROUBLESHOOTING_NO_CONTENT.md)


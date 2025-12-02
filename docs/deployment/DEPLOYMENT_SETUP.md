# Deployment Setup Guide

## 🎯 Recommended: Vercel GitHub Integration (Automatic)

**Best for**: Automatic deployments on every push to `main`

### Setup Steps:

1. **Connect GitHub to Vercel** (One-time setup):
   - Go to [Vercel Dashboard](https://vercel.com/dashboard)
   - Click "Add New Project"
   - Select your GitHub repository (`sss97133/nuke`)
   - Vercel will auto-detect your `vercel.json` configuration
   - Click "Deploy"

2. **Configure Environment Variables**:
   - In Vercel Dashboard → Project Settings → Environment Variables
   - Add all required variables:
     - `VITE_SUPABASE_URL`
     - `VITE_SUPABASE_ANON_KEY`
     - Any other environment variables your app needs

3. **Automatic Deployments**:
   - ✅ Every push to `main` → Production deployment
   - ✅ Every PR → Preview deployment (unique URL)
   - ✅ No manual commands needed

### Benefits:
- **Zero maintenance**: Deploys automatically on push
- **Preview URLs**: Every PR gets its own preview
- **Rollback**: Easy rollback from Vercel dashboard
- **Analytics**: Built-in deployment analytics

---

## 🔧 Alternative: GitHub Actions (More Control)

**Best for**: Custom workflows, testing before deploy, conditional deployments

### Setup Steps:

1. **Get Vercel Tokens**:
   ```bash
   # Install Vercel CLI if not already installed
   npm install -g vercel
   
   # Login and get token
   vercel login
   vercel link
   ```

2. **Add GitHub Secrets**:
   - Go to GitHub → Settings → Secrets and variables → Actions
   - Add these secrets:
     - `VERCEL_TOKEN`: Get from [Vercel Settings → Tokens](https://vercel.com/account/tokens)
     - `VITE_SUPABASE_URL`: Your Supabase URL
     - `VITE_SUPABASE_ANON_KEY`: Your Supabase anon key

3. **Workflows Included**:
   - `.github/workflows/deploy-vercel.yml` - Production deployments on push to `main`
   - `.github/workflows/deploy-preview.yml` - Preview deployments on PRs

### Usage:

**Automatic** (recommended):
- Push to `main` → Auto-deploys to production
- Open PR → Auto-creates preview deployment

**Manual**:
- Go to Actions tab → Select workflow → "Run workflow"

---

## 📊 Deployment Methods Comparison

| Method | Setup | Speed | Control | Preview URLs |
|--------|-------|-------|---------|--------------|
| **Vercel GitHub Integration** | ⭐ Easy | ⚡ Fastest | ⚙️ Medium | ✅ Yes |
| **GitHub Actions** | ⚙️ Medium | ⚡ Fast | ⚙️ High | ✅ Yes |
| **Manual CLI** | ✅ None | 🐌 Slowest | ⚙️ Full | ❌ No |

---

## 🚀 Current Setup

Your repository now has:

1. **GitHub Actions workflows** (`.github/workflows/`):
   - `deploy-vercel.yml` - Production deployments
   - `deploy-preview.yml` - Preview deployments
   - `mobile-smoke.yml` - Smoke tests
   - `expire-new-arrivals.yml` - Scheduled tasks

2. **Vercel configuration** (`vercel.json`):
   - Build command: `cd nuke_frontend && npm run build`
   - Output directory: `nuke_frontend/dist`
   - Framework: Vite
   - Security headers configured

---

## 🔄 Migration from Manual CLI

**Before** (manual):
```bash
vercel --prod --force --yes
```

**After** (automatic):
```bash
git add .
git commit -m "feat: your changes"
git push origin main
# → Vercel automatically deploys!
```

---

## ✅ Recommended Workflow

1. **Development**:
   ```bash
   cd nuke_frontend
   npm run dev
   ```

2. **Commit & Push**:
   ```bash
   git add .
   git commit -m "feat: your changes"
   git push origin main
   ```

3. **Automatic Deployment**:
   - Vercel detects push
   - Builds automatically
   - Deploys to production
   - You get notified

4. **Verify**:
   - Check Vercel dashboard for deployment status
   - Visit https://nuke.vercel.app (or your custom domain)

---

## 🔧 Using Vercel CLI

Since you have Vercel CLI installed, you can use it to check and configure your setup:

### Quick Setup Check
```bash
./scripts/check-vercel-setup.sh
```

### Check Current Status
```bash
# Check authentication
vercel whoami

# List projects
vercel project ls

# Check if project is linked
cd nuke_frontend
vercel link
```

### Manual Deployment (if needed)
```bash
cd nuke_frontend
vercel --prod --yes
```

### View Environment Variables
```bash
cd nuke_frontend
vercel env ls
```

### Pull Environment Variables for Local Dev
```bash
cd nuke_frontend
vercel env pull .env.local
```

**Full CLI reference**: See `docs/VERCEL_CLI_COMMANDS.md`

---

## 🛠️ Troubleshooting

### Deployments not triggering?
- Check Vercel dashboard → Project Settings → Git
- Verify GitHub integration is connected
- Check GitHub Actions tab for workflow runs
- Use CLI: `vercel project ls` to verify project exists

### Build failures?
- Check Vercel deployment logs: `vercel logs --prod`
- Verify environment variables: `cd nuke_frontend && vercel env ls`
- Test build locally: `cd nuke_frontend && npm run build`

### Need to rollback?
- Vercel Dashboard → Deployments → Select previous deployment → "Promote to Production"
- Or use CLI: `vercel inspect [deployment-url]` to view details

---

## 📝 Notes

- **No more manual deployments needed** - Just push to GitHub!
- **Preview URLs** are automatically created for PRs
- **Production deployments** happen automatically on `main` branch
- **Old manual scripts** (`deploy.sh`, etc.) can be kept as backup but aren't needed


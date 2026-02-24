# Nuke Deployment Workflow

## 🎯 Simple Daily Workflow

### 1️⃣ Local Development (No Change!)
```bash
cd /Users/skylar/nuke/nuke_frontend
npm run dev
```
- Work on http://localhost:5174 as usual
- Nothing changes with your local development

### 2️⃣ When Ready to Deploy
```bash
# From nuke_frontend directory
./deploy.sh
```
This single command will:
1. Build the app
2. Deploy to Vercel
3. Give you the live URL

## 🔄 Git Workflow

### For Daily Work:
```bash
# Save your work
git add -A
git commit -m "feat: your changes"

# Push to GitHub
git push origin production-clean
```

### Deploy to Production:
```bash
# After pushing to GitHub
./deploy.sh
```

## 📦 What Each Part Does

- **Local Dev** → `npm run dev` → http://localhost:5174
- **GitHub** → Code backup & version control
- **Vercel** → Production hosting → https://nuke.vercel.app

## ⚡ Quick Commands

### See your live site:
```bash
vercel ls
```

### Check deployment status:
```bash
vercel inspect
```

### Emergency rollback:
```bash
vercel rollback
```

## 🛠️ Setup (One Time)

1. **Use single Vercel project**: `nuke-app`
2. **Branch**: Always work on `production-clean`
3. **Deploy script**: Use `deploy.sh` for consistency

## ⚠️ Important Notes

- **Never commit .env files**
- **API keys go in Vercel Dashboard** (Settings → Environment Variables)
- **Always test locally first** before deploying
- **One branch, one project** - Keep it simple

## 🚨 If Something Breaks

1. Check local first: `npm run dev`
2. If local works but production doesn't: Check Vercel env vars
3. If build fails: `npm run build` locally to see errors
4. Quick fix: `./deploy.sh` redeploys fresh

## 📊 Status Dashboard

- **Local Dev**: http://localhost:5174
- **Production**: https://nuke-app.vercel.app
- **GitHub**: https://github.com/sss97133/nuke/tree/production-clean
- **Vercel Dashboard**: https://vercel.com/nuke/nuke-app

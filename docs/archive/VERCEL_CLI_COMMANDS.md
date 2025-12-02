# Vercel CLI Commands Reference

## 🔍 Checking Current Setup

### Check Authentication
```bash
vercel whoami
```

### List All Projects
```bash
vercel project ls
```

### Check Project Link Status
```bash
cd nuke_frontend
vercel link
```

### View Project Details
```bash
cd nuke_frontend
vercel inspect
```

### List Environment Variables
```bash
cd nuke_frontend
vercel env ls
```

---

## 🔗 Linking Project

### Link Existing Project
```bash
cd nuke_frontend
vercel link
```

This will:
- Ask you to select/create a project
- Create `.vercel/project.json` with project ID
- Create `.vercel/.vercelignore` if needed

---

## 🚀 Deployment Commands

### Deploy to Preview
```bash
cd nuke_frontend
vercel
```

### Deploy to Production
```bash
cd nuke_frontend
vercel --prod
```

### Deploy with Force (skip confirmation)
```bash
cd nuke_frontend
vercel --prod --yes
```

### Deploy Pre-built (faster)
```bash
cd nuke_frontend
npm run build
vercel --prod --prebuilt
```

---

## 📊 Monitoring

### View Deployment Logs
```bash
vercel logs
```

### View Production Logs
```bash
vercel logs --prod
```

### List Recent Deployments
```bash
vercel ls
```

### Inspect Specific Deployment
```bash
vercel inspect [deployment-url]
```

---

## ⚙️ Environment Variables

### Add Environment Variable
```bash
cd nuke_frontend
vercel env add VITE_SUPABASE_URL production
```

### List Environment Variables
```bash
cd nuke_frontend
vercel env ls
```

### Remove Environment Variable
```bash
cd nuke_frontend
vercel env rm VITE_SUPABASE_URL production
```

### Pull Environment Variables (for local dev)
```bash
cd nuke_frontend
vercel env pull .env.local
```

---

## 🔄 GitHub Integration

### Check if GitHub is Connected
1. Go to Vercel Dashboard
2. Select your project
3. Settings → Git
4. Should show: "Connected to GitHub"

### Connect GitHub (via Dashboard)
1. Vercel Dashboard → Add New Project
2. Select GitHub repository
3. Configure build settings (auto-detected from `vercel.json`)
4. Deploy

### Benefits of GitHub Integration:
- ✅ Automatic deployments on push to `main`
- ✅ Preview deployments for every PR
- ✅ No manual CLI commands needed
- ✅ Deployment history in GitHub

---

## 🛠️ Troubleshooting

### Project Not Found
```bash
cd nuke_frontend
vercel link
# Select existing project or create new
```

### Authentication Issues
```bash
vercel logout
vercel login
```

### Check Build Configuration
```bash
cd nuke_frontend
vercel inspect
```

### View Build Logs
```bash
vercel logs --follow
```

---

## 📝 Quick Reference

| Task | Command |
|------|---------|
| Check auth | `vercel whoami` |
| List projects | `vercel project ls` |
| Link project | `cd nuke_frontend && vercel link` |
| Deploy preview | `cd nuke_frontend && vercel` |
| Deploy production | `cd nuke_frontend && vercel --prod` |
| View logs | `vercel logs --prod` |
| List env vars | `cd nuke_frontend && vercel env ls` |
| Pull env vars | `cd nuke_frontend && vercel env pull` |

---

## 🎯 Recommended Workflow

**With GitHub Integration** (automatic):
```bash
git add .
git commit -m "feat: changes"
git push origin main
# → Vercel auto-deploys!
```

**Without GitHub Integration** (manual):
```bash
cd nuke_frontend
vercel --prod --yes
```


# 🚀 Nuke Platform Deployment Pipeline

## 📋 **Pre-Deployment Checklist**

### ✅ **Local Testing**
```bash
# 1. Test locally first
cd nuke_frontend
npm run dev
# Test all features work locally

# 2. Test build works
npm run build
# Verify no build errors

# 3. Test production build locally
npm run preview
# Verify production build works
```

### ✅ **Environment Variables**
- [ ] All required env vars set in Vercel Dashboard
- [ ] Supabase URL and keys configured
- [ ] AI API keys (Claude, OpenAI) configured
- [ ] Dropbox integration keys set

### ✅ **Code Quality**
- [ ] No TypeScript errors
- [ ] No linting errors
- [ ] All imports resolved
- [ ] No console errors in browser

## 🚀 **Deployment Methods**

### **Method 1: GitHub Integration (Recommended)**
```bash
# 1. Commit your changes
git add .
git commit -m "feat: your feature description"
git push origin main

# 2. Vercel auto-deploys from GitHub
# Check: https://vercel.com/nzero/nuke_frontend/deployments
```

### **Method 2: Manual Deployment (Emergency)**
```bash
# Only use when GitHub integration fails
cd nuke_frontend
vercel --prod
```

## 🎯 **Stable URLs**

### **Production URLs**
- **Main**: https://nukefrontend.vercel.app (stable, never changes)
- **Latest**: https://nukefrontend-[hash]-nzero.vercel.app (changes each deploy)

### **Development**
- **Local**: http://localhost:5174 (for debugging)

## 🔧 **OAuth Configuration**

### **GitHub OAuth App**
- **Callback URL**: `https://qkgaybvrernstplzjaam.supabase.co/auth/v1/callback`
- **App URL**: https://github.com/settings/applications/oauth_apps/Ov23lie2ivkxA9C6hiNA

### **Supabase OAuth**
- **Site URL**: `https://nukefrontend.vercel.app`
- **Redirect URLs**: 
  - `https://nukefrontend.vercel.app`
  - `https://nukefrontend.vercel.app/auth/callback`

## 🐛 **Debugging Workflow**

### **1. Local Debugging**
```bash
cd nuke_frontend
npm run dev
# Debug on localhost:5174
```

### **2. Production Debugging**
```bash
# Check Vercel logs
vercel logs https://nukefrontend.vercel.app

# Check specific deployment
vercel logs [deployment-url]
```

### **3. Environment Issues**
```bash
# Check environment variables
vercel env ls

# Add missing variables
vercel env add VARIABLE_NAME production
```

## ⚡ **Quick Commands**

### **Deploy New Feature**
```bash
git add .
git commit -m "feat: add new tool"
git push origin main
# Auto-deploys to https://nukefrontend.vercel.app
```

### **Hot Fix**
```bash
git add .
git commit -m "fix: critical bug"
git push origin main
# Deploys immediately
```

### **Rollback**
```bash
# Go to Vercel Dashboard
# Find previous working deployment
# Click "Promote to Production"
```

## 🚨 **Emergency Procedures**

### **If Deployment Fails**
1. Check Vercel logs for errors
2. Verify environment variables
3. Test build locally
4. Rollback to previous working version

### **If OAuth Breaks**
1. Check GitHub OAuth app settings
2. Verify Supabase redirect URLs
3. Test with stable URL: https://nukefrontend.vercel.app

## 📊 **Monitoring**

### **Check Deployment Status**
```bash
vercel ls --scope nzero
```

### **Check Production Health**
```bash
curl -I https://nukefrontend.vercel.app
```

---

**Remember**: Always use the stable URL `https://nukefrontend.vercel.app` for OAuth and production access!

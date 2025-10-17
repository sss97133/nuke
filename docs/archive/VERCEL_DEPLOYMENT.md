# Vercel Deployment Guide

## ✅ Project Status
- **Linked to Vercel**: Project "nuke" under scope "nuke"
- **Repository**: https://github.com/sss97133/nuke.git
- **Framework**: Vite
- **API Proxy**: Routes to https://nuke-api.fly.dev

## Required Environment Variables

Add these in Vercel Dashboard → Project Settings → Environment Variables:

### Core Supabase Configuration
```
VITE_SUPABASE_URL=https://qkgaybvrernstplzjaam.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
```

### AI Services (Optional but recommended)
```
VITE_OPENAI_API_KEY=<your-openai-key>
VITE_NUKE_CLAUDE_API=<your-claude-key>
```

### Dropbox Integration (Optional)
```
VITE_DROPBOX_CLIENT_ID=howu7w7zml4m6mq
VITE_DROPBOX_CLIENT_SECRET=6d9mpmfkdt3qtob
```

## Deploy Commands

### Deploy to Preview (staging)
```bash
cd nuke_frontend
vercel
```

### Deploy to Production
```bash
cd nuke_frontend
vercel --prod
```

### Deploy from Git (Automatic)
Every push to your GitHub repository will trigger:
- **main branch** → Production deployment
- **Other branches** → Preview deployments

## Vercel Configuration Details

Your `vercel.json` includes:
- **Build Command**: `npm run build` (TypeScript compile + Vite build)
- **Output Directory**: `dist`
- **API Rewrites**: `/api/*` → `https://nuke-api.fly.dev/api/*`
- **SPA Routing**: All routes serve index.html for React Router
- **Security Headers**: XSS protection, frame options, content type options

## Post-Deployment Checklist

1. ✅ Set environment variables in Vercel Dashboard
2. ✅ Verify Supabase RLS policies allow production domain
3. ✅ Update Supabase URL Configuration:
   - Add production URL to "Site URL" 
   - Add to "Redirect URLs" for OAuth
4. ✅ Test authentication flow on production
5. ✅ Verify image uploads work (check storage CORS)
6. ✅ Monitor deployment logs for any errors

## Production URLs

Once deployed, your app will be available at:
- **Production**: https://nuke.vercel.app (or custom domain)
- **Preview**: https://nuke-git-{branch}-nuke.vercel.app

## Troubleshooting

### If build fails:
1. Check TypeScript errors: `npm run type-check`
2. Ensure all dependencies are in package.json
3. Check Vercel build logs for specific errors

### If API calls fail:
1. Verify the API is running at https://nuke-api.fly.dev
2. Check CORS configuration on the API
3. Ensure environment variables are set

### If authentication fails:
1. Add production URL to Supabase Redirect URLs
2. Check Supabase anon key is correct
3. Verify RLS policies allow production domain

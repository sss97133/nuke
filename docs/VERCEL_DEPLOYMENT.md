# Vercel Deployment Guide for Nuke

This guide provides detailed instructions for deploying the Nuke application to Vercel and troubleshooting common issues.

## Prerequisites

1. A [Vercel](https://vercel.com) account
2. The Nuke repository on GitHub
3. Node.js 18.x or higher installed locally

## Deployment Steps

### 1. Connect Your Repository

1. Log in to your Vercel account
2. Click "Add New" > "Project"
3. Import your GitHub repository (https://github.com/sss97133/nuke)
4. Authorize Vercel to access the repository if needed

### 2. Configure Project Settings

Configure the following settings in the Vercel project dashboard:

- **Framework Preset**: Vite
- **Build Command**: `npm run build`
- **Output Directory**: `dist`
- **Install Command**: `npm install`
- **Node.js Version**: 18.x (or higher)

### 3. Environment Variables

Add the following environment variables in Vercel:

```
VITE_SUPABASE_URL=your_production_supabase_url
VITE_SUPABASE_ANON_KEY=your_production_anon_key
VITE_APP_NAME=Nuke
VITE_APP_DESCRIPTION=Vehicle Management Platform
VITE_ENABLE_ANALYTICS=true
VITE_DEFAULT_THEME=system
```

### 4. Deploy

Click the "Deploy" button to start the deployment process. Vercel will:

1. Clone your repository
2. Install dependencies
3. Build the application
4. Deploy to a production URL

## Troubleshooting

### Build Failures

If your build fails, check the following:

1. **Node.js Version**: Ensure Vercel is using Node.js 18.x or higher
2. **Dependencies**: Check if all required dependencies are properly installed
3. **Build Logs**: Review the build logs for specific errors

### Runtime Errors

If your application deploys but doesn't run correctly:

1. **Environment Variables**: Verify all environment variables are correctly set
2. **API Endpoints**: Ensure API endpoints are correctly configured for production
3. **CORS Issues**: Check for cross-origin resource sharing problems

### Routing Problems

If navigation or routing isn't working:

1. **Vercel.json**: Ensure the `vercel.json` file has proper rewrite rules:
   ```json
   {
     "rewrites": [
       { "source": "/(.*)", "destination": "/index.html" }
     ]
   }
   ```

2. **Client-side Routing**: Make sure React Router is configured correctly for production

## Performance Optimization

To optimize performance on Vercel:

1. **Asset Optimization**: Ensure images and assets are optimized
2. **Code Splitting**: Use dynamic imports for route-based code splitting
3. **Caching Headers**: Configure proper caching headers in `vercel.json`
4. **Preloading**: Implement preloading for critical resources

## Monitoring

After deployment, monitor your application using:

1. **Vercel Analytics**: Enable in your project settings
2. **Error Tracking**: Consider adding a service like Sentry
3. **Performance Monitoring**: Use Lighthouse or Vercel's built-in tools

## Continuous Deployment

For efficient workflow:

1. **Preview Deployments**: Vercel automatically creates preview deployments for pull requests
2. **Branch Deployments**: Configure specific branches for staging environments
3. **Production Deployments**: Main branch should deploy to production

## Domain Configuration

To use a custom domain:

1. Go to your project settings in Vercel
2. Navigate to "Domains"
3. Add your domain and follow the instructions to configure DNS

## Security Best Practices

1. **Environment Variables**: Never commit sensitive information to your repository
2. **API Keys**: Use restricted API keys with minimum necessary permissions
3. **Content Security Policy**: Implement a CSP for additional security

## Need Help?

If you encounter issues not covered in this guide:

1. Check [Vercel Documentation](https://vercel.com/docs)
2. Visit the [Vite Documentation](https://vitejs.dev/guide/)
3. Open an issue in the GitHub repository

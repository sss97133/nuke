#!/bin/bash

# Set script to exit on first error
set -e

# Ensure required environment variables are set
if [ -z "$VITE_SUPABASE_URL" ] || [ -z "$VITE_SUPABASE_ANON_KEY" ]; then
  echo "❌ Error: Missing required environment variables VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY" >&2
  echo "💡 Please set them before running this script (e.g., export VITE_SUPABASE_URL=...)" >&2
  exit 1
fi

# Build the application with production environment variables
echo "Building application for production..."
VITE_ENV=production \
VITE_SUPABASE_URL="$VITE_SUPABASE_URL" \
VITE_SUPABASE_ANON_KEY="$VITE_SUPABASE_ANON_KEY" \
npm run build

# Verify build output
if [ ! -d "dist" ] || [ ! -f "dist/index.html" ] || [ "$(find dist -name '*.js' -type f | wc -l)" -eq 0 ]; then
  echo "❌ Build failed - dist/ directory is missing, incomplete, or contains no JS files" >&2
  exit 1
fi

echo "✅ Build successful"

# Deploy to Vercel (ensure VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID are set in environment)
echo "Deploying to Vercel production..."
npx vercel --prod --token "$VERCEL_TOKEN" --scope "$VERCEL_ORG_ID" --yes

echo "✅ Deployment complete" 
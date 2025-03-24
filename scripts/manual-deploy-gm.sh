#!/bin/bash
# Manual script to properly copy and deploy the GM Vehicle Records page

set -e

# Build the project
echo "Building the project..."
cross-env NODE_ENV=production npx tsc && npx vite build --mode production

# Copy the GM Records HTML file directly to dist
echo "Copying GM Records page to dist directory..."
cp public/gm-vehicle-records.html dist/

# Run the inject-env script
echo "Injecting environment variables..."
node scripts/inject-env.js

# Run other post-build scripts
echo "Running post-build scripts..."
node scripts/fix-production-assets.js
node scripts/verify-env.js

echo "Build completed successfully!"
echo "Deploy to Vercel with: vercel --prod"

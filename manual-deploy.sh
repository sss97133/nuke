#!/bin/bash
# Manual script to deploy GM Vehicle Records pages to Vercel

# Create dist directory if it doesn't exist
mkdir -p dist

# Copy the GM Records pages directly to dist
echo "Copying GM Records pages to dist directory..."
cp public/gm-vehicle-records.html dist/
cp public/gm-vehicle-records-v2.html dist/

echo "Files copied successfully. Ready for manual deployment."
echo "To deploy to Vercel, install the Vercel CLI and run: vercel --prod"

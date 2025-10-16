#!/bin/bash

# Build locally and deploy the dist folder
echo "Building locally..."
npm run build

if [ $? -eq 0 ]; then
    echo "Build successful! Deploying dist folder..."
    cd dist
    vercel --prod --yes --name nuke-static
    cd ..
else
    echo "Build failed locally"
    exit 1
fi

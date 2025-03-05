#!/bin/bash

echo "===== Fixing dependency issues ====="
echo "1. Removing node_modules and lock files"
rm -rf node_modules
rm -rf package-lock.json

echo "2. Reinstalling dependencies"
npm install

echo "3. Running lint to verify config"
npm run lint

echo "4. Type checking"
npx tsc --noEmit

echo "5. Running test build"
npm run build:dev

echo "===== Dependencies fixed successfully ====="

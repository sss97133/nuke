#!/usr/bin/env node

/**
 * This script helps fix dependency issues with the project
 * Run with: node scripts/fix-deps.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🔧 Starting dependency fix process...');

// Create .npmrc if it doesn't exist
try {
  const npmrcPath = path.join(process.cwd(), '.npmrc');
  if (!fs.existsSync(npmrcPath)) {
    console.log('📝 Creating .npmrc file...');
    fs.writeFileSync(npmrcPath, 'legacy-peer-deps=true\nfund=false\naudit=false\n');
    console.log('✅ Created .npmrc file');
  }
} catch (err) {
  console.error('❌ Error creating .npmrc:', err);
}

// Clean install steps
try {
  console.log('🗑️ Removing node_modules folder...');
  try {
    fs.rmSync(path.join(process.cwd(), 'node_modules'), { recursive: true, force: true });
  } catch (e) {
    console.log('  No node_modules folder found or could not remove');
  }
  
  console.log('🗑️ Removing package-lock.json...');
  try {
    fs.unlinkSync(path.join(process.cwd(), 'package-lock.json'));
  } catch (e) {
    console.log('  No package-lock.json found or could not remove');
  }
  
  console.log('📦 Installing dependencies with npm...');
  execSync('npm install --legacy-peer-deps', { stdio: 'inherit' });
  
  console.log('🧪 Testing build...');
  execSync('npm run build', { stdio: 'inherit' });
  
  console.log('✅ Dependencies fixed successfully!');
  console.log('');
  console.log('Next steps:');
  console.log('1. Commit the new package-lock.json file');
  console.log('2. Push to your repository');
  
} catch (error) {
  console.error('❌ Error fixing dependencies:', error.message);
  process.exit(1);
}
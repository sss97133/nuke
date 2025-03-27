import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Ensure we're in the project root
process.chdir(__dirname);

// Clean up any existing build artifacts
if (fs.existsSync('dist')) {
  fs.rmSync('dist', { recursive: true, force: true });
}

// Install dependencies
console.log('Installing dependencies...');
execSync('npm ci', { stdio: 'inherit' });

// Run TypeScript compilation
console.log('Compiling TypeScript...');
execSync('tsc', { stdio: 'inherit' });

// Run Vite build
console.log('Building with Vite...');
execSync('vite build --mode production', { stdio: 'inherit' });

// Run post-build scripts
console.log('Running post-build scripts...');
const scripts = [
  'copy-gm-records.js',
  'inject-env.js',
  'fix-production-assets.js',
  'verify-env.js',
  'verify-gm-records.js'
];

for (const script of scripts) {
  console.log(`Running ${script}...`);
  execSync(`node scripts/${script}`, { stdio: 'inherit' });
}

console.log('Build completed successfully!'); 
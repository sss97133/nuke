import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Ensure we're in the project root
process.chdir(dirname(__dirname));

// Log the environment for debugging
console.log('Building in environment:', process.env.NODE_ENV || 'development');

// Clean up any existing build artifacts
if (fs.existsSync('dist')) {
  console.log('Cleaning dist directory...');
  fs.rmSync('dist', { recursive: true, force: true });
}

// Run TypeScript compilation
console.log('Compiling TypeScript...');
execSync('tsc', { stdio: 'inherit' });

// Run Vite build
console.log('Building with Vite...');
execSync('vite build', { stdio: 'inherit' });

console.log('Build completed successfully!'); 
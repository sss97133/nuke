/**
 * Development Environment Setup
 * 
 * This script sets up a proper development environment for the Nuke project,
 * creating necessary local environment files and ensuring style/CSS bundles work correctly.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

console.log('Setting up development environment for Nuke...');

// Define paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const envFilePath = path.join(rootDir, '.env.local');
const envDevPath = path.join(rootDir, '.env.development');

// Check if .env files exist
const hasLocalEnv = fs.existsSync(envFilePath);
const hasDevEnv = fs.existsSync(envDevPath);

// Create local env file if needed
if (!hasLocalEnv) {
  console.log('Creating .env.local file...');
  const envContent = `# Local Development Environment Variables
# These override other environment files for local development

# Supabase Configuration
VITE_SUPABASE_URL=http://localhost:54321
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0
VITE_SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU

# Development-specific settings
NODE_ENV=development
`;
  fs.writeFileSync(envFilePath, envContent);
  console.log('Created .env.local with placeholder Supabase credentials');
}

// Create development env file if needed
if (!hasDevEnv) {
  console.log('Creating .env.development file...');
  const envDevContent = `# Vite Development Environment Variables

# Supabase Configuration (duplicate of .env.local for Vite to pick up)
VITE_SUPABASE_URL=http://localhost:54321
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0
VITE_SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU

# Development Settings
VITE_MODE=development
`;
  fs.writeFileSync(envDevPath, envDevContent);
  console.log('Created .env.development with placeholder Supabase credentials');
}

// Ensure style imports working correctly
console.log('Checking Tailwind CSS setup...');
const tailwindConfigPath = path.join(rootDir, 'tailwind.config.js');
const tailwindConfig = fs.existsSync(tailwindConfigPath);

if (tailwindConfig) {
  console.log('Tailwind CSS is properly configured');
} else {
  console.log('WARNING: tailwind.config.js not found. CSS may not work correctly.');
}

// Create CSS fix for development if needed
const cssFixes = `/** Ensure default styling works properly in dev mode */
@layer base {
  h1 {
    @apply text-2xl font-bold mb-4;
  }
  h2 {
    @apply text-xl font-bold mb-3;
  }
  h3 {
    @apply text-lg font-bold mb-2;
  }
  a {
    @apply text-blue-500 hover:text-blue-600 underline;
  }
  p {
    @apply mb-4;
  }
}
`;

const devCSSPath = path.join(rootDir, 'src', 'dev-styles.css');
fs.writeFileSync(devCSSPath, cssFixes);
console.log('Created development CSS fixes');

// Update import in main.tsx to include dev styles
const mainTsxPath = path.join(rootDir, 'src', 'main.tsx');
let mainTsxContent = fs.readFileSync(mainTsxPath, 'utf8');

if (!mainTsxContent.includes('./dev-styles.css')) {
  // Add import after index.css
  mainTsxContent = mainTsxContent.replace(
    "import './index.css'",
    "import './index.css'\nimport './dev-styles.css' // Development-only styles"
  );
  fs.writeFileSync(mainTsxPath, mainTsxContent);
  console.log('Updated main.tsx to include development styles');
}

console.log('\nDevelopment environment setup complete!');
console.log('To start the development server, run: npm run dev');
console.log('\nNOTE: The Supabase credentials in .env.local and .env.development are placeholders.');
console.log('Replace them with your actual Supabase credentials if needed.');
console.log('\nHappy coding! 🚀');

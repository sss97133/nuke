#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('\n🔐 Creating Nuke .env file with provided credentials\n');

const envPath = path.join(__dirname, '.env');

// Credentials provided by the user
const credentials = {
  VITE_SUPABASE_URL: 'https://qkgaybvrernstplzjaam.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk',
  VITE_SUPABASE_SERVICE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczODM2OTAyMSwiZXhwIjoyMDUzOTQ1MDIxfQ.NEbqSnSamR5f7Fqon25ierv5yJgdDy_o2nrixOej_Xg'
};

let envContent = '# Nuke Environment Variables\n# Generated on ' + new Date().toISOString() + '\n\n';

// Add each credential to the .env content
Object.entries(credentials).forEach(([key, value]) => {
  envContent += `${key}=${value}\n`;
});

// Write to the .env file
try {
  fs.writeFileSync(envPath, envContent);
  console.log('✅ Environment variables saved to .env file');
  console.log('🚀 Now you can run the app with: npm run dev\n');
} catch (error) {
  console.error('Error writing .env file:', error);
}

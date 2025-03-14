/* eslint-disable no-console, no-undef */
/**
 * Script to inject environment variables into index.html for production builds
 * This enables environment variables in static deployed environments like Vercel
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as process from 'process';

// Get the directory name using ES modules approach
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to the built index.html
const indexPath = path.resolve(__dirname, '../dist/index.html');

// Create runtime environment object with only the variables we want to expose
const env = {
  VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || '',
  VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY || '',
  VITE_SUPABASE_SERVICE_KEY: process.env.VITE_SUPABASE_SERVICE_KEY || '',
  NODE_ENV: process.env.NODE_ENV || 'production'
};

// Log environment variables to help with debugging
console.log('Environment variables being injected:');
console.log('- VITE_SUPABASE_URL present:', !!process.env.VITE_SUPABASE_URL);
console.log('- VITE_SUPABASE_ANON_KEY present:', !!process.env.VITE_SUPABASE_ANON_KEY);
console.log('- VITE_SUPABASE_SERVICE_KEY present:', !!process.env.VITE_SUPABASE_SERVICE_KEY);

try {
  // Read the index.html file
  let html = fs.readFileSync(indexPath, 'utf8');
  
  // Create an inline script to inject environment variables
  const envScript = `<script>window.__env = ${JSON.stringify(env)};</script>`;
  
  // Insert the script right before the closing head tag
  html = html.replace('</head>', `${envScript}\n</head>`);
  
  // Write the modified HTML back to index.html
  fs.writeFileSync(indexPath, html);
  
  console.log('✅ Environment variables injected into index.html');
} catch (error) {
  console.error('❌ Failed to inject environment variables:', error);
  process.exit(1);
}

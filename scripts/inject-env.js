/* eslint-disable no-undef */
/**
 * Script to inject environment variables into index.html for production builds
 * This enables environment variables in static deployed environments like Vercel
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as process from 'process';
import * as dotenv from 'dotenv';

// Get the directory name using ES modules approach
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env file
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Path to the built index.html and GM records page
const indexPath = path.resolve(__dirname, '../dist/index.html');
const gmRecordsPath = path.resolve(__dirname, '../dist/gm-vehicle-records.html');

// Create runtime environment object with only the variables we want to expose
const env = {
  VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || '',
  VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY || '',
  VITE_SUPABASE_SERVICE_KEY: process.env.VITE_SUPABASE_SERVICE_KEY || '',
  NODE_ENV: process.env.NODE_ENV || 'production',
  // Add deployment metadata to help with debugging
  VITE_DEPLOY_TIMESTAMP: new Date().toISOString(),
  VITE_DEPLOY_VERSION: process.env.VERCEL_GIT_COMMIT_SHA || 'local'
};

// Log environment variables to help with debugging
console.log('Environment variables being injected:');
console.log('- VITE_SUPABASE_URL present:', !!process.env.VITE_SUPABASE_URL);
console.log('- VITE_SUPABASE_ANON_KEY present:', !!process.env.VITE_SUPABASE_ANON_KEY);
console.log('- VITE_SUPABASE_SERVICE_KEY present:', !!process.env.VITE_SUPABASE_SERVICE_KEY);

try {
  // Create an inline script to inject environment variables
  const envScript = `<script>window.__env = ${JSON.stringify(env)};</script>`;
  
  // Inject into index.html
  let html = fs.readFileSync(indexPath, 'utf8');
  html = html.replace('</head>', `${envScript}\n</head>`);
  fs.writeFileSync(indexPath, html);
  console.log('✅ Environment variables injected into index.html');
  
  // Inject into GM Records HTML page if it exists
  if (fs.existsSync(gmRecordsPath)) {
    let gmHtml = fs.readFileSync(gmRecordsPath, 'utf8');
    gmHtml = gmHtml.replace('</head>', `${envScript}\n</head>`);
    fs.writeFileSync(gmRecordsPath, gmHtml);
    console.log('✅ Environment variables injected into gm-vehicle-records.html');
  } else {
    console.log('⚠️ gm-vehicle-records.html not found, skipping injection');
  }
} catch (error) {
  console.error('❌ Failed to inject environment variables:', error);
  process.exit(1);
}

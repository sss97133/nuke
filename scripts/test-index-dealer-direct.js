#!/usr/bin/env node

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Load env
let envConfig = {};
const possiblePaths = [
  path.resolve(process.cwd(), 'nuke_frontend/.env.local'),
  path.resolve(process.cwd(), '.env.local'),
  path.resolve(process.cwd(), '.env')
];

for (const envPath of possiblePaths) {
  try {
    if (fs.existsSync(envPath)) {
      const result = dotenv.config({ path: envPath });
      if (!result.error) envConfig = result.parsed || {};
      break;
    }
  } catch (e) {}
}

const SUPABASE_URL = envConfig.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_KEY = envConfig.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || 
                     envConfig.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const url = 'https://www.classic.com/s/111-motorcars-ZnQygen/';

console.log('Testing direct HTTP call...');
const response = await fetch(`${SUPABASE_URL}/functions/v1/index-classic-com-dealer`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SUPABASE_KEY}`
  },
  body: JSON.stringify({ profile_url: url })
});

const text = await response.text();
console.log(`Status: ${response.status}`);
console.log(`Response: ${text}`);

try {
  const json = JSON.parse(text);
  console.log('Parsed JSON:', JSON.stringify(json, null, 2));
} catch {
  console.log('Response is not JSON');
}


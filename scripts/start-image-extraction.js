#!/usr/bin/env node

/**
 * Start Image Extraction Processing
 * Triggers batch processing of all unextracted images
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
let SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

const envLocalPath = path.join(__dirname, '../nuke_frontend/.env.local');
if (!SUPABASE_SERVICE_KEY && fs.existsSync(envLocalPath)) {
  const envContent = fs.readFileSync(envLocalPath, 'utf8');
  const lines = envContent.split('\n');
  for (const line of lines) {
    if (line.startsWith('SUPABASE_SERVICE_ROLE_KEY=') || line.startsWith('SERVICE_ROLE_KEY=')) {
      SUPABASE_SERVICE_KEY = line.split('=')[1]?.trim().replace(/^["']|["']$/g, '');
      break;
    }
  }
}

if (!SUPABASE_SERVICE_KEY) {
  console.log('❌ Missing SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

async function callFunction(functionName, body = {}) {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
      },
      body: JSON.stringify(body)
    });
    
    const text = await response.text();
    let result;
    try {
      result = text ? JSON.parse(text) : {};
    } catch (e) {
      result = { message: text, raw: true };
    }
    
    return { success: response.ok, data: result, status: response.status };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function main() {
  console.log('🚀 Starting Image Extraction Processing...\n');
  
  // Start batch processing
  console.log('📸 Triggering batch image analysis...');
  const result = await callFunction('batch-analyze-all-images', {
    batch_size: 50,
    max_batches: 10,
    priority: 'unextracted'
  });
  
  if (result.success) {
    console.log('✅ Batch processing started!');
    console.log('   Result:', JSON.stringify(result.data, null, 2));
  } else {
    console.log('⚠️  Error:', result.error || result.data?.error);
    
    // Try alternative function
    console.log('\n🔄 Trying alternative: analyze-image batch processing...');
    const altResult = await callFunction('tier1-batch-runner', {
      batch_size: 20
    });
    
    if (altResult.success) {
      console.log('✅ Alternative processing started!');
      console.log('   Result:', JSON.stringify(altResult.data, null, 2));
    } else {
      console.log('❌ Both methods failed');
      console.log('   Error:', altResult.error || altResult.data?.error);
    }
  }
  
  console.log('\n💡 Monitor progress at: /admin/extraction-monitor');
  console.log('   Or check logs: supabase functions logs batch-analyze-all-images');
}

main().catch(console.error);


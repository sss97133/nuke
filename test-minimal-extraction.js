#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, serviceKey);

async function testMinimalExtraction() {
  console.log('🧪 Testing with absolute minimal batch size...');

  try {
    const { data, error } = await supabase.functions.invoke('process-import-queue', {
      body: {
        batch_size: 1,  // Just 1 item
        priority_only: true
      }
    });

    if (error) {
      console.error('❌ Error details:', JSON.stringify(error, null, 2));
      return;
    }

    console.log('✅ Success! Response:', JSON.stringify(data, null, 2));

  } catch (err) {
    console.error('❌ Exception:', err.message);
    if (err.context) {
      console.error('❌ Context:', err.context);
    }
  }
}

testMinimalExtraction();
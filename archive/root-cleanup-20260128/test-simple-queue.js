#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, serviceKey);

async function testSimpleQueue() {
  console.log('🧪 Testing process-import-queue-simple with minimal batch...');

  try {
    const { data, error } = await supabase.functions.invoke('process-import-queue-simple', {
      body: {
        batch_size: 1,
        priority_only: true
      }
    });

    if (error) {
      console.error('❌ Error:', JSON.stringify(error, null, 2));
      return;
    }

    console.log('✅ Success! Response:', JSON.stringify(data, null, 2));

  } catch (err) {
    console.error('❌ Exception:', err.message);
    console.error('❌ Details:', JSON.stringify(err.context || {}, null, 2));
  }
}

testSimpleQueue();
#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, serviceKey);

async function testSimpleFunction() {
  console.log('🧪 Testing simple function call to check Edge Function health...');

  try {
    const { data, error } = await supabase.functions.invoke('analyze-image', {
      body: { test: 'health_check' }
    });

    if (error) {
      console.error('❌ Error:', JSON.stringify(error, null, 2));
      return;
    }

    console.log('✅ Function responded:', data);

  } catch (err) {
    console.error('❌ Exception:', err.message);
    console.error('❌ Details:', JSON.stringify(err.context || {}, null, 2));
  }
}

testSimpleFunction();
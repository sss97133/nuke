#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, serviceKey);

async function testMinimalClaude() {
  console.log('🧪 Testing minimal Claude API calls with different formats...');

  try {
    const { data, error } = await supabase.functions.invoke('test-minimal-claude', {
      body: { test: true }
    });

    if (error) {
      console.error('❌ Error:', JSON.stringify(error, null, 2));
      return;
    }

    console.log('✅ Minimal Claude Test Results:', JSON.stringify(data, null, 2));

  } catch (err) {
    console.error('❌ Exception:', err.message);
  }
}

testMinimalClaude();
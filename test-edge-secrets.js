#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, serviceKey);

async function testEdgeSecrets() {
  console.log('🔑 Testing Edge Function secrets access...');

  try {
    const { data, error } = await supabase.functions.invoke('test-secrets-access', {
      body: { test: true }
    });

    if (error) {
      console.error('❌ Error:', JSON.stringify(error, null, 2));
      return;
    }

    console.log('✅ Edge Function Secrets Report:', JSON.stringify(data, null, 2));

  } catch (err) {
    console.error('❌ Exception:', err.message);
  }
}

testEdgeSecrets();
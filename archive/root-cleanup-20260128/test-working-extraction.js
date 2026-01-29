#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, serviceKey);

async function testWorkingFunctions() {
  console.log('🧪 Testing working extraction functions...');

  // Test 1: Try comprehensive-bat-extraction directly
  console.log('\n1️⃣ Testing comprehensive-bat-extraction...');
  try {
    const { data, error } = await supabase.functions.invoke('comprehensive-bat-extraction', {
      body: {
        listing_url: 'https://bringatrailer.com/listing/2025-porsche-taycan-turbo-gt-weissach-2',
        vehicle_id: null
      }
    });

    if (error) {
      console.error('❌ comprehensive-bat-extraction failed:', error);
    } else {
      console.log('✅ comprehensive-bat-extraction worked:', data);
    }
  } catch (err) {
    console.error('❌ comprehensive-bat-extraction exception:', err.message);
  }

  // Test 2: Try simple extract-vehicle-data-ai
  console.log('\n2️⃣ Testing extract-vehicle-data-ai...');
  try {
    const { data, error } = await supabase.functions.invoke('extract-vehicle-data-ai', {
      body: {
        listing_url: 'https://bringatrailer.com/listing/1984-pontiac-fiero-43'
      }
    });

    if (error) {
      console.error('❌ extract-vehicle-data-ai failed:', error);
    } else {
      console.log('✅ extract-vehicle-data-ai worked:', data);
    }
  } catch (err) {
    console.error('❌ extract-vehicle-data-ai exception:', err.message);
  }

  // Test 3: Check what functions are actually working
  console.log('\n3️⃣ Testing smart-extraction-router...');
  try {
    const { data, error } = await supabase.functions.invoke('smart-extraction-router', {
      body: {
        listing_url: 'https://bringatrailer.com/listing/1969-ford-mustang-mach-1-168'
      }
    });

    if (error) {
      console.error('❌ smart-extraction-router failed:', error);
    } else {
      console.log('✅ smart-extraction-router worked:', data);
    }
  } catch (err) {
    console.error('❌ smart-extraction-router exception:', err.message);
  }
}

testWorkingFunctions().catch(console.error);
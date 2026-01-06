#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, serviceKey);

async function testSimpleFunction() {
  console.log('🧪 Testing comprehensive-bat-extraction directly...');

  try {
    const { data, error } = await supabase.functions.invoke('comprehensive-bat-extraction', {
      body: {
        listing_url: 'https://bringatrailer.com/listing/1984-pontiac-fiero-43',
        vehicle_id: null
      }
    });

    if (error) {
      console.error('❌ Error:', error);
      return;
    }

    console.log('✅ Function response:', data);

  } catch (err) {
    console.error('❌ Exception:', err.message);
  }
}

testSimpleFunction();
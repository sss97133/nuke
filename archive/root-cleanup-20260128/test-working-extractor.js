#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, serviceKey);

async function testWorkingExtractor() {
  console.log('🧪 Testing comprehensive-bat-extraction-working...');

  try {
    const { data, error } = await supabase.functions.invoke('comprehensive-bat-extraction-working', {
      body: {
        listing_url: 'https://www.affordableclassicsinc.com/vehicle/891559/1985-CHEVROLET-BLAZER-SILVERADO/'
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

testWorkingExtractor();
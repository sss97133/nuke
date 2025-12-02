#!/usr/bin/env node
/**
 * Debug script to check Firecrawl configuration
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  console.log('🔍 Testing edge function with detailed error handling...\n');
  
  try {
    const { data, error } = await supabase.functions.invoke('scrape-vehicle', {
      body: { url: 'https://cars.ksl.com/listing/10323198' },
      timeout: 60000
    });
    
    if (error) {
      console.error('❌ Error object:', JSON.stringify(error, null, 2));
      
      // Try to get more details
      if (error.context) {
        console.error('Error context:', error.context);
      }
      if (error.message) {
        console.error('Error message:', error.message);
      }
    } else {
      console.log('✅ Response received');
      console.log('Data:', JSON.stringify(data, null, 2).substring(0, 500));
    }
  } catch (err) {
    console.error('❌ Exception:', err);
    console.error('Stack:', err.stack);
  }
}

test();


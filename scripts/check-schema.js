#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, serviceKey);

async function checkSchema() {
  // Get first vehicle to see available columns
  const { data: sample, error } = await supabase
    .from('vehicles')
    .select('*')
    .limit(1);

  if (error) {
    console.error('Error:', error);
    return;
  }

  if (sample?.length) {
    console.log('Available columns:', Object.keys(sample[0]));
  }

  // Also check count of vehicles with source_url
  const { count } = await supabase
    .from('vehicles')
    .select('*', { count: 'exact', head: true })
    .not('source_url', 'is', null);

  console.log(`Vehicles with source URLs: ${count}`);
}

checkSchema();
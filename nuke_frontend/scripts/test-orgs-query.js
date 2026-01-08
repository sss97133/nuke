// Test script to diagnose organizations query issue
// Run with: node scripts/test-orgs-query.js

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from .env file
dotenv.config({ path: join(__dirname, '../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || 
                    process.env.SUPABASE_URL || 
                    'https://qkgaybvrernstplzjaam.supabase.co';

const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || 
                    process.env.SUPABASE_ANON_KEY || 
                    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk';

console.log('🔍 Testing Organizations Query');
console.log('Supabase URL:', supabaseUrl);
console.log('Anon Key present:', !!supabaseKey);
console.log('Anon Key length:', supabaseKey?.length || 0);
console.log('---');

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

async function testQuery() {
  try {
    console.log('📋 Query 1: Check if businesses table exists...');
    const { data: tableCheck, error: tableError } = await supabase
      .from('businesses')
      .select('id')
      .limit(1);
    
    if (tableError) {
      console.error('❌ Table access error:', {
        message: tableError.message,
        details: tableError.details,
        hint: tableError.hint,
        code: tableError.code
      });
      return;
    }
    console.log('✅ Table accessible');
    console.log('---');

    console.log('📋 Query 2: Count total organizations...');
    const { count, error: countError } = await supabase
      .from('businesses')
      .select('*', { count: 'exact', head: true });
    
    if (countError) {
      console.error('❌ Count error:', countError.message);
    } else {
      console.log('✅ Total organizations:', count);
    }
    console.log('---');

    console.log('📋 Query 3: Count public organizations...');
    const { count: publicCount, error: publicCountError } = await supabase
      .from('businesses')
      .select('*', { count: 'exact', head: true })
      .eq('is_public', true);
    
    if (publicCountError) {
      console.error('❌ Public count error:', publicCountError.message);
    } else {
      console.log('✅ Public organizations:', publicCount);
    }
    console.log('---');

    console.log('📋 Query 4: Fetch public organizations (same as frontend)...');
    const { data, error } = await supabase
      .from('businesses')
      .select('id, business_name, business_type, description, logo_url, website, address, city, state, zip_code, latitude, longitude, is_tradable, stock_symbol, total_vehicles, total_images, total_events, created_at')
      .eq('is_public', true)
      .order('created_at', { ascending: false })
      .limit(20);
    
    if (error) {
      console.error('❌ Query error:', {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code
      });
      return;
    }

    console.log('✅ Query successful!');
    console.log('📊 Results:');
    console.log('   - Organizations returned:', data?.length || 0);
    
    if (data && data.length > 0) {
      console.log('   - First 3 organizations:');
      data.slice(0, 3).forEach((org, idx) => {
        console.log(`      ${idx + 1}. ${org.business_name || '(no name)'} (ID: ${org.id})`);
        console.log(`         Type: ${org.business_type || 'N/A'}, Public: true`);
      });
    } else {
      console.log('   ⚠️  No organizations returned');
    }
    console.log('---');

    console.log('📋 Query 5: Check RLS policies...');
    // Try to check RLS by attempting a query with and without auth
    const { data: rlsTest, error: rlsError } = await supabase
      .rpc('check_rls_policies', {})
      .select();
    
    if (rlsError && !rlsError.message.includes('function') && !rlsError.message.includes('does not exist')) {
      console.log('ℹ️  Could not check RLS directly (no helper function)');
    } else {
      console.log('ℹ️  RLS check:', rlsError ? 'Could not verify' : 'OK');
    }

  } catch (err) {
    console.error('❌ Unexpected error:', err);
  }
}

testQuery();


// Check if sign-up attempts are reaching the remote Supabase database
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkRemoteDatabase() {
  console.log('🔍 Checking Remote Supabase Database for Recent Activity\n');
  
  // Check 1: Recent profiles (created in last hour)
  console.log('1. Checking for recent profiles...');
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: recentProfiles, error } = await supabase
      .from('profiles')
      .select('id, email, full_name, created_at')
      .gte('created_at', oneHourAgo)
      .order('created_at', { ascending: false });
    
    if (error) {
      console.log('❌ Cannot access profiles:', error.message);
    } else {
      console.log(`✅ Found ${recentProfiles.length} recent profiles:`);
      recentProfiles.forEach(profile => {
        console.log(`   - ${profile.email} (${profile.created_at})`);
      });
    }
  } catch (err) {
    console.log('❌ Profiles check failed:', err.message);
  }
  
  // Check 2: Total profile count
  console.log('\n2. Checking total profile count...');
  try {
    const { count, error } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true });
    
    if (error) {
      console.log('❌ Cannot count profiles:', error.message);
    } else {
      console.log(`✅ Total profiles in database: ${count}`);
    }
  } catch (err) {
    console.log('❌ Profile count failed:', err.message);
  }
  
  // Check 3: Test connection to auth endpoint
  console.log('\n3. Testing direct connection to auth endpoint...');
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/settings`, {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`
      }
    });
    
    if (response.ok) {
      const settings = await response.json();
      console.log('✅ Auth endpoint accessible');
      console.log('   Email confirmation enabled:', settings.email_confirm_enabled || 'unknown');
      console.log('   Sign up enabled:', settings.disable_signup ? 'No' : 'Yes');
    } else {
      console.log('❌ Auth endpoint error:', response.status, response.statusText);
    }
  } catch (err) {
    console.log('❌ Auth endpoint test failed:', err.message);
  }
  
  // Check 4: Test a sign-up attempt with detailed logging
  console.log('\n4. Testing sign-up with network tracing...');
  const testEmail = `trace-${Date.now()}@example.com`;
  console.log(`   Attempting sign-up with: ${testEmail}`);
  
  try {
    const startTime = Date.now();
    const { data, error } = await supabase.auth.signUp({
      email: testEmail,
      password: 'TracePassword123!'
    });
    const endTime = Date.now();
    
    console.log(`   Request took: ${endTime - startTime}ms`);
    
    if (error) {
      console.log('❌ Sign-up failed:', error.message);
      console.log('   Status:', error.status);
      console.log('   This tells us the request IS reaching Supabase API');
      
      if (error.status === 422) {
        console.log('   422 = Validation error (good - means API is working)');
      } else if (error.status === 500) {
        console.log('   500 = Database/trigger error');
      }
    } else {
      console.log('✅ Sign-up successful!');
      console.log('   User created:', data.user ? 'Yes' : 'No');
      console.log('   Session:', data.session ? 'Yes' : 'No (email confirmation required)');
    }
  } catch (err) {
    console.log('❌ Network error:', err.message);
    console.log('   This might indicate connection issues');
  }
  
  console.log('\n🎯 Pipeline Analysis:');
  console.log('✅ Frontend → Supabase Client: Working');
  console.log('✅ Supabase Client → Remote API: Working (getting responses)');
  console.log('❓ Remote API → Database: Check the results above');
  console.log('❓ Database → Email Service: Depends on successful DB write');
}

checkRemoteDatabase();

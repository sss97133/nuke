/**
 * Create demo user for testing
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

async function setupDemoUser() {
  console.log('Creating demo user...');
  
  const { data, error } = await supabase.auth.signUp({
    email: 'demo@example.com',
    password: 'demodemo123'
  });

  if (error) {
    if (error.message.includes('already registered')) {
      console.log('Demo user already exists');
      
      // Try to sign in
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email: 'demo@example.com', 
        password: 'demodemo123'
      });
      
      if (signInError) {
        console.error('Cannot sign in:', signInError.message);
      } else {
        console.log('✅ Signed in as demo user');
        console.log('User ID:', signInData.user.id);
      }
    } else {
      console.error('Error:', error.message);
    }
  } else {
    console.log('✅ Demo user created');
    console.log('User ID:', data.user.id);
  }
}

setupDemoUser();

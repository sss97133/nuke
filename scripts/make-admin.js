import { createClient } from '@supabase/supabase-js';

// Use the same Supabase URL and key as in the main application
const SUPABASE_URL = process.env.SUPABASE_URL || "https://qkgaybvrernstplzjaam.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk";

// Create Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Make a user an admin by updating their user_metadata
 * @param {string} email - The email of the user to make admin
 */
async function makeUserAdmin(email) {
  try {
    console.log(`Attempting to make user ${email} an admin...`);
    
    // First, get the user by email
    const { data: users, error: getUserError } = await supabase
      .from('profiles')
      .select('id, email')
      .eq('email', email)
      .limit(1);
    
    if (getUserError) {
      throw getUserError;
    }
    
    if (!users || users.length === 0) {
      throw new Error(`User with email ${email} not found`);
    }
    
    const userId = users[0].id;
    console.log(`Found user with ID: ${userId}`);
    
    // Try to update the user's metadata using admin API
    let adminSuccess = false;
    try {
      const { error: updateError } = await supabase.auth.admin.updateUserById(
        userId,
        { user_metadata: { is_admin: true } }
      );
      
      if (!updateError) {
        adminSuccess = true;
        console.log('Successfully updated user metadata via admin API');
      } else {
        console.error('Admin API update failed:', updateError.message);
      }
    } catch (adminError) {
      console.error('Admin API not available:', adminError.message);
    }
    
    // If admin API fails, try to update the profile directly
    if (!adminSuccess) {
      console.log('Trying to update profile directly...');
      
      const { error: profileError } = await supabase
        .from('profiles')
        .update({ 
          user_type: 'professional'
        })
        .eq('id', userId);
      
      if (profileError) {
        throw profileError;
      }
      
      console.log('Successfully updated profile');
    }
    
    console.log(`✅ Successfully made ${email} an admin!`);
    return true;
  } catch (error) {
    console.error('❌ Error making user admin:', error.message);
    return false;
  }
}

// Get email from command line arguments
const userEmail = process.argv[2];

if (!userEmail) {
  console.error('Please provide an email address as an argument');
  console.log('Usage: node make-admin.js user@example.com');
  process.exit(1);
}

// Execute the function
makeUserAdmin(userEmail)
  .then(success => {
    if (success) {
      process.exit(0);
    } else {
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('Unexpected error:', error);
    process.exit(1);
  }); 
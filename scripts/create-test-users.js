// Script to create test users for authentication testing
import { createClient } from '@supabase/supabase-js';

// Use the same Supabase URL and key as in the main application
const SUPABASE_URL = process.env.SUPABASE_URL || "https://qkgaybvrernstplzjaam.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk";

// Create Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Create a test user with the given email and password
 * @param {string} email - The email for the test user
 * @param {string} password - The password for the test user
 * @param {Object} userData - Additional user data to store in the profiles table
 * @returns {Promise<Object>} - Result object with success flag and user data or error
 */
async function createTestUser(email, password, userData = {}) {
  console.log(`Creating test user: ${email}`);
  
  try {
    // Create user with Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: userData
      }
    });

    if (authError) {
      console.error(`Error creating user ${email}:`, authError.message);
      return { success: false, error: authError };
    }

    console.log(`Successfully created user: ${email}`);
    
    // Add additional user data to profiles table if needed
    if (authData?.user) {
      const { error: profileError } = await supabase
        .from('profiles')
        .upsert([
          { 
            id: authData.user.id,
            email: authData.user.email,
            username: userData.username || email.split('@')[0],
            full_name: userData.full_name || 'Test User'
          }
        ]);

      if (profileError) {
        console.error(`Error updating profile for ${email}:`, profileError.message);
      }
    }

    return { success: true, user: authData?.user };
  } catch (error) {
    console.error(`Unexpected error creating user ${email}:`, error.message);
    return { success: false, error };
  }
}

// Define test users
const testUsers = [
  {
    email: 'testuser@example.com',
    password: 'Password123!',
    userData: {
      full_name: 'Test User',
      username: 'testuser',
      is_admin: false
    }
  },
  {
    email: 'admin@example.com',
    password: 'Admin123!',
    userData: {
      full_name: 'Admin User',
      username: 'adminuser',
      is_admin: true
    }
  },
  {
    email: 'johndoe@example.com',
    password: 'JohnDoe123!',
    userData: {
      full_name: 'John Doe',
      username: 'johndoe',
      is_admin: false
    }
  },
  {
    email: 'janesmith@example.com',
    password: 'JaneSmith123!',
    userData: {
      full_name: 'Jane Smith',
      username: 'janesmith',
      is_admin: false
    }
  }
];

/**
 * Create all test users
 */
async function createAllTestUsers() {
  console.log('Starting to create test users...');
  
  const results = [];
  
  for (const user of testUsers) {
    const result = await createTestUser(user.email, user.password, user.userData);
    results.push({
      email: user.email,
      success: result.success
    });
  }
  
  console.log('\nSummary of user creation:');
  results.forEach(result => {
    console.log(`${result.email}: ${result.success ? 'SUCCESS' : 'FAILED'}`);
  });
  
  console.log('\nTest users created successfully!');
}

// Execute the function
createAllTestUsers().catch(error => {
  console.error('Error in createAllTestUsers:', error);
}); 
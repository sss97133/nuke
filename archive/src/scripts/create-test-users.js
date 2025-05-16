// Script to create test users for authentication testing
import type { Database } from '../types';
import { supabase } from '../integrations/supabase/client';

/**
 * Creates a test user with the specified email and password
 * @param {string} email - The email for the test user
 * @param {string} password - The password for the test user
 * @param {Object} userData - Additional user data to store in the profiles table
 * @returns {Promise<Object>} - The created user data
 */
async function createTestUser(email, password, userData = {}) {
  console.log(`Creating test user: ${email}`);
  
  try {
    // Sign up the user with Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
      password,
      options: {
        data: {
          full_name: userData.full_name || 'Test User',
          avatar_url: userData.avatar_url || null,
        }
      }
    });

    if (authError) {
      console.error('Error creating user:', authError.message);
      return { success: false, error: authError };
    }

    console.log(`Successfully created user: ${email}`);
    console.log('User ID:', authData.user.id);

    // Add additional user data to profiles table if needed
    if (Object.keys(userData).length > 0) {
      const { error: profileError } = await supabase
        .from('profiles')
        .upsert({
          id: authData.user.id,
          username: userData.username || email.split('@')[0],
          full_name: userData.full_name || 'Test User',
          avatar_url: userData.avatar_url || null,
          ...userData
        });

      if (profileError) {
        console.error('Error updating profile:', profileError.message);
        return { success: true, user: authData.user, profileError };
      }
    }

    return { success: true, user: authData.user };
  } catch (error) {
    console.error('Unexpected error:', error.message);
    return { success: false, error };
  }
}

// Example test users
const testUsers = [
  {
    email: 'test.user1@example.com',
    password: 'Password123!',
    userData: {
      full_name: 'Test User One',
      username: 'testuser1',
    }
  },
  {
    email: 'test.user2@example.com',
    password: 'Password123!',
    userData: {
      full_name: 'Test User Two',
      username: 'testuser2',
    }
  },
  {
    email: 'admin@example.com',
    password: 'AdminPass123!',
    userData: {
      full_name: 'Admin User',
      username: 'admin',
      is_admin: true,
    }
  }
];

// Create all test users
async function createAllTestUsers() {
  console.log('Creating test users...');
  
  for (const user of testUsers) {
    const result = await createTestUser(user.email, user.password, user.userData);
    console.log(`Result for ${user.email}:`, result.success ? 'Success' : 'Failed');
  }
  
  console.log('Finished creating test users');
}

// Run the script
createAllTestUsers().catch(error => {
  console.error('Script failed:', error);
});

// Export for use in other scripts if needed
export { createTestUser, createAllTestUsers }; 
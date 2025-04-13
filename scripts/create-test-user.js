import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from the root .env file
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Error: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set in your .env file');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

const testUserEmail = 'test@example.com';
const testUserPassword = 'password'; // Use a secure password in a real scenario

async function createTestUser() {
  console.log(`Attempting to create test user: ${testUserEmail}`);

  const { data, error } = await supabase.auth.signUp({
    email: testUserEmail,
    password: testUserPassword,
  });

  if (error) {
    if (error.message.includes('User already registered')) {
        console.warn(`User ${testUserEmail} already exists.`);
    } else {
        console.error('Error creating test user:', error.message);
        process.exit(1); // Exit if there was an unexpected error
    }
  } else if (data.user) {
    // Important: Local Supabase might have email confirmation disabled by default.
    // If it's enabled, you'd need to confirm the email or disable confirmation in supabase/config.toml
    console.log(`Successfully created or found user: ${data.user.email}`);
    if (!data.user.email_confirmed_at) {
        console.warn("User created, but email confirmation might be required depending on your Supabase config.");
    }
  } else {
    console.log("Sign up process completed, but no user data was returned. Check Supabase logs if issues persist.");
  }
}

createTestUser();

import { createClient, SupabaseClient, User, AuthError } from '@supabase/supabase-js';
import { config } from 'dotenv';
import type { Database } from '../src/types/database';

// Load environment variables
config();

interface UserData {
  full_name?: string;
  username?: string;
  is_admin?: boolean;
}

interface TestUser {
  email: string;
  password: string;
  userData: UserData;
}

interface CreateUserResult {
  success: boolean;
  user?: User | null;
  error?: {
    message: string;
    status?: number;
  };
}

// Use environment variables with type-safe fallbacks
const SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'dummy-key-for-development';

// Create typed Supabase client
const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY);

async function createTestUser(
  email: string,
  password: string,
  userData: UserData = {}
): Promise<CreateUserResult> {
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
      return { 
        success: false, 
        error: {
          message: authError.message,
          status: 400
        }
      };
    }

    // Add additional user data to profiles table if needed
    if (authData?.user) {
      const { error: profileError } = await supabase
        .from('profiles')
        .upsert([
          { 
            id: authData.user.id,
            email: authData.user.email ?? email,
            username: userData.username || email.split('@')[0],
            full_name: userData.full_name || 'Test User',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            avatar_url: null,
            bio: null,
            ai_analysis: null
          }
        ]);

      if (profileError) {
        return { 
          success: false, 
          error: {
            message: profileError.message,
            status: 500
          }
        };
      }
    }

    return { success: true, user: authData?.user };
  } catch (error) {
    return { 
      success: false, 
      error: {
        message: error instanceof Error ? error.message : String(error),
        status: 500
      }
    };
  }
}

// Define test users with proper typing
const testUsers: TestUser[] = [
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

interface UserCreationResult {
  email: string;
  success: boolean;
}

async function createAllTestUsers(): Promise<void> {
  const results: UserCreationResult[] = [];
  
  for (const user of testUsers) {
    const result = await createTestUser(user.email, user.password, user.userData);
    results.push({
      email: user.email,
      success: result.success
    });
  }
  
  // Log results only in development environment
  if (process.env.NODE_ENV === 'development') {
    results.forEach(result => {
       
      console.log(`${result.email}: ${result.success ? 'SUCCESS' : 'FAILED'}`);
    });
  }
}

// Execute the function
void createAllTestUsers().catch((error: unknown) => {
   
  console.error(
    'Error in createAllTestUsers:',
    error instanceof Error ? error.message : String(error)
  );
});
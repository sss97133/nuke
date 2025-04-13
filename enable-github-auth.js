import { createClient } from '@supabase/supabase-js';

// Supabase Admin credentials - This is for local development only
const supabaseUrl = 'http://127.0.0.1:54321';
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function enableGitHubAuth() {
  try {
    console.log('Attempting to enable GitHub authentication...');
    
    // Use the auth.admin API to update provider settings
    const { data, error } = await supabase.auth.admin.updateConfig({
      config: {
        external: {
          github: {
            enabled: true,
            client_id: 'TEMPORARY_CLIENT_ID', // This will be replaced in Supabase Studio
            secret: 'TEMPORARY_SECRET',        // This will be replaced in Supabase Studio
            redirect_uri: 'http://127.0.0.1:54321/auth/v1/callback'
          }
        }
      }
    });
    
    if (error) {
      throw error;
    }
    
    console.log('✅ GitHub provider enabled successfully!');
    console.log('Now you need to set your actual GitHub OAuth credentials in Supabase Studio:');
    console.log('1. Open http://127.0.0.1:54323');
    console.log('2. Go to Authentication → Providers → GitHub');
    console.log('3. Enter your GitHub OAuth Client ID and Client Secret');
    console.log('4. Make sure the provider is toggled ON');
    
  } catch (error) {
    console.error('❌ Error enabling GitHub provider:', error);
    console.log('\nAlternative method:');
    console.log('1. Open Supabase Studio at http://127.0.0.1:54323');
    console.log('2. Navigate to Authentication → Providers → GitHub');
    console.log('3. Toggle ON the GitHub provider');
    console.log('4. Add a placeholder Client ID and Secret (you can update these later)');
    console.log('5. Save the settings');
  }
}

enableGitHubAuth();

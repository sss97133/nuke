/**
 * Environment Variable Loader
 * 
 * This script helps load environment variables for local development
 * without exposing sensitive data in the codebase.
 */

// Create a global window.__env object to store environment variables
window.__env = window.__env || {};

// If you need to use actual Supabase credentials, replace these with your real values
// IMPORTANT: In production, these should come from GitHub secrets or environment variables
window.__env.VITE_SUPABASE_URL = 'https://your-actual-supabase-url.supabase.co';
window.__env.VITE_SUPABASE_ANON_KEY = 'your-actual-anon-key';

// Add any other environment variables your app needs
window.__env.VITE_APP_VERSION = '1.0.0';

console.log('Environment variables loaded for local development');
console.log('VITE_SUPABASE_URL available:', !!window.__env.VITE_SUPABASE_URL);
console.log('VITE_SUPABASE_ANON_KEY available:', !!window.__env.VITE_SUPABASE_ANON_KEY);

/**
 * NOTE: For your local development, edit this file to include your actual Supabase credentials.
 * Do NOT commit this file with real credentials to version control.
 * In production, the values should come from your environment or GitHub secrets.
 */

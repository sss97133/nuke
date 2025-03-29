// This file injects correct Supabase environment variables directly into the window
// It will be loaded before your app code in index.html

window.__env = window.__env || {};
window.__env.VITE_SUPABASE_URL = 'http://127.0.0.1:54321';
window.__env.VITE_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

console.log('[env-config.js] Loaded Supabase environment variables:', window.__env);

// Add a global reconnection function that your app can use
window.__reconnectSupabase = function() {
  console.log('[env-config.js] Reconnecting to Supabase with:', window.__env);
  return true;
};

// Direct patch to fix Supabase environment variables
// Import and use this at the top of your main.tsx file

// Check for GitHub Actions environment variables first
// If they're not available, fall back to local development values
export const CORRECT_SUPABASE_URL = 
  process?.env?.SUPABASE_URL ||
  import.meta?.env?.VITE_SUPABASE_URL ||
  'http://127.0.0.1:54321';

export const CORRECT_SUPABASE_ANON_KEY = 
  process?.env?.SUPABASE_ANON_KEY ||
  import.meta?.env?.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

export const POSTGRES_CONNECTION = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
export const SUPABASE_STUDIO_URL = 'http://127.0.0.1:54323';

// Force override import.meta.env values 
if (typeof window !== 'undefined') {
  // Create a window.__env object if it doesn't exist
  window.__env = window.__env || {};
  
  // Set the correct values
  window.__env.VITE_SUPABASE_URL = CORRECT_SUPABASE_URL;
  window.__env.VITE_SUPABASE_ANON_KEY = CORRECT_SUPABASE_ANON_KEY;
  
  console.log('Environment overrides applied with correct Supabase credentials');
  
  // Add a diagnostic function to the window object
  window.checkSupabaseHealth = async () => {
    console.log('Checking Supabase services health...');
    const results = {
      auth: false,
      database: false,
      storage: false,
      studio: false,
      portsInUse: [] as number[],
    };
    
    try {
      // Check auth service (port 54321)
      const authCheck = await fetch(`${CORRECT_SUPABASE_URL}/auth/v1/health`, { method: 'GET' })
        .then(res => ({ status: res.status, ok: res.ok }))
        .catch(() => ({ status: 0, ok: false }));
      
      results.auth = authCheck.ok;
      console.log(`Auth service: ${authCheck.ok ? '✅ OK' : '❌ Failed'} (Status: ${authCheck.status})`);
      if (!authCheck.ok) results.portsInUse.push(54321);
      
      // Check REST API (also on port 54321)
      const apiCheck = await fetch(`${CORRECT_SUPABASE_URL}/rest/v1/`, { method: 'GET' })
        .then(res => ({ status: res.status, ok: res.status !== 0 }))
        .catch(() => ({ status: 0, ok: false }));
      
      console.log(`REST API: ${apiCheck.ok ? '✅ OK' : '❌ Failed'} (Status: ${apiCheck.status})`);
      
      // Check Storage (requires bucket name)
      const storageCheck = await fetch(`${CORRECT_SUPABASE_URL}/storage/v1/health`, { method: 'GET' })
        .then(res => ({ status: res.status, ok: res.ok }))
        .catch(() => ({ status: 0, ok: false }));
      
      results.storage = storageCheck.ok;
      console.log(`Storage: ${storageCheck.ok ? '✅ OK' : '❌ Failed'} (Status: ${storageCheck.status})`);
      if (!storageCheck.ok) results.portsInUse.push(54321);
      
      // Determine if we have port conflicts
      if (results.portsInUse.length > 0) {
        console.error(`%c Port conflicts detected! %c Ports ${results.portsInUse.join(', ')} appear to be in use.`, 
          'background: #FF0000; color: white; padding: 2px 4px; border-radius: 2px;', 'color: #FF0000;');
        console.info(`Run these commands to diagnose:
          - Check running containers: docker ps | grep supabase
          - Check port usage: lsof -i :54321-54324
          - Check auth service: curl http://localhost:54321/auth/v1/health`);
        console.info(`Try these fixes:
          - Stop any containers using the same ports
          - Run 'supabase stop' followed by 'supabase start'
          - In extreme cases, reset Docker to factory defaults`);
      } else if (!results.auth) {
        console.error('%c Supabase is not running! %c Run "supabase start" in the project root.', 
          'background: #FF0000; color: white; padding: 2px 4px; border-radius: 2px;', 'color: #FF0000;');
      }
      
      return results;
    } catch (e) {
      console.error('Error checking Supabase health:', e);
      return results;
    }
  };
  
  // Auto-run the health check in development mode
  if (import.meta.env.DEV) {
    setTimeout(() => {
      if (window.checkSupabaseHealth) window.checkSupabaseHealth();
    }, 1000);
  }
}

// For debugging environment variables
export const checkEnv = () => {
  console.log('Checking environment variables:');
  if (typeof window !== 'undefined') {
    console.log('window.__env:', window.__env);
  }
  
  if (typeof import.meta !== 'undefined') {
    console.log('import.meta.env:', {
      ...import.meta.env,
      // Redact sensitive keys for logging
      VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY ? '[REDACTED]' : undefined,
      VITE_SUPABASE_SERVICE_KEY: import.meta.env.VITE_SUPABASE_SERVICE_KEY ? '[REDACTED]' : undefined,
    });
  }
};

// TypeScript declaration for window augmentation
declare global {
  interface Window {
    checkSupabaseHealth?: () => Promise<{
      auth: boolean;
      database: boolean;
      storage: boolean;
      studio: boolean;
      portsInUse: number[];
    }>;
  }
}

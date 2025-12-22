// Centralized environment access for the frontend.
//
// Important:
// - Vite only exposes variables with allowed prefixes at build time.
// - We support both the Vite-default `VITE_` prefix and legacy `SUPABASE_` names
//   (via `envPrefix` in `vite.config.ts`) to avoid "missing env" production deploys.

type ViteEnv = Record<string, any>;

function readEnv(key: string): string | null {
  const env = (import.meta as any)?.env as ViteEnv | undefined;
  const v = env?.[key];
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s : null;
}

// Initialize all env vars in a single IIFE to prevent TDZ issues
const envVars = (() => {
  const url = readEnv('VITE_SUPABASE_URL') ||
    readEnv('SUPABASE_URL') ||
    'https://qkgaybvrernstplzjaam.supabase.co';
  
  const key = readEnv('VITE_SUPABASE_ANON_KEY') ||
    readEnv('SUPABASE_ANON_KEY') ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk';
  
  return { url, key };
})();

export const SUPABASE_URL: string = envVars.url;
export const SUPABASE_ANON_KEY: string = envVars.key;



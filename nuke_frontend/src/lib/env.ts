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

export const SUPABASE_URL =
  readEnv('VITE_SUPABASE_URL') ||
  readEnv('SUPABASE_URL') ||
  // Last-resort default for production reliability (anon keys are public by design).
  'https://qkgaybvrernstplzjaam.supabase.co';

export const SUPABASE_ANON_KEY =
  readEnv('VITE_SUPABASE_ANON_KEY') ||
  readEnv('SUPABASE_ANON_KEY') ||
  // Last-resort default for production reliability (anon keys are public by design).
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk';



// Centralized environment access for the frontend.
//
// Important:
// - Vite only exposes variables with allowed prefixes at build time.
// - We support both the Vite-default `VITE_` prefix and legacy `SUPABASE_` names
//   (via `envPrefix` in `vite.config.ts`) to avoid "missing env" production deploys.

// Vite inlines only static `import.meta.env.NAME` references at build time. The optional-chaining read this file
// used until 2026-10-14 (`import.meta?.env?.[key]`) was never replaced, so in the browser it returned null and the
// client always ran on the hardcoded fallback, whatever the deploy's env said.
// Plain Node has no import.meta.env (scripts in nuke_frontend/scripts import this file), so a read there throws and
// counts as unset. In a Vite build each read is the replaced literal and cannot throw.
function read(get: () => unknown): string | null {
  try {
    const v = get();
    if (typeof v !== 'string') return null;
    const s = v.trim();
    return s ? s : null;
  } catch {
    return null;
  }
}

// Initialize all env vars in a single IIFE to prevent TDZ issues
const envVars = (() => {
  const url = read(() => import.meta.env.VITE_SUPABASE_URL) ||
    read(() => import.meta.env.SUPABASE_URL) ||
    'https://qkgaybvrernstplzjaam.supabase.co';

  // The fallback is the project's publishable key, public by design: it ships in every page. The legacy anon JWT
  // that stood here stops working when the legacy API keys are disabled (key switch, 2026-10-14).
  const key = read(() => import.meta.env.VITE_SUPABASE_ANON_KEY) ||
    read(() => import.meta.env.SUPABASE_ANON_KEY) ||
    'sb_publishable_jJ4IIdHqsgd7Gd5c55t-5g_SceqkkXU';

  return { url, key };
})();

export const SUPABASE_URL: string = envVars.url;
export const SUPABASE_ANON_KEY: string = envVars.key;



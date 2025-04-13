// Create src/lib/environment.ts
interface RuntimeEnvironment {
  VITE_SUPABASE_URL: string;
  VITE_SUPABASE_ANON_KEY: string;
  VITE_ENV: string;
  VITE_ENABLE_DEBUG: boolean;
  VITE_BUILD_TIME: string;
}

// Access window.__env dynamically and perform type checks
const runtimeEnv = (window as any).__env;

export const getEnvironment = (): RuntimeEnvironment => {
  let env: RuntimeEnvironment;

  if (runtimeEnv && typeof runtimeEnv === 'object') {
    // Use properties from window.__env if they exist and have the correct type
    env = {
      VITE_SUPABASE_URL: typeof runtimeEnv.VITE_SUPABASE_URL === 'string' 
        ? runtimeEnv.VITE_SUPABASE_URL 
        : import.meta.env.VITE_SUPABASE_URL || '',
      VITE_SUPABASE_ANON_KEY: typeof runtimeEnv.VITE_SUPABASE_ANON_KEY === 'string' 
        ? runtimeEnv.VITE_SUPABASE_ANON_KEY 
        : import.meta.env.VITE_SUPABASE_ANON_KEY || '',
      VITE_ENV: typeof runtimeEnv.VITE_ENV === 'string' 
        ? runtimeEnv.VITE_ENV 
        : import.meta.env.VITE_ENV || 'production',
      // Handle boolean or string 'true' for debug flag
      VITE_ENABLE_DEBUG: runtimeEnv.VITE_ENABLE_DEBUG === true || runtimeEnv.VITE_ENABLE_DEBUG === 'true' 
        ? true 
        : import.meta.env.VITE_ENABLE_DEBUG === 'true',
      VITE_BUILD_TIME: typeof runtimeEnv.VITE_BUILD_TIME === 'string' 
        ? runtimeEnv.VITE_BUILD_TIME 
        : import.meta.env.VITE_BUILD_TIME || new Date().toISOString(),
    };
  } else {
    // Fallback entirely to import.meta.env if window.__env is not usable
    env = {
      VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL || '',
      VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
      VITE_ENV: import.meta.env.VITE_ENV || 'production',
      VITE_ENABLE_DEBUG: import.meta.env.VITE_ENABLE_DEBUG === 'true',
      VITE_BUILD_TIME: import.meta.env.VITE_BUILD_TIME || new Date().toISOString(),
    };
  }

  return env;
}; 
// Create src/lib/environment.ts
interface RuntimeEnvironment {
  VITE_SUPABASE_URL: string;
  VITE_SUPABASE_ANON_KEY: string;
  VITE_ENV: string;
  VITE_ENABLE_DEBUG: boolean;
  VITE_BUILD_TIME: string;
}

// Access window.__env dynamically and perform type checks
const runtimeEnv = (window as unknown as { [key: string]: unknown }).__env ?? {};

export const getEnvironment = (): RuntimeEnvironment => {
  let env: RuntimeEnvironment;

  if (runtimeEnv && typeof runtimeEnv === 'object') {
    // Use properties from window.__env if they exist and have the correct type
    env = {
      VITE_SUPABASE_URL: typeof (runtimeEnv as Record<string, unknown>)["VITE_SUPABASE_URL"] === 'string' 
        ? (runtimeEnv as Record<string, unknown>)["VITE_SUPABASE_URL"] as string
        : import.meta.env.VITE_SUPABASE_URL || '',
      VITE_SUPABASE_ANON_KEY: typeof (runtimeEnv as Record<string, unknown>)["VITE_SUPABASE_ANON_KEY"] === 'string' 
        ? (runtimeEnv as Record<string, unknown>)["VITE_SUPABASE_ANON_KEY"] as string
        : import.meta.env.VITE_SUPABASE_ANON_KEY || '',
      VITE_ENV: typeof (runtimeEnv as Record<string, unknown>)["VITE_ENV"] === 'string' 
        ? (runtimeEnv as Record<string, unknown>)["VITE_ENV"] as string
        : import.meta.env.VITE_ENV || 'production',
      // Handle boolean or string 'true' for debug flag
      VITE_ENABLE_DEBUG: (runtimeEnv as Record<string, unknown>)["VITE_ENABLE_DEBUG"] === true || (runtimeEnv as Record<string, unknown>)["VITE_ENABLE_DEBUG"] === 'true' 
        ? true 
        : import.meta.env.VITE_ENABLE_DEBUG === 'true',
      VITE_BUILD_TIME: typeof (runtimeEnv as Record<string, unknown>)["VITE_BUILD_TIME"] === 'string' 
        ? (runtimeEnv as Record<string, unknown>)["VITE_BUILD_TIME"] as string 
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
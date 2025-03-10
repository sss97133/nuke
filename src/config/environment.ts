export type Environment = 'development' | 'test' | 'production';

interface EnvironmentConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  environment: Environment;
  isDevelopment: boolean;
  isTest: boolean;
  isProduction: boolean;
}

const environment = (import.meta.env.VITE_ENV as Environment) || 'development';

// Log environment information during initialization
console.log(`Initializing app in ${environment} environment`);

// Default to empty strings - actual values should be provided through environment variables
export const config: EnvironmentConfig = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL || 'http://localhost:54321',
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-key',
  environment,
  isDevelopment: environment === 'development',
  isTest: environment === 'test',
  isProduction: environment === 'production',
};

// Log Supabase configuration (without exposing sensitive data)
console.log('Supabase Configuration:', {
  url: config.supabaseUrl,
  environment: config.environment,
  isDevelopment: config.isDevelopment,
  isTest: config.isTest,
  isProduction: config.isProduction,
});

// Validate environment variables
const requiredEnvVars = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
] as const;

for (const envVar of requiredEnvVars) {
  if (!import.meta.env[envVar]) {
    const message = `Missing required environment variable: ${envVar}`;
    console.error(message);
    
    if (environment === 'production') {
      throw new Error(message);
    } else {
      console.warn('Using default values in development mode. Some features may not work correctly.');
    }
  }
}

// Validate Supabase URL format
const isValidUrl = (url: string) => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

if (!isValidUrl(config.supabaseUrl)) {
  const message = 'Invalid Supabase URL format';
  console.error(message, config.supabaseUrl);
  
  if (environment === 'production') {
    throw new Error(message);
  }
}

export default config; 
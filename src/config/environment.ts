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

// Default to empty strings - actual values should be provided through environment variables
export const config: EnvironmentConfig = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL || 'http://localhost:54321',
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-key',
  environment,
  isDevelopment: environment === 'development',
  isTest: environment === 'test',
  isProduction: environment === 'production',
};

// Validate required environment variables in production
if (environment === 'production') {
  const requiredEnvVars = [
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_ANON_KEY',
  ] as const;

  for (const envVar of requiredEnvVars) {
    if (!import.meta.env[envVar]) {
      throw new Error(`Missing required environment variable: ${envVar}`);
    }
  }
}

export default config; 
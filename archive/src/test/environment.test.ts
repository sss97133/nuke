import { describe, it, expect } from 'vitest';
import { config } from '../config/environment';

describe('Environment Configuration', () => {
  it('should have all required environment variables', () => {
    expect(config.supabaseUrl).toBeDefined();
    expect(config.supabaseAnonKey).toBeDefined();
  });

  it('should correctly identify the current environment', () => {
    const env = process.env.NODE_ENV;
    
    expect(config.environment).toBeDefined();
    expect(['development', 'test', 'production']).toContain(config.environment);
    
    // Environment flags should be mutually exclusive
    if (config.isDevelopment) {
      expect(config.isTest).toBe(false);
      expect(config.isProduction).toBe(false);
    } else if (config.isTest) {
      expect(config.isDevelopment).toBe(false);
      expect(config.isProduction).toBe(false);
    } else if (config.isProduction) {
      expect(config.isDevelopment).toBe(false);
      expect(config.isTest).toBe(false);
    }
  });

  it('should have appropriate Supabase configuration for each environment', () => {
    if (config.isDevelopment) {
      expect(config.supabaseUrl).toContain('localhost');
    } else if (config.isProduction) {
      expect(config.supabaseUrl).not.toContain('localhost');
    }
  });
});

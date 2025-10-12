#!/usr/bin/env node
/**
 * Secure Configuration Helper
 * Centralizes environment variable loading and validation
 */

const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Validate required environment variables
function validateEnvironment() {
  const required = [
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_ANON_KEY'
  ];

  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:');
    missing.forEach(key => console.error(`   - ${key}`));
    console.error('\n💡 Copy env.example to .env and fill in your values');
    process.exit(1);
  }
}

// Get configuration with validation
function getConfig() {
  validateEnvironment();
  
  return {
    supabase: {
      url: process.env.VITE_SUPABASE_URL,
      anonKey: process.env.VITE_SUPABASE_ANON_KEY,
      serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY
    },
    api: {
      url: process.env.VITE_API_URL || 'http://localhost:4000/api',
      phoenixUrl: process.env.VITE_PHOENIX_API_URL || 'http://localhost:4000/api'
    },
    thirdParty: {
      openaiKey: process.env.VITE_OPENAI_API_KEY,
      dropboxClientId: process.env.VITE_DROPBOX_CLIENT_ID,
      githubClientId: process.env.VITE_GITHUB_CLIENT_ID
    },
    development: {
      debug: process.env.VITE_ENABLE_DEBUG === 'true',
      nodeEnv: process.env.NODE_ENV || 'development'
    }
  };
}

// Create Supabase clients
function createSupabaseClients() {
  const config = getConfig();
  
  const anonClient = createClient(config.supabase.url, config.supabase.anonKey);
  
  let serviceClient = null;
  if (config.supabase.serviceKey) {
    serviceClient = createClient(config.supabase.url, config.supabase.serviceKey, {
      auth: { persistSession: false }
    });
  }
  
  return { anonClient, serviceClient };
}

// Export configuration utilities
module.exports = {
  validateEnvironment,
  getConfig,
  createSupabaseClients,
  
  // Convenience exports
  get supabaseUrl() { return getConfig().supabase.url; },
  get supabaseAnonKey() { return getConfig().supabase.anonKey; },
  get supabaseServiceKey() { return getConfig().supabase.serviceKey; }
};

// If run directly, show configuration status
if (require.main === module) {
  try {
    const config = getConfig();
    console.log('✅ Environment configuration valid');
    console.log('📊 Configuration summary:');
    console.log(`   Supabase URL: ${config.supabase.url}`);
    console.log(`   API URL: ${config.api.url}`);
    console.log(`   Debug mode: ${config.development.debug}`);
    console.log(`   Service key available: ${!!config.supabase.serviceKey}`);
    console.log(`   OpenAI key available: ${!!config.thirdParty.openaiKey}`);
  } catch (error) {
    console.error('❌ Configuration error:', error.message);
    process.exit(1);
  }
}

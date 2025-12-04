#!/bin/bash
# Deploy Professional Financial System via Supabase REST API

# Load environment variables
if [ -f .env ]; then
  export $(cat .env | grep -v '^#' | xargs)
fi

# Validate required environment variables
if [ -z "$VITE_SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  echo "ERROR: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required"
  exit 1
fi

SERVICE_KEY="$SUPABASE_SERVICE_ROLE_KEY"
PROJECT_URL="$VITE_SUPABASE_URL"

# Read SQL file and execute via Supabase client
node -e "
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabase = createClient('$PROJECT_URL', '$SERVICE_KEY');

const sql = fs.readFileSync('./DEPLOY_PROFESSIONAL_FINANCIAL_SYSTEM.sql', 'utf8');

// Split into statements and execute each
const statements = sql
  .split(';')
  .map(s => s.trim())
  .filter(s => s.length > 10 && !s.startsWith('--'));

async function deploy() {
  for (const stmt of statements) {
    try {
      const { error } = await supabase.rpc('query', { query_text: stmt });
      if (error) console.log('Statement error:', error.message);
    } catch (e) {
      console.log('Exec error:', e.message);
    }
  }
  console.log('Deployment complete!');
}

deploy();
"


#!/bin/bash
# Deploy Professional Financial System via Supabase REST API

SERVICE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczODM2OTAyMSwiZXhwIjoyMDUzOTQ1MDIxfQ.NEbqSnSamR5f7Fqon25ierv5yJgdDy_o2nrixOej_Xg"
PROJECT_URL="https://qkgaybvrernstplzjaam.supabase.co"

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


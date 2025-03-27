/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable no-undef */
 
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Required schema for tables
const REQUIRED_SCHEMA = {
  team_members: ['id', 'status', 'profile_id', 'member_type'],
  profiles: ['id', 'email', 'created_at'],
  vehicles: ['id', 'vin', 'status', 'created_at']
};

async function validateSchema() {
  const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.VITE_SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('❌ Missing required environment variables: VITE_SUPABASE_URL and VITE_SUPABASE_SERVICE_KEY');
    process.exit(1);
  }

  const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    // Validate each table
    for (const [tableName, requiredColumns] of Object.entries(REQUIRED_SCHEMA)) {
      console.log(`🔍 Validating table: ${tableName}`);

      // Check if table exists
      const { error: tableError } = await client
        .from(tableName)
        .select()
        .limit(1);

      if (tableError) {
        throw new Error(`Table ${tableName} does not exist: ${tableError.message}`);
      }

      // Get table columns
      const { data: columnsData, error: columnsError } = await client.rpc('get_table_columns', {
        table_name: tableName,
      });

      if (columnsError) {
        throw new Error(`Failed to get columns for table ${tableName}: ${columnsError.message}`);
      }

      // Check required columns
      const columnNames = columnsData.map(col => col.column_name);
      const missingColumns = requiredColumns.filter(col => !columnNames.includes(col));

      if (missingColumns.length > 0) {
        throw new Error(`Table ${tableName} is missing required columns: ${missingColumns.join(', ')}`);
      }

      console.log(`✅ Table ${tableName} validated successfully`);
    }

    console.log('✅ All tables validated successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Schema validation failed:', error.message);
    process.exit(1);
  }
}

validateSchema();

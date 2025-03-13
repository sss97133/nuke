import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import type { Database } from '../src/types';

// Load environment variables
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.VITE_SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing required environment variables: VITE_SUPABASE_URL and VITE_SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_KEY);

/**
 * Validates the database schema against expected structure
 */
async function validateSchema() {
  console.log('🔍 Starting database schema validation...');

  // List of critical tables and their required columns
  const requiredSchema = {
    'team_members': ['id', 'status', 'profile_id', 'member_type'],
    'profiles': ['id', 'email', 'created_at'],
    'vehicles': ['id', 'vin', 'status', 'created_at'],
    // Add more tables and required columns as needed
  };

  // Verify each table
  for (const [tableName, requiredColumns] of Object.entries(requiredSchema)) {
    try {
      console.log(`📋 Checking table: ${tableName}`);
      
      // Query to get a single row (limit 0) just to validate structure
      const { data, error } = await supabase
        .from(tableName)
        .select('*')
        .limit(0);
        
      if (error) {
        console.error(`❌ Error accessing table ${tableName}: ${error.message}`);
        process.exit(1);
      }
      
      // Validate columns by checking table information
      const { data: columnsData, error: columnsError } = await supabase
        .rpc('get_table_columns', { 
          table_name: tableName 
        });
      
      if (columnsError) {
        console.error(`❌ Error getting columns for ${tableName}: ${columnsError.message}`);
        console.log('Make sure the get_table_columns RPC function exists in your database');
        process.exit(1);
      }
      
      // If RPC is not available, create it
      if (!columnsData) {
        console.warn('⚠️ get_table_columns RPC function not found, creating it...');
        await createTableColumnsFunction();
        
        // Try again
        const { data: retryData, error: retryError } = await supabase
          .rpc('get_table_columns', { 
            table_name: tableName 
          });
          
        if (retryError || !retryData) {
          console.error('❌ Failed to create and use get_table_columns function');
          process.exit(1);
        }
        
        columnsData = retryData;
      }
      
      // Get actual column names
      const actualColumns = columnsData.map(col => col.column_name);
      
      // Check missing columns
      const missingColumns = requiredColumns.filter(col => !actualColumns.includes(col));
      
      if (missingColumns.length > 0) {
        console.error(`❌ Table ${tableName} is missing required columns: ${missingColumns.join(', ')}`);
        console.error('Run the appropriate migration script to add these columns');
        process.exit(1);
      }
      
      console.log(`✅ Table ${tableName} validated successfully`);
    } catch (err) {
      console.error(`❌ Unexpected error validating ${tableName}:`, err);
      process.exit(1);
    }
  }
  
  console.log('✅ Database schema validation completed successfully');
}

/**
 * Creates the get_table_columns function in the database if it doesn't exist
 */
async function createTableColumnsFunction() {
  const { error } = await supabase.rpc('create_table_columns_function');
  
  if (error) {
    // Function doesn't exist, create it directly
    const { error: createError } = await supabase.sql(`
      CREATE OR REPLACE FUNCTION get_table_columns(table_name TEXT)
      RETURNS TABLE (
        column_name TEXT,
        data_type TEXT,
        is_nullable BOOLEAN
      ) AS $$
      BEGIN
        RETURN QUERY SELECT 
          c.column_name::TEXT,
          c.data_type::TEXT,
          (c.is_nullable = 'YES')::BOOLEAN
        FROM 
          information_schema.columns c
        WHERE 
          c.table_schema = 'public' AND
          c.table_name = table_name;
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER;
      
      -- Helper function to create the above function
      CREATE OR REPLACE FUNCTION create_table_columns_function()
      RETURNS VOID AS $$
      BEGIN
        -- This is just a dummy function to check if get_table_columns exists
        NULL;
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER;
    `);
    
    if (createError) {
      console.error('❌ Failed to create database helper functions:', createError);
      throw createError;
    }
  }
}

// Run the validation
validateSchema().catch(err => {
  console.error('❌ Schema validation failed:', err);
  process.exit(1);
});

#!/usr/bin/env node

/**
 * This script generates TypeScript type definitions from your Supabase database schema.
 * It uses the supabase-js client to introspect your database and generate the types.
 * 
 * Prerequisites:
 * - Valid Supabase URL and service key in environment variables
 * - Write access to the src/types directory
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the current file's directory path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Environment variables for Supabase connection
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.VITE_SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials. Set VITE_SUPABASE_URL and VITE_SUPABASE_SERVICE_KEY environment variables.');
  process.exit(1);
}

// Initialize the Supabase client with service key
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Output file path
const outputDir = path.join(__dirname, '..', 'src', 'types');
const outputFile = path.join(outputDir, 'database.ts');

// Make sure the directory exists
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

async function generateTypes() {
  try {
    console.log('🔍 Fetching schema from Supabase...');
    
    // Get all tables
    const { data: tables, error: tablesError } = await supabase
      .from('_schema')
      .select('*');
    
    if (tablesError) {
      console.error('❌ Failed to fetch schema:', tablesError.message);
      process.exit(1);
    }
    
    // Get columns for each table
    const schema = {};
    
    for (const table of tables) {
      const { data: columns, error: columnsError } = await supabase
        .from('_schema_columns')
        .select('*')
        .eq('table', table.name);
      
      if (columnsError) {
        console.error(`❌ Failed to fetch columns for table ${table.name}:`, columnsError.message);
        continue;
      }
      
      schema[table.name] = columns;
    }
    
    // Generate TypeScript definitions
    let typeDefinitions = `/**
 * This file was auto-generated from your Supabase database schema.
 * Do not modify this file directly as it will be overwritten.
 * Generated on: ${new Date().toISOString()}
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
`;

    // Add table definitions
    for (const [tableName, columns] of Object.entries(schema)) {
      typeDefinitions += `      ${tableName}: {\n`;
      typeDefinitions += `        Row: {\n`;
      
      // Add column definitions
      for (const column of columns) {
        let tsType = 'unknown';
        
        // Map PostgreSQL types to TypeScript types
        switch (column.data_type.toLowerCase()) {
          case 'integer':
          case 'numeric':
          case 'real':
          case 'smallint':
          case 'bigint':
          case 'double precision':
            tsType = 'number';
            break;
          case 'text':
          case 'character varying':
          case 'character':
          case 'citext':
          case 'name':
            tsType = 'string';
            break;
          case 'boolean':
            tsType = 'boolean';
            break;
          case 'json':
          case 'jsonb':
            tsType = 'Json';
            break;
          case 'timestamp with time zone':
          case 'timestamp without time zone':
          case 'date':
            tsType = 'string';
            break;
          default:
            tsType = 'unknown';
        }
        
        const nullable = column.is_nullable === 'YES' ? ' | null' : '';
        typeDefinitions += `          ${column.name}: ${tsType}${nullable};\n`;
      }
      
      typeDefinitions += `        };\n`;
      typeDefinitions += `        Insert: {\n`;
      
      // Add Insert type (similar to Row but with more nullable fields for optional inserts)
      for (const column of columns) {
        let tsType = 'unknown';
        
        switch (column.data_type.toLowerCase()) {
          case 'integer':
          case 'numeric':
          case 'real':
          case 'smallint':
          case 'bigint':
          case 'double precision':
            tsType = 'number';
            break;
          case 'text':
          case 'character varying':
          case 'character':
          case 'citext':
          case 'name':
            tsType = 'string';
            break;
          case 'boolean':
            tsType = 'boolean';
            break;
          case 'json':
          case 'jsonb':
            tsType = 'Json';
            break;
          case 'timestamp with time zone':
          case 'timestamp without time zone':
          case 'date':
            tsType = 'string';
            break;
          default:
            tsType = 'unknown';
        }
        
        // Make more fields optional for inserts, especially if they have defaults
        const optional = column.column_default !== null || column.is_nullable === 'YES';
        const nullOrUndefined = optional ? ' | null | undefined' : '';
        
        typeDefinitions += `          ${column.name}${optional ? '?' : ''}: ${tsType}${nullOrUndefined};\n`;
      }
      
      typeDefinitions += `        };\n`;
      typeDefinitions += `        Update: {\n`;
      
      // Add Update type (all fields optional)
      for (const column of columns) {
        let tsType = 'unknown';
        
        switch (column.data_type.toLowerCase()) {
          case 'integer':
          case 'numeric':
          case 'real':
          case 'smallint':
          case 'bigint':
          case 'double precision':
            tsType = 'number';
            break;
          case 'text':
          case 'character varying':
          case 'character':
          case 'citext':
          case 'name':
            tsType = 'string';
            break;
          case 'boolean':
            tsType = 'boolean';
            break;
          case 'json':
          case 'jsonb':
            tsType = 'Json';
            break;
          case 'timestamp with time zone':
          case 'timestamp without time zone':
          case 'date':
            tsType = 'string';
            break;
          default:
            tsType = 'unknown';
        }
        
        typeDefinitions += `          ${column.name}?: ${tsType} | null | undefined;\n`;
      }
      
      typeDefinitions += `        };\n`;
      typeDefinitions += `      };\n`;
    }
    
    typeDefinitions += `    };\n`;
    typeDefinitions += `    Views: {\n`;
    
    // Get views
    const { data: views, error: viewsError } = await supabase
      .from('_schema_views')
      .select('*');
    
    if (!viewsError && views && views.length > 0) {
      for (const view of views) {
        typeDefinitions += `      ${view.name}: {\n`;
        typeDefinitions += `        Row: Record<string, unknown>;\n`;
        typeDefinitions += `      };\n`;
      }
    }
    
    typeDefinitions += `    };\n`;
    typeDefinitions += `    Functions: Record<string, unknown>;\n`;
    typeDefinitions += `    Enums: Record<string, unknown>;\n`;
    typeDefinitions += `  };\n`;
    typeDefinitions += `}\n`;
    
    // Write the TypeScript definitions to the output file
    fs.writeFileSync(outputFile, typeDefinitions);
    
    console.log(`✅ TypeScript definitions generated successfully: ${outputFile}`);
    return true;
  } catch (error) {
    console.error('❌ Error generating types:', error.message);
    return false;
  }
}

generateTypes()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((error) => {
    console.error('❌ Uncaught error:', error);
    process.exit(1);
  });

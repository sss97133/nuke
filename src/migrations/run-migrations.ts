import { supabase } from '../integrations/supabase/client';
import fs from 'fs';
import path from 'path';

/**
 * Migration Runner for Vehicle-Centric Architecture
 * 
 * This script handles database migrations for the Nuke project, ensuring
 * that the database schema stays in sync with the application's needs.
 * It supports the vehicle-centric architecture by maintaining proper tables
 * for vehicle identity and timeline events.
 */

// Helper function to read and execute a SQL file
const executeSQLFile = async (filePath: string): Promise<void> => {
  try {
    // Read the SQL file
    const sql = fs.readFileSync(filePath, 'utf8');
    
    // Split SQL into individual statements
    const statements = sql.split(';')
      .map(statement => statement.trim())
      .filter(statement => statement.length > 0);
    
    // Execute each statement
    for (const statement of statements) {
      console.log(`Executing SQL: ${statement.substring(0, 100)}...`);
      
      const { error } = await supabase.rpc('exec_sql', { 
        sql_query: statement 
      });
      
      if (error) {
        console.error(`Error executing SQL: ${error.message}`);
        throw error;
      }
    }
    
    console.log(`Successfully executed SQL from ${filePath}`);
  } catch (error) {
    console.error(`Failed to execute SQL file ${filePath}:`, error);
    throw error;
  }
};

// Run all migrations
const runMigrations = async (): Promise<void> => {
  console.log('Starting database migrations...');
  
  try {
    // First, create a migrations table if it doesn't exist
    const { error: migrationTableError } = await supabase.rpc('exec_sql', { 
      sql_query: `
        CREATE TABLE IF NOT EXISTS public.migrations (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL UNIQUE,
          applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `
    });
    
    if (migrationTableError) {
      console.error('Error creating migrations table:', migrationTableError);
      return;
    }
    
    // Get a list of applied migrations
    const { data: appliedMigrations, error: fetchError } = await supabase
      .from('migrations')
      .select('name');
    
    if (fetchError) {
      console.error('Error fetching applied migrations:', fetchError);
      return;
    }
    
    const appliedMigrationNames = appliedMigrations?.map(m => m.name) || [];
    
    // Get a list of migration files
    const migrationsDir = path.join(__dirname, '../../migrations');
    const migrationFiles = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort(); // Sort to ensure migrations run in order
    
    // Run migrations that haven't been applied yet
    for (const file of migrationFiles) {
      if (!appliedMigrationNames.includes(file)) {
        console.log(`Applying migration: ${file}`);
        const filePath = path.join(migrationsDir, file);
        
        try {
          await executeSQLFile(filePath);
          
          // Record the migration
          const { error: insertError } = await supabase
            .from('migrations')
            .insert({ name: file });
          
          if (insertError) {
            console.error(`Error recording migration ${file}:`, insertError);
          } else {
            console.log(`Migration ${file} successfully applied and recorded`);
          }
        } catch (error) {
          console.error(`Migration ${file} failed:`, error);
          // Don't process further migrations if one fails
          break;
        }
      } else {
        console.log(`Migration ${file} already applied, skipping`);
      }
    }
    
    console.log('Database migration process completed');
  } catch (error) {
    console.error('Migration process failed:', error);
  }
};

// Run migrations when this file is executed directly
if (require.main === module) {
  runMigrations()
    .then(() => {
      console.log('Migrations completed');
      process.exit(0);
    })
    .catch(error => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

export { runMigrations };

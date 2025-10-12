import { createClient } from '@supabase/supabase-js';

// Get environment variables with fallbacks
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Validate environment variables
if (!supabaseUrl || !supabaseAnonKey) {
  console.error('❌ Missing Supabase environment variables:');
  console.error('VITE_SUPABASE_URL:', supabaseUrl ? '✅ Set' : '❌ Missing');
  console.error('VITE_SUPABASE_ANON_KEY:', supabaseAnonKey ? '✅ Set' : '❌ Missing');
  throw new Error('Supabase environment variables are required');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export interface TableInfo {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
  character_maximum_length: number | null;
}

export interface TableAudit {
  tableName: string;
  columns: TableInfo[];
  rowCount: number;
  conflicts: string[];
  recommendations: string[];
}

export async function auditDatabase(): Promise<TableAudit[]> {
  const results: TableAudit[] = [];
  
  try {
    console.log('🔍 Starting comprehensive database audit...');
    
    // Use the most reliable method - test table names directly
    const tables = await discoverTablesFromCommonNames();
    
    console.log(`📋 Found ${tables.length} tables in database`);
    
    // Audit each table
    for (const table of tables) {
      const tableName = table.table_name;
      console.log(`\n🔍 Auditing table: ${tableName}`);
      
      const audit = await auditTable(tableName);
      results.push(audit);
    }
    
    // Generate summary report
    generateSummaryReport(results);
    
  } catch (error) {
    console.error('Database audit failed:', error);
  }
  
  return results;
}

async function discoverTablesFromSchema(): Promise<any[]> {
  try {
    console.log('🔍 Querying information_schema for all tables...');
    
    // Try different approaches to query the schema
    const queries = [
      // Standard information_schema query
      `SELECT table_name 
       FROM information_schema.tables 
       WHERE table_schema = 'public' 
       AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
      
      // Alternative with more details
      `SELECT DISTINCT t.table_name
       FROM information_schema.tables t
       WHERE t.table_schema = 'public'
       AND t.table_type = 'BASE TABLE'`,
      
      // Simple table list
      `SELECT tablename as table_name 
       FROM pg_tables 
       WHERE schemaname = 'public'`
    ];
    
    for (const query of queries) {
      try {
        const { data, error } = await supabase.rpc('exec_sql', { sql: query });
        
        if (!error && data && data.length > 0) {
          console.log(`✅ Schema query successful: Found ${data.length} tables`);
          return data;
        }
      } catch (error) {
        console.log(`⚠️ Schema query failed: ${error}`);
        continue;
      }
    }
    
    // If RPC fails, try direct SQL (this might not work due to RLS)
    try {
      const { data, error } = await supabase
        .from('information_schema.tables')
        .select('table_name')
        .eq('table_schema', 'public')
        .eq('table_type', 'BASE_TABLE');
      
      if (!error && data && data.length > 0) {
        console.log(`✅ Direct schema query successful: Found ${data.length} tables`);
        return data;
      }
    } catch (error) {
      console.log(`⚠️ Direct schema query failed: ${error}`);
    }
    
  } catch (error) {
    console.log(`⚠️ Schema discovery failed: ${error}`);
  }
  
  return [];
}

async function discoverTablesFromRPC(): Promise<any[]> {
  try {
    console.log('🔍 Trying RPC method to get table list...');
    
    // Try to call the custom function that lists tables
    const { data, error } = await supabase.rpc('get_all_tables');
    
    if (!error && data && data.length > 0) {
      console.log(`✅ RPC method successful: Found ${data.length} tables`);
      return data.map((row: any) => ({ 
        table_name: row.table_name,
        table_type: row.table_type,
        row_count: row.row_count,
        column_count: row.column_count
      }));
    }
    
    // If the custom function doesn't exist, try a simpler approach
    console.log('⚠️ Custom RPC function not found, trying alternative...');
    
  } catch (error) {
    console.log(`⚠️ RPC method failed: ${error}`);
  }
  
  return [];
}

async function discoverTablesFromCommonNames(): Promise<any[]> {
  console.log('🔍 Discovering tables by testing common names...');
  
  // Complete list of all 75 tables from your Supabase database
  const commonTableNames = [
    // Core tables
    'profiles', 'vehicles', 'vehicle_images',
    
    // AI and agents
    'agent_actions', 'ai_agents', 'ai_explanations',
    'algorithm_preferences',
    
    // Content and media
    'assets', 'captures', 'content_analytics',
    'content_interactions', 'content_schedules',
    'live_streams', 'streaming_sessions',
    'stream_comments', 'stream_tips',
    
    // Marketplace and commerce
    'auction_bids', 'auction_comments', 'auctions',
    'marketplace_comments', 'marketplace_listings',
    'marketplace_preferences', 'marketplace_saved_listings',
    
    // Community and social
    'dao_proposals', 'dao_votes', 'proposal_votes',
    'garages', 'garage_members',
    'shop_invitations', 'shop_members', 'shops',
    'team_members', 'project_collaborators',
    
    // Projects and development
    'development_goals', 'project_tasks', 'project_updates',
    'projects', 'test_cases', 'test_executions',
    
    // Analytics and engagement
    'engagement_metrics', 'feed_interactions', 'feed_items',
    'user_interactions', 'user_achievements',
    'vehicle_engagement', 'vehicle_history',
    
    // User preferences and settings
    'user_certifications', 'user_content_preferences',
    'user_preferences', 'user_roles', 'user_sessions',
    'user_skills', 'certifications', 'skills',
    
    // Business and operations
    'automotive_locations', 'derivatives',
    'governance_proposals', 'inventory_items',
    'service_tickets', 'suppliers',
    'studio_configurations', 'verified_locations',
    
    // Token and financial
    'token_analytics', 'token_holdings', 'token_management',
    'token_transactions', 'tokens', 'vehicle_tokens',
    
    // Vehicle specific
    'vehicle_issues', 'vehicle_market_data',
    'vehicle_probability_zones', 'discovered_vehicles',
    'vehicle_sales_data', 'vehicle_timeline_events',
    
    // Video and processing
    'realtime_video_segments', 'video_analysis_contributions',
    'video_analysis_results', 'video_processing_jobs',
    'vin_processing_jobs',
    
    // Other
    'explore_content', 'routes'
  ];
  
  const tables: any[] = [];
  
  console.log(`🔍 Testing ${commonTableNames.length} potential table names...`);
  
  for (const tableName of commonTableNames) {
    try {
      const { data, error } = await supabase
        .from(tableName)
        .select('id')
        .limit(1);
      
      if (!error) {
        console.log(`✅ Found table: ${tableName}`);
        tables.push({ table_name: tableName });
      } else {
        // Check if it's an RLS policy issue
        if (error.message.includes('row-level security') || error.message.includes('RLS')) {
          console.log(`🔒 Table ${tableName}: RLS policy blocking access`);
        } else if (error.message.includes('does not exist')) {
          console.log(`❌ Table ${tableName}: Does not exist`);
        } else {
          console.log(`❌ Table ${tableName}: ${error.message}`);
        }
      }
    } catch (error) {
      console.log(`❌ Table ${tableName}: ${error}`);
    }
  }
  
  return tables;
}

async function auditTable(tableName: string): Promise<TableAudit> {
  const audit: TableAudit = {
    tableName,
    columns: [],
    rowCount: 0,
    conflicts: [],
    recommendations: []
  };
  
  try {
    // Try to get column details from the RPC function first
    try {
      const { data: columnData, error: columnError } = await supabase.rpc('get_table_details', {
        p_table_name: tableName
      });
      
      if (!columnError && columnData && columnData.length > 0) {
        audit.columns = columnData.map((col: any) => ({
          table_name: col.table_name,
          column_name: col.column_name,
          data_type: col.data_type,
          is_nullable: col.is_nullable,
          column_default: col.column_default,
          character_maximum_length: col.character_maximum_length
        }));
        console.log(`✅ Got column details for ${tableName}: ${audit.columns.length} columns`);
      }
    } catch (error) {
      console.log(`⚠️ Could not get column details via RPC for ${tableName}: ${error}`);
    }
    
    // Try to get a sample row to understand the structure (fallback)
    if (audit.columns.length === 0) {
      const { data: sampleData, error: sampleError } = await supabase
        .from(tableName)
        .select('*')
        .limit(1);
      
      if (sampleError) {
        audit.conflicts.push(`Cannot access table: ${sampleError.message}`);
        return audit;
      }
      
      // Create a basic column structure based on sample data
      if (sampleData && sampleData.length > 0) {
        const sampleRow = sampleData[0];
        audit.columns = Object.keys(sampleRow).map(key => ({
          table_name: tableName,
          column_name: key,
          data_type: typeof sampleRow[key],
          is_nullable: 'YES', // Assume nullable for now
          column_default: null,
          character_maximum_length: null
        }));
      }
    }
    
    // Try to get row count
    try {
      const { count, error: countError } = await supabase
        .from(tableName)
        .select('*', { count: 'exact', head: true });
      
      if (!countError) {
        audit.rowCount = count || 0;
      }
    } catch (error) {
      audit.conflicts.push(`Cannot count rows: ${error}`);
    }
    
    // Analyze the table structure
    analyzeTable(audit);
    
  } catch (error) {
    audit.conflicts.push(`Error auditing table: ${error}`);
  }
  
  return audit;
}

function analyzeTable(audit: TableAudit): void {
  const { tableName, columns } = audit;
  
  // Check for duplicate table names
  if (tableName.includes('vehicle') || tableName.includes('car')) {
    audit.recommendations.push('Vehicle-related table - check for duplicates');
  }
  
  if (tableName.includes('profile') || tableName.includes('user')) {
    audit.recommendations.push('User/profile-related table - check for duplicates');
  }
  
  if (tableName.includes('image') || tableName.includes('photo')) {
    audit.recommendations.push('Image-related table - check for duplicates');
  }
  
  // Check for required columns based on our schema
  const columnNames = columns.map(c => c.column_name.toLowerCase());
  
  if (tableName.toLowerCase().includes('vehicle')) {
    if (!columnNames.includes('make')) {
      audit.conflicts.push('Missing required column: make');
    }
    if (!columnNames.includes('model')) {
      audit.conflicts.push('Missing required column: model');
    }
    if (!columnNames.includes('year')) {
      audit.conflicts.push('Missing required column: year');
    }
  }
  
  if (tableName.toLowerCase().includes('profile')) {
    if (!columnNames.includes('email')) {
      audit.recommendations.push('Consider adding email column for user profiles');
    }
  }
  
  // Check for UUID primary keys
  const hasUuidPrimaryKey = columns.some(c => 
    c.column_name === 'id' && 
    c.data_type === 'uuid' && 
    c.column_default?.includes('uuid_generate')
  );
  
  if (!hasUuidPrimaryKey) {
    audit.recommendations.push('Consider using UUID primary keys for better scalability');
  }
  
  // Check for timestamps
  const hasCreatedAt = columnNames.includes('created_at');
  const hasUpdatedAt = columnNames.includes('updated_at');
  
  if (!hasCreatedAt) {
    audit.recommendations.push('Consider adding created_at timestamp');
  }
  if (!hasUpdatedAt) {
    audit.recommendations.push('Consider adding updated_at timestamp');
  }
}

function generateSummaryReport(audits: TableAudit[]): void {
  console.log('\n📊 DATABASE AUDIT SUMMARY');
  console.log('=' .repeat(50));
  
  const vehicleTables = audits.filter(a => 
    a.tableName.toLowerCase().includes('vehicle') || 
    a.tableName.toLowerCase().includes('car')
  );
  
  const profileTables = audits.filter(a => 
    a.tableName.toLowerCase().includes('profile') || 
    a.tableName.toLowerCase().includes('user')
  );
  
  const imageTables = audits.filter(a => 
    a.tableName.toLowerCase().includes('image') || 
    a.tableName.toLowerCase().includes('photo')
  );
  
  const accessibleTables = audits.filter(a => a.columns.length > 0);
  const rlsBlockedTables = audits.filter(a => a.conflicts.some(c => c.includes('RLS') || c.includes('row-level security')));
  
  console.log(`\n📋 Total tables tested: ${audits.length}`);
  console.log(`✅ Accessible tables: ${accessibleTables.length}`);
  console.log(`🔒 RLS-blocked tables: ${rlsBlockedTables.length}`);
  
  console.log(`\n🚗 Vehicle-related tables: ${vehicleTables.length}`);
  vehicleTables.forEach(table => {
    const status = table.columns.length > 0 ? '✅' : '🔒';
    console.log(`  ${status} ${table.tableName} (${table.rowCount} rows, ${table.columns.length} columns)`);
  });
  
  console.log(`\n👤 Profile-related tables: ${profileTables.length}`);
  profileTables.forEach(table => {
    const status = table.columns.length > 0 ? '✅' : '🔒';
    console.log(`  ${status} ${table.tableName} (${table.rowCount} rows, ${table.columns.length} columns)`);
  });
  
  console.log(`\n🖼️ Image-related tables: ${imageTables.length}`);
  imageTables.forEach(table => {
    const status = table.columns.length > 0 ? '✅' : '🔒';
    console.log(`  ${status} ${table.tableName} (${table.rowCount} rows, ${table.columns.length} columns)`);
  });
  
  console.log(`\n⚠️ Tables with conflicts: ${audits.filter(a => a.conflicts.length > 0).length}`);
  audits.filter(a => a.conflicts.length > 0).forEach(table => {
    console.log(`  - ${table.tableName}: ${table.conflicts.length} conflicts`);
  });
  
  console.log(`\n💡 Tables with recommendations: ${audits.filter(a => a.recommendations.length > 0).length}`);
  audits.filter(a => a.recommendations.length > 0).forEach(table => {
    console.log(`  - ${table.tableName}: ${table.recommendations.length} recommendations`);
  });
  
  if (rlsBlockedTables.length > 0) {
    console.log(`\n🔒 RLS POLICY NOTE:`);
    console.log(`Most tables have Row Level Security enabled. To access these tables, you need to:`);
    console.log(`1. Be authenticated as a user`);
    console.log(`2. Have appropriate RLS policies configured`);
    console.log(`3. Or temporarily disable RLS for testing (not recommended for production)`);
  }
}

export async function testConnection(): Promise<boolean> {
  try {
    console.log('🔌 Testing Supabase connection...');
    console.log('URL:', import.meta.env.VITE_SUPABASE_URL);
    console.log('Key length:', import.meta.env.VITE_SUPABASE_ANON_KEY?.length || 0);
    
    // Try to access common tables to test connection
    const commonTables = ['profiles', 'users', 'vehicles', 'cars'];
    
    for (const tableName of commonTables) {
      try {
        const { data, error } = await supabase
          .from(tableName)
          .select('id')
          .limit(1);
        
        if (!error) {
          console.log(`✅ Connection successful! Found table: ${tableName}`);
          console.log('Sample data:', data);
          return true;
        }
      } catch (error) {
        // Continue to next table
      }
    }
    
    console.error('❌ Connection failed: No accessible tables found');
    return false;
  } catch (error) {
    console.error('❌ Connection test failed:', error);
    return false;
  }
} 
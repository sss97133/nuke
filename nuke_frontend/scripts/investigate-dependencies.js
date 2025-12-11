// Investigate all foreign key dependencies on auth.users
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function investigateDependencies() {
  console.log('🔍 Investigating All Foreign Key Dependencies on auth.users\n');
  
  // Get all tables in the public schema
  console.log('📋 Getting all tables...');
  try {
    const { data: tables, error } = await supabase.rpc('get_all_tables');
    if (error) {
      console.log('❌ Cannot get tables via RPC, trying manual approach...\n');
    }
  } catch (err) {
    console.log('❌ RPC failed, using manual table discovery...\n');
  }
  
  // List of known tables that might reference users
  const potentialTables = [
    'profiles',
    'vehicles', 
    'timeline_events',
    'vehicle_images',
    'skynalysis_analyses',
    'ai_processors',
    'engagement_metrics',
    'user_preferences',
    'user_sessions',
    'user_activities',
    'notifications',
    'user_follows',
    'user_blocks',
    'user_reports',
    'garage_members',
    'garage_invites',
    'vehicle_shares',
    'comments',
    'likes',
    'bookmarks',
    'reviews',
    'messages',
    'conversations',
    'conversation_participants'
  ];
  
  console.log('🔍 Checking each table for user references...\n');
  
  const tablesWithData = [];
  
  for (const tableName of potentialTables) {
    try {
      // Try to get count and sample data
      const { data, error, count } = await supabase
        .from(tableName)
        .select('*', { count: 'exact', head: true });
      
      if (!error && count > 0) {
        console.log(`✅ ${tableName}: ${count} records`);
        tablesWithData.push({ table: tableName, count });
        
        // Get a sample record to see the structure
        const { data: sample } = await supabase
          .from(tableName)
          .select('*')
          .limit(1);
        
        if (sample && sample.length > 0) {
          const columns = Object.keys(sample[0]);
          const userColumns = columns.filter(col => 
            col.includes('user') || col.includes('id') || col.includes('owner')
          );
          console.log(`   Potential user columns: ${userColumns.join(', ')}`);
        }
      } else if (!error && count === 0) {
        console.log(`📭 ${tableName}: 0 records (empty)`);
      } else if (error && !error.message.includes('does not exist')) {
        console.log(`❌ ${tableName}: Access denied or other error`);
      }
    } catch (err) {
      // Table doesn't exist or no access - skip silently
    }
  }
  
  console.log('\n🎯 SUMMARY:');
  console.log(`Found ${tablesWithData.length} tables with data:`);
  tablesWithData.forEach(({ table, count }) => {
    console.log(`   - ${table}: ${count} records`);
  });
  
  console.log('\n💡 RECOMMENDATION:');
  console.log('To delete all auth.users, we need to delete from these tables first:');
  tablesWithData.forEach(({ table }) => {
    console.log(`   DELETE FROM public.${table};`);
  });
  console.log('   DELETE FROM auth.users;');
}

investigateDependencies();

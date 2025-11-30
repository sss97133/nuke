import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabase = createClient(supabaseUrl, supabaseKey)

const sql = `ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS received_in_trade BOOLEAN DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_vehicles_received_in_trade ON vehicles(received_in_trade) WHERE received_in_trade = true;
COMMENT ON COLUMN vehicles.received_in_trade IS 'Indicates if this vehicle was received as part of a trade transaction (including partial trades)';`

async function tryExecute() {
  console.log('Trying execute_sql function...\n')
  
  // Try execute_sql
  const { data, error } = await supabase.rpc('execute_sql', { query: sql })
  
  if (error) {
    console.log('execute_sql error:', error.message)
    
    // Try with different parameter names
    const { data: data2, error: error2 } = await supabase.rpc('execute_sql', { sql: sql })
    if (error2) {
      console.log('execute_sql(sql) error:', error2.message)
      console.log('\n⚠️  Cannot execute DDL via RPC. Please apply manually in Supabase SQL Editor.')
      console.log('\nSQL to execute:\n')
      console.log(sql)
    } else {
      console.log('✅ Success with sql parameter!')
      console.log(data2)
    }
  } else {
    console.log('✅ Success!')
    console.log(data)
  }
}

tryExecute().catch(console.error)


const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.supabase' });

const supabase = createClient(
  'https://qkgaybvrernstplzjaam.supabase.co',
  'REDACTED-ROTATE-THIS-KEY'
);

async function checkShopsStatus() {
  console.log('🔍 Checking Shops System Status...\n');

  // Check if shops table exists
  const { data: shopsTable, error: shopsError } = await supabase
    .from('shops')
    .select('*')
    .limit(1);

  if (shopsError) {
    console.log('❌ Shops table NOT found:', shopsError.message);
    console.log('\n📋 Migrations need to be run:');
    console.log('1. 20250105_shops_core.sql');
    console.log('2. 20250105_shops_admin_integration.sql');
    console.log('3. 20250105_shops_business_verification.sql');
    console.log('4. 20250105_shops_business_structure.sql');
    return;
  }

  console.log('✅ Shops table exists');

  // Check for shop_locations
  const { error: locError } = await supabase
    .from('shop_locations')
    .select('*')
    .limit(1);

  if (locError) {
    console.log('❌ Shop locations table NOT found');
    console.log('   → Need to run: 20250105_shops_business_structure.sql');
  } else {
    console.log('✅ Shop locations table exists');
  }

  // Check for shop_departments
  const { error: deptError } = await supabase
    .from('shop_departments')
    .select('*')
    .limit(1);

  if (deptError) {
    console.log('❌ Shop departments table NOT found');
    console.log('   → Need to run: 20250105_shops_business_structure.sql');
  } else {
    console.log('✅ Shop departments table exists');
  }

  // Check for shop_licenses
  const { error: licError } = await supabase
    .from('shop_licenses')
    .select('*')
    .limit(1);

  if (licError) {
    console.log('❌ Shop licenses table NOT found');
    console.log('   → Need to run: 20250105_shops_business_structure.sql');
  } else {
    console.log('✅ Shop licenses table exists');
  }

  // Check for shop_members
  const { error: membersError } = await supabase
    .from('shop_members')
    .select('*')
    .limit(1);

  if (membersError) {
    console.log('❌ Shop members table NOT found');
    console.log('   → Need to run: 20250105_shops_core.sql');
  } else {
    console.log('✅ Shop members table exists');
  }

  // Count existing shops
  const { count } = await supabase
    .from('shops')
    .select('*', { count: 'exact', head: true });

  console.log(`\n📊 Total shops in database: ${count || 0}`);

  // Check if user has any shops
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { data: userShops } = await supabase
      .from('shops')
      .select('*')
      .eq('owner_user_id', user.id);
    
    if (userShops && userShops.length > 0) {
      console.log(`\n👤 Your shops:`);
      userShops.forEach(shop => {
        console.log(`   - ${shop.name} (${shop.id})`);
      });
    }
  }

  console.log('\n🌐 Frontend URLs:');
  console.log('   Organizations: http://localhost:5174/shops');
  console.log('   Admin Dashboard: http://localhost:5174/admin');
}

checkShopsStatus().catch(console.error);

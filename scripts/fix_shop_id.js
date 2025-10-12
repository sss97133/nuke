const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.supabase' });

const supabase = createClient(
  'https://qkgaybvrernstplzjaam.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczODM2OTAyMSwiZXhwIjoyMDUzOTQ1MDIxfQ.NEbqSnSamR5f7Fqon25ierv5yJgdDy_o2nrixOej_Xg'
);

async function fixAndCreateShop() {
  console.log('🔧 Fixing shop table and creating test shop\n');

  // Find admin user
  const { data: adminUsers } = await supabase
    .from('admin_users')
    .select('user_id')
    .eq('is_active', true)
    .limit(1);
  
  if (!adminUsers || adminUsers.length === 0) {
    console.log('❌ No admin user found');
    return;
  }

  const userId = adminUsers[0].user_id;
  console.log('✅ Found admin user');

  // Generate UUID manually
  const shopId = crypto.randomUUID();
  
  // Create shop with explicit ID
  const { data: shop, error: shopError } = await supabase
    .from('shops')
    .insert({
      id: shopId,
      name: 'Viva Las Vegas Autos',
      owner_user_id: userId,
      email: 'info@vivalasvegas.auto',
      phone: '(702) 555-0123',
      website_url: 'https://vivalasvegas.auto',
      description: 'Premier classic and muscle car dealership',
      location_city: 'Las Vegas',
      location_state: 'NV',
      location_country: 'USA',
      is_verified: false
    })
    .select()
    .single();

  if (shopError) {
    console.log('❌ Error:', shopError.message);
    
    // Try without explicit ID
    console.log('\nTrying alternative approach...');
    const { data: shop2, error: error2 } = await supabase
      .from('shops')
      .insert({
        name: 'Viva Las Vegas Autos ' + Date.now(),
        owner_user_id: userId
      })
      .select()
      .single();
      
    if (error2) {
      console.log('❌ Still failed:', error2.message);
      return;
    } else {
      console.log('✅ Shop created:', shop2.name);
      console.log('   ID:', shop2.id);
      
      // Add member
      await supabase.from('shop_members').insert({
        shop_id: shop2.id,
        user_id: userId,
        role: 'owner',
        status: 'active'
      });
      
      console.log('✅ Added as owner');
    }
  } else {
    console.log('✅ Shop created:', shop.name);
    console.log('   ID:', shop.id);
    
    // Add member
    await supabase.from('shop_members').insert({
      shop_id: shop.id,
      user_id: userId,
      role: 'owner',
      status: 'active'
    });
    
    console.log('✅ Added as owner');
  }

  console.log('\n🎉 Done! Visit http://localhost:5174/shops');
}

fixAndCreateShop().catch(console.error);

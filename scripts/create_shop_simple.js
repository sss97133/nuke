const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.supabase' });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;


if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('ERROR: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function createSimpleShop() {
  console.log('🏪 Creating Shop (Simple Version)\n');

  // Find any admin user
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
  console.log('✅ Using admin user');

  // Check existing shops
  const { data: existingShops } = await supabase
    .from('shops')
    .select('*')
    .eq('owner_user_id', userId);

  if (existingShops && existingShops.length > 0) {
    console.log('\n📋 You already have shops:');
    existingShops.forEach(shop => {
      console.log(`   - ${shop.name} (ID: ${shop.id})`);
    });
    console.log('\n✅ Visit http://localhost:5174/shops to manage them');
    return;
  }

  // Create shop with only required fields
  const shopData = {
    name: 'Viva Las Vegas Autos',
    owner_user_id: userId,
    email: 'info@vivalasvegas.auto',
    phone: '(702) 555-0123',
    website_url: 'https://vivalasvegas.auto',
    description: 'Premier classic and muscle car dealership',
    location_city: 'Las Vegas',
    location_state: 'NV',
    location_country: 'USA'
  };

  const { data: shop, error: shopError } = await supabase
    .from('shops')
    .insert(shopData)
    .select()
    .single();

  if (shopError) {
    console.log('❌ Error creating shop:', shopError.message);
    console.log('Details:', shopError);
    return;
  }

  console.log('✅ Shop created:', shop.name);
  console.log('   ID:', shop.id);

  // Add as member
  await supabase
    .from('shop_members')
    .insert({
      shop_id: shop.id,
      user_id: userId,
      role: 'owner',
      status: 'active'
    });

  console.log('✅ Added as shop owner');

  // Create location
  const { data: location } = await supabase
    .from('shop_locations')
    .insert({
      shop_id: shop.id,
      name: '707 Yucca St HQ',
      street_address: '707 Yucca St',
      city: 'Las Vegas',
      state: 'NV',
      postal_code: '89101',
      country: 'USA',
      is_headquarters: true
    })
    .select()
    .single();

  if (location) {
    console.log('✅ Created HQ location');

    // Create departments
    const depts = [
      { shop_id: shop.id, name: 'Sales', department_type: 'sales', location_id: location.id },
      { shop_id: shop.id, name: 'Service', department_type: 'service', location_id: location.id },
      { shop_id: shop.id, name: 'Consignment', department_type: 'consignment', location_id: location.id }
    ];

    for (const dept of depts) {
      await supabase.from('shop_departments').insert(dept);
    }
    console.log('✅ Created 3 departments');
  }

  console.log('\n🎉 Setup complete!');
  console.log('\n📍 Access your shop:');
  console.log('   http://localhost:5174/shops');
  console.log('\nClick "Manage Structure" to add locations, licenses, and departments!');
}

createSimpleShop().catch(console.error);

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.supabase' });

const supabase = createClient(
  'https://qkgaybvrernstplzjaam.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczODM2OTAyMSwiZXhwIjoyMDUzOTQ1MDIxfQ.NEbqSnSamR5f7Fqon25ierv5yJgdDy_o2nrixOej_Xg'
);

async function setupTestShop() {
  console.log('🏪 Setting up Test Shop System\n');

  // First, find Skylar's user ID
  const { data: users, error: userError } = await supabase
    .from('profiles')
    .select('id, email, display_name')
    .or('email.eq.skylarwilliams.ceo@gmail.com,email.eq.skylar@nulab.live')
    .limit(1);

  let userId;
  if (users && users.length > 0) {
    userId = users[0].id;
    console.log(`✅ Found user: ${users[0].email || users[0].display_name}`);
  } else {
    // Try to find any admin user
    const { data: adminUsers } = await supabase
      .from('admin_users')
      .select('user_id')
      .eq('is_active', true)
      .limit(1);
    
    if (adminUsers && adminUsers.length > 0) {
      userId = adminUsers[0].user_id;
      console.log('✅ Using admin user');
    } else {
      console.log('❌ No suitable user found');
      return;
    }
  }

  // Check if shop already exists
  const { data: existingShops } = await supabase
    .from('shops')
    .select('*')
    .eq('owner_user_id', userId);

  if (existingShops && existingShops.length > 0) {
    console.log('\n📋 Existing shops found:');
    existingShops.forEach(shop => {
      console.log(`   - ${shop.name} (${shop.id})`);
    });
    console.log('\nShops already exist. Visit http://localhost:5174/shops to manage them.');
    return;
  }

  // Create the shop
  const { data: shop, error: shopError } = await supabase
    .from('shops')
    .insert({
      name: 'Viva Las Vegas Autos',
      slug: 'viva-las-vegas-autos',
      owner_user_id: userId,
      org_type: 'dealer',
      email: 'info@vivalasvegas.auto',
      phone: '(702) 555-0123',
      website_url: 'https://vivalasvegas.auto',
      description: 'Premier classic and muscle car dealership in Las Vegas. Family-owned since 1985.',
      location_city: 'Las Vegas',
      location_state: 'NV',
      location_country: 'USA'
    })
    .select()
    .single();

  if (shopError) {
    console.log('❌ Error creating shop:', shopError.message);
    return;
  }

  console.log('\n✅ Shop created:', shop.name);
  console.log('   ID:', shop.id);

  // Add owner as member
  await supabase
    .from('shop_members')
    .insert({
      shop_id: shop.id,
      user_id: userId,
      role: 'owner',
      status: 'active',
      job_title: 'Owner/Operator'
    });

  console.log('✅ Added owner as shop member');

  // Create headquarters location
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
      is_headquarters: true,
      phone: '(702) 555-0123',
      email: 'hq@vivalasvegas.auto'
    })
    .select()
    .single();

  if (location) {
    console.log('✅ Created headquarters location');

    // Add licenses
    await supabase
      .from('shop_licenses')
      .insert([
        {
          shop_id: shop.id,
          location_id: location.id,
          license_type: 'dealer_license',
          license_number: 'NV-DLR-123456',
          issuing_authority: 'Nevada DMV',
          issue_date: '2023-01-01',
          expiration_date: '2025-12-31',
          is_active: true
        },
        {
          shop_id: shop.id,
          location_id: location.id,
          license_type: 'garage_license',
          license_number: 'NV-GAR-789012',
          issuing_authority: 'Nevada DMV',
          issue_date: '2023-01-01',
          expiration_date: '2025-12-31',
          is_active: true
        }
      ]);

    console.log('✅ Added dealer and garage licenses');

    // Create departments
    const departments = [
      { name: 'Sales Department', department_type: 'sales', location_id: location.id },
      { name: 'Consignment Department', department_type: 'consignment', location_id: location.id },
      { name: 'Showroom', department_type: 'showroom', location_id: location.id },
      { name: 'Service Department', department_type: 'service', location_id: location.id },
      { name: 'Parts Department', department_type: 'parts', location_id: location.id },
      { name: 'Finance & Admin', department_type: 'admin', location_id: location.id }
    ];

    for (const dept of departments) {
      await supabase
        .from('shop_departments')
        .insert({
          shop_id: shop.id,
          ...dept
        });
    }

    console.log('✅ Created 6 departments');
  }

  console.log('\n🎉 Test shop setup complete!');
  console.log('\n📍 Access your shop system:');
  console.log('   Organizations: http://localhost:5174/shops');
  console.log('   Admin Dashboard: http://localhost:5174/admin');
  console.log('\nClick "Manage Structure" to explore departments, locations, and licenses!');
}

setupTestShop().catch(console.error);

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.supabase' });

const supabase = createClient(
  'https://qkgaybvrernstplzjaam.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczODM2OTAyMSwiZXhwIjoyMDUzOTQ1MDIxfQ.NEbqSnSamR5f7Fqon25ierv5yJgdDy_o2nrixOej_Xg'
);

async function createTestShop() {
  console.log('🏪 Creating Test Shop: Viva Las Vegas Autos\n');

  // Get current user
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  
  if (authError || !user) {
    console.log('❌ No authenticated user found. Please log in first.');
    return;
  }

  console.log(`👤 Creating shop for user: ${user.email}\n`);

  // 1. Create the shop
  const { data: shop, error: shopError } = await supabase
    .from('shops')
    .insert({
      name: 'Viva Las Vegas Autos',
      slug: 'viva-las-vegas-autos',
      owner_user_id: user.id,
      org_type: 'dealer',
      email: 'info@vivalasvegas.auto',
      phone: '(702) 555-0123',
      website_url: 'https://vivalasvegas.auto',
      description: 'Premier classic and muscle car dealership in Las Vegas. Family-owned since 1985.',
      location_city: 'Las Vegas',
      location_state: 'NV',
      location_country: 'USA',
      legal_entity_name: 'Viva Las Vegas Autos LLC',
      dba_name: 'Viva Las Vegas Autos',
      ein: '88-1234567',
      business_type: 'LLC',
      is_verified: false
    })
    .select()
    .single();

  if (shopError) {
    console.log('❌ Error creating shop:', shopError.message);
    return;
  }

  console.log('✅ Shop created:', shop.name);
  console.log('   ID:', shop.id);

  // 2. Add owner as member
  const { error: memberError } = await supabase
    .from('shop_members')
    .insert({
      shop_id: shop.id,
      user_id: user.id,
      role: 'owner',
      status: 'active',
      job_title: 'Owner/Operator'
    });

  if (!memberError) {
    console.log('✅ Added you as shop owner');
  }

  // 3. Create headquarters location
  const { data: location, error: locError } = await supabase
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

  if (!locError) {
    console.log('✅ Created headquarters location:', location.name);
    
    // 4. Add licenses
    const licenses = [
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
    ];

    const { error: licError } = await supabase
      .from('shop_licenses')
      .insert(licenses);

    if (!licError) {
      console.log('✅ Added dealer and garage licenses');
    }

    // 5. Create departments using the RPC function
    const { error: deptError } = await supabase.rpc('create_default_departments', {
      p_shop_id: shop.id,
      p_location_id: location.id,
      p_business_type: 'dealer'
    });

    if (!deptError) {
      console.log('✅ Created default dealer departments:');
      console.log('   - Sales Department');
      console.log('   - Consignment Department');
      console.log('   - Showroom');
      console.log('   - Service Department');
      console.log('   - Parts Department');
      console.log('   - Finance & Admin');
    } else {
      console.log('⚠️  Could not create departments:', deptError.message);
    }
  }

  console.log('\n🎉 Test shop setup complete!');
  console.log('\n📍 Next steps:');
  console.log('1. Visit http://localhost:5174/shops');
  console.log('2. Click "Manage Structure" on Viva Las Vegas Autos');
  console.log('3. Explore the Locations, Licenses, Departments, and Staff tabs');
}

createTestShop().catch(console.error);

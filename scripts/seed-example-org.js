// Seed example organization for testing
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://wksjslszaxtzlhfqvxze.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseServiceKey) {
  console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function seedOrganization() {
  try {
    console.log('🌱 Creating example organization...');

    // Get first user to be the creator
    const { data: users } = await supabase
      .from('profiles')
      .select('id')
      .limit(1);

    if (!users || users.length === 0) {
      console.error('❌ No users found. Create a user account first.');
      return;
    }

    const creatorId = users[0].id;
    const orgId = '10e77f53-c8d3-445e-b0dd-c518e6637e31'; // Use the ID from your URL

    // Check if org already exists
    const { data: existing } = await supabase
      .from('businesses')
      .select('id')
      .eq('id', orgId)
      .maybeSingle();

    if (existing) {
      console.log('✅ Organization already exists:', orgId);
      return;
    }

    // Create organization
    const { data: org, error: orgError } = await supabase
      .from('businesses')
      .insert({
        id: orgId,
        business_name: 'Desert Performance',
        legal_name: 'Desert Performance LLC',
        business_type: 'performance_shop',
        description: 'Custom off-road builds and performance upgrades. Specializing in classic trucks and 4x4 conversions.',
        phone: '(555) 867-5309',
        email: 'contact@desertperf.com',
        website: 'https://desertperf.com',
        address: '123 Cactus Road',
        city: 'Phoenix',
        state: 'AZ',
        zip_code: '85001',
        discovered_by: creatorId,
        uploaded_by: creatorId,
        is_public: true,
        status: 'active',
        verification_level: 'unverified',
        is_tradable: true,
        stock_symbol: 'DSRT'
      })
      .select()
      .single();

    if (orgError) throw orgError;

    console.log('✅ Organization created:', org.id);

    // Create contributor record
    const { error: contributorError } = await supabase
      .from('organization_contributors')
      .insert({
        organization_id: org.id,
        user_id: creatorId,
        role: 'owner',
        contribution_count: 1,
        status: 'active'
      });

    if (contributorError) throw contributorError;
    console.log('✅ Contributor record created');

    // Create timeline event
    const { error: timelineError } = await supabase
      .from('business_timeline_events')
      .insert({
        business_id: org.id,
        created_by: creatorId,
        event_type: 'founded',
        event_category: 'legal',
        title: 'Organization founded',
        description: 'Desert Performance was added to the platform',
        event_date: new Date().toISOString().split('T')[0],
        metadata: {
          initial_creator: creatorId
        }
      });

    if (timelineError) throw timelineError;
    console.log('✅ Timeline event created');

    // Create offering for trading
    const { error: offeringError } = await supabase
      .from('organization_offerings')
      .insert({
        organization_id: org.id,
        offering_type: 'stock',
        issuer_id: creatorId,
        stock_symbol: 'DSRT',
        total_shares: 10000,
        initial_share_price: 1.00,
        current_share_price: 1.00,
        status: 'active'
      });

    if (offeringError) throw offeringError;
    console.log('✅ Stock offering created (DSRT @ $1.00/share)');

    console.log('\n✅ SUCCESS: Organization seeded!');
    console.log(`   View at: https://n-zero.dev/org/${org.id}`);
    console.log(`   Name: ${org.business_name}`);
    console.log(`   Stock: ${org.stock_symbol}`);

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

seedOrganization();


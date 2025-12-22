/**
 * Helper script to get Instagram Business Account ID
 * 
 * Usage:
 *   node scripts/get-instagram-account-id.js <access_token>
 * 
 * Or set INSTAGRAM_ACCESS_TOKEN environment variable
 */

const accessToken = process.argv[2] || process.env.INSTAGRAM_ACCESS_TOKEN;

if (!accessToken) {
  console.error('❌ Access token required');
  console.error('Usage: node scripts/get-instagram-account-id.js <access_token>');
  process.exit(1);
}

async function getInstagramAccountId() {
  try {
    console.log('🔍 Getting Facebook Pages...\n');
    
    // Step 1: Get Facebook Pages
    const pagesResponse = await fetch(
      `https://graph.facebook.com/v18.0/me/accounts?access_token=${accessToken}`
    );
    
    const pagesData = await pagesResponse.json();
    
    if (pagesData.error) {
      console.error('❌ Error:', pagesData.error.message);
      console.error('\n💡 This token might not have the right permissions.');
      console.error('   Required permissions: pages_read_engagement, pages_show_list');
      return;
    }
    
    if (!pagesData.data || pagesData.data.length === 0) {
      console.error('❌ No Facebook Pages found');
      console.error('\n💡 Your Instagram account must be connected to a Facebook Page.');
      console.error('   Connect it in Meta Business Suite: https://business.facebook.com/');
      return;
    }
    
    console.log(`✅ Found ${pagesData.data.length} Facebook Page(s)\n`);
    
    // Step 2: Get Instagram Business Account for each page
    for (const page of pagesData.data) {
      console.log(`📄 Checking page: ${page.name} (${page.id})`);
      
      const igResponse = await fetch(
        `https://graph.facebook.com/v18.0/${page.id}?fields=instagram_business_account&access_token=${page.access_token}`
      );
      
      const igData = await igResponse.json();
      
      if (igData.instagram_business_account) {
        const igAccount = igData.instagram_business_account;
        console.log(`\n✅ Instagram Business Account Found!`);
        console.log(`   Account ID: ${igAccount.id}`);
        console.log(`   Username: ${igAccount.username || 'N/A'}`);
        console.log(`\n📋 Use this in your sync call:`);
        console.log(`   instagram_account_id: "${igAccount.id}"`);
        return igAccount.id;
      } else {
        console.log(`   ⚠️  No Instagram Business Account connected`);
      }
    }
    
    console.log('\n❌ No Instagram Business Account found');
    console.log('\n💡 Connect your Instagram account to a Facebook Page in Meta Business Suite.');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

getInstagramAccountId();


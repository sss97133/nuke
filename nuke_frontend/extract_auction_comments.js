/**
 * Quick script to extract auction comments from the BaT listing
 * Run: node extract_auction_comments.js
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const AUCTION_URL = 'https://bringatrailer.com/listing/1986-jeep-grand-wagoneer-2/';
const AUCTION_EVENT_ID = 'dcb84364-5b82-4fa2-a40d-3740b5eba11c';

async function extractAuctionComments() {
  console.log('🔥 Starting Firecrawl extraction of BaT auction comments...');
  console.log(`URL: ${AUCTION_URL}`);
  console.log(`Event ID: ${AUCTION_EVENT_ID}`);

  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/extract-auction-comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({
        auction_url: AUCTION_URL,
        auction_event_id: AUCTION_EVENT_ID
      })
    });

    const result = await response.json();

    if (result.success) {
      console.log('✅ Success!');
      console.log(`📝 Extracted ${result.comments_extracted} comments`);
      console.log('🔄 Timeline should now show auction activity on proper dates');
    } else {
      console.error('❌ Failed:', result.error);
    }

  } catch (error) {
    console.error('💥 Error:', error.message);
  }
}

extractAuctionComments();
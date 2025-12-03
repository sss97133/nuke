#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczODM2OTAyMSwiZXhwIjoyMDUzOTQ1MDIxfQ.NEbqSnSamR5f7Fqon25ierv5yJgdDy_o2nrixOej_Xg';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function extractComments(auctionEvent) {
  console.log(`\nProcessing: ${auctionEvent.source_url}`);
  
  try {
    // Call the extract function
    const response = await fetch(`${SUPABASE_URL}/functions/v1/extract-auction-comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
      },
      body: JSON.stringify({
        auction_url: auctionEvent.source_url,
        auction_event_id: auctionEvent.id
      })
    });

    const result = await response.json();
    
    if (result.success) {
      console.log(`  ✅ ${result.comments_extracted} comments extracted`);
      
      // Trigger AI analysis
      if (result.comments_extracted > 0) {
        const analysisResp = await fetch(`${SUPABASE_URL}/functions/v1/analyze-auction-comments`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
          },
          body: JSON.stringify({ auction_event_id: auctionEvent.id })
        });
        
        const analysisResult = await analysisResp.json();
        console.log(`  🧠 ${analysisResult.analyzed_count || 0} comments analyzed`);
        
        // Generate receipt
        const receiptResp = await fetch(`${SUPABASE_URL}/functions/v1/generate-auction-receipt`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
          },
          body: JSON.stringify({ auction_event_id: auctionEvent.id })
        });
        
        const receiptResult = await receiptResp.json();
        if (receiptResult.success) {
          console.log(`  📄 Receipt generated`);
        }
      }
      
      return true;
    } else {
      console.log(`  ❌ Failed: ${result.error}`);
      return false;
    }
  } catch (error) {
    console.error(`  Error: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('BACKFILL AUCTION COMMENTS');
  console.log('='.repeat(60));

  // Get all auction events with source URLs
  const { data: auctions, error } = await supabase
    .from('auction_events')
    .select('id, source_url, vehicle_id, outcome, high_bid')
    .not('source_url', 'is', null)
    .order('auction_end_date', { ascending: false });

  if (error) {
    console.error('Failed to fetch auctions:', error);
    return;
  }

  console.log(`\nFound ${auctions.length} auctions to process\n`);

  let success = 0;
  let failed = 0;

  for (const auction of auctions) {
    const result = await extractComments(auction);
    if (result) success++;
    else failed++;
    
    // Rate limit
    await new Promise(r => setTimeout(r, 5000));
  }

  console.log('\n' + '='.repeat(60));
  console.log(`COMPLETE: ${success} auctions processed, ${failed} failed`);
}

main().catch(console.error);


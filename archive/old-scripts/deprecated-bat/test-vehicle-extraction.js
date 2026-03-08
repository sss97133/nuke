#!/usr/bin/env node
/**
 * Test comprehensive extraction for a specific vehicle
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '../.env' });
dotenv.config({ path: '../nuke_frontend/.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('❌ Error: Supabase service role key not found');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testVehicleExtraction(vehicleId) {
  console.log(`\n🧪 Testing extraction for vehicle: ${vehicleId}\n`);
  
  // Get vehicle data
  const { data: vehicle, error: vehicleError } = await supabase
    .from('vehicles')
    .select('id, year, make, model, bat_auction_url, discovery_url, bat_comments, origin_metadata, auction_end_date, description')
    .eq('id', vehicleId)
    .single();
  
  if (vehicleError || !vehicle) {
    console.error('❌ Error fetching vehicle:', vehicleError);
    return;
  }
  
  const batUrl = vehicle.bat_auction_url || vehicle.discovery_url;
  if (!batUrl || !batUrl.includes('bringatrailer.com')) {
    console.error('❌ No BaT URL found for this vehicle');
    return;
  }
  
  console.log(`Vehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
  console.log(`BaT URL: ${batUrl}`);
  console.log(`\n📊 Current state:`);
  console.log(`   Description: ${vehicle.description ? '✅ (' + vehicle.description.length + ' chars)' : '❌ MISSING'}`);
  console.log(`   Comments: ${vehicle.bat_comments !== null ? '✅ (' + vehicle.bat_comments + ')' : '❌ MISSING'}`);
  console.log(`   Features: ${vehicle.origin_metadata?.bat_features ? '✅ (' + vehicle.origin_metadata.bat_features.length + ')' : '❌ MISSING'}`);
  console.log(`   Auction End Date: ${vehicle.auction_end_date ? '✅ (' + vehicle.auction_end_date + ')' : '❌ MISSING'}`);
  
  console.log(`\n🔄 Running comprehensive extraction...\n`);
  
  try {
    const { data, error } = await supabase.functions.invoke('comprehensive-bat-extraction', {
      body: { batUrl, vehicleId }
    });
    
    if (error) {
      console.error('❌ Extraction error:', error);
      return;
    }
    
    if (!data || !data.success) {
      console.error('❌ Extraction failed:', data);
      return;
    }
    
    console.log('✅ Extraction completed successfully!\n');
    console.log('📋 Extracted data summary:');
    const extractedData = data.data || data;
    console.log(JSON.stringify(extractedData, null, 2));
    console.log('\n');
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/4d355282-c690-469e-97e1-0114c2a0ef69',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'test-vehicle-extraction.js:extractResult',message:'Extraction function returned data',data:{vehicleId,hasVin:!!extractedData.vin,hasSalePrice:!!extractedData.sale_price,salePrice:extractedData.sale_price,hasBidCount:extractedData.bid_count!==undefined,bidCount:extractedData.bid_count,hasViewCount:extractedData.view_count!==undefined,viewCount:extractedData.view_count,hasCommentCount:extractedData.comment_count!==undefined,commentCount:extractedData.comment_count,hasDescription:!!extractedData.description,descriptionLength:extractedData.description?.length,hasFeatures:!!(extractedData.features?.length),featureCount:extractedData.features?.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H5'})}).catch(()=>{});
    // #endregion
    
    // Wait a moment for DB to update
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check updated vehicle - get ALL relevant fields
    const { data: updated, error: updatedError } = await supabase
      .from('vehicles')
      .select('bat_comments, origin_metadata, auction_end_date, description, bat_bids, bat_views, sale_price, sale_date, bat_auction_url, updated_at')
      .eq('id', vehicleId)
      .single();
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/4d355282-c690-469e-97e1-0114c2a0ef69',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'test-vehicle-extraction.js:afterUpdate',message:'Database state after extraction',data:{vehicleId,hasUpdated:!!updated,updatedError:updatedError?.message,batComments:updated?.bat_comments,expectedComments:extractedData.comment_count,batBids:updated?.bat_bids,expectedBids:extractedData.bid_count,batViews:updated?.bat_views,expectedViews:extractedData.view_count,salePrice:updated?.sale_price,expectedSalePrice:extractedData.sale_price,saleDate:updated?.sale_date,expectedSaleDate:extractedData.sale_date,auctionEndDate:updated?.auction_end_date,expectedAuctionEndDate:extractedData.auction_end_date,hasDescription:!!updated?.description,descriptionLength:updated?.description?.length,hasFeatures:!!(updated?.origin_metadata?.bat_features?.length),featureCount:updated?.origin_metadata?.bat_features?.length,updatedAt:updated?.updated_at},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H1'})}).catch(()=>{});
    // #endregion
    
    if (updatedError) {
      console.error('❌ Error fetching updated vehicle:', updatedError);
      return;
    }
    
    console.log(`📊 Updated state:`);
    console.log(`   Description: ${updated.description ? '✅ (' + updated.description.length + ' chars)' : '❌ STILL MISSING'}`);
    console.log(`   Comments: ${updated.bat_comments !== null ? '✅ (' + updated.bat_comments + ')' : '❌ STILL MISSING'}`);
    console.log(`   Features: ${updated.origin_metadata?.bat_features ? '✅ (' + updated.origin_metadata.bat_features.length + ' items)' : '❌ STILL MISSING'}`);
    console.log(`   Auction End Date: ${updated.auction_end_date ? '✅ (' + updated.auction_end_date + ')' : '❌ STILL MISSING'}`);
    console.log(`   Bids: ${updated.bat_bids || 'N/A'}`);
    console.log(`   Views: ${updated.bat_views || 'N/A'}`);
    console.log(`   Sale Price: ${updated.sale_price ? '$' + updated.sale_price.toLocaleString() : 'N/A'}`);
    console.log(`   Sale Date: ${updated.sale_date || 'N/A'}`);
    
    if (updated.origin_metadata?.bat_features && updated.origin_metadata.bat_features.length > 0) {
      console.log(`\n   Features list:`);
      updated.origin_metadata.bat_features.slice(0, 10).forEach((f, i) => {
        console.log(`      ${i + 1}. ${f}`);
      });
      if (updated.origin_metadata.bat_features.length > 10) {
        console.log(`      ... and ${updated.origin_metadata.bat_features.length - 10} more`);
      }
    }
    
  } catch (err) {
    console.error('❌ Exception:', err);
  }
}

const vehicleId = process.argv[2] || 'b808736f-2132-4a9f-aff3-3353b6cae80c';
testVehicleExtraction(vehicleId).catch(console.error);


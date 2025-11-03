/**
 * Analyze FBM Work Orders to Calculate Skylar's Total Contribution Value
 * 
 * Target: €4,400 in labor across all work
 * 
 * Process:
 * 1. Get all sensitive FBM images (work orders)
 * 2. Run OCR extraction on printed work orders
 * 3. Run AI analysis on work photos without orders
 * 4. Aggregate total value
 * 5. Compare to €4,400 target
 * 6. Save to contractor_work_contributions
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '../.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const FBM_ORG_ID = 'f26e26f9-78d6-4f73-820b-fa9015d9242b';
const SKYLAR_USER_ID = '0b9f107a-d124-49de-9ded-94698f63c1c4';

async function analyzeFBMWorkOrders() {
  console.log('🔍 Analyzing FBM Work Orders...\n');
  
  // Get all sensitive FBM images
  const { data: images, error } = await supabase
    .from('organization_images')
    .select('*')
    .eq('organization_id', FBM_ORG_ID)
    .eq('is_sensitive', true)
    .order('taken_at');
  
  if (error || !images) {
    console.error('Error fetching images:', error);
    return;
  }
  
  console.log(`📸 Found ${images.length} work order images\n`);
  
  let totalValue = 0;
  let totalHours = 0;
  const workOrders = [];
  
  for (const img of images) {
    console.log(`\n📄 Processing: ${img.image_url.split('/').pop()}`);
    console.log(`   Date: ${new Date(img.taken_at).toLocaleDateString()}`);
    
    try {
      // Call OCR extraction
      const response = await fetch(`${supabaseUrl}/functions/v1/extract-work-order-ocr`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`
        },
        body: JSON.stringify({
          image_url: img.image_url
        })
      });
      
      const result = await response.json();
      
      if (result.success && result.data) {
        const wo = result.data;
        console.log(`   ✅ Extracted: ${wo.currency || 'EUR'} ${wo.total || 0}`);
        console.log(`      Labor: ${wo.labor_total || 0} | Parts: ${wo.parts_total || 0}`);
        console.log(`      Confidence: ${wo.extraction_confidence}%`);
        
        // Calculate labor hours
        const hours = wo.line_items
          ?.filter((item: any) => item.category === 'labor')
          ?.reduce((sum: number, item: any) => sum + (item.hours || 0), 0) || 0;
        
        totalValue += wo.labor_total || 0;
        totalHours += hours;
        
        workOrders.push({
          image_id: img.id,
          date: wo.service_date,
          labor_total: wo.labor_total,
          parts_total: wo.parts_total,
          total: wo.total,
          hours: hours,
          currency: wo.currency || 'EUR',
          confidence: wo.extraction_confidence,
          data: wo
        });
      } else {
        console.log(`   ⚠️  OCR failed or low confidence`);
      }
      
      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (err) {
      console.error(`   ❌ Error: ${err.message}`);
    }
  }
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 TOTAL FBM CONTRIBUTION');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`💰 Total Labor Value: €${totalValue.toFixed(2)}`);
  console.log(`⏱️  Total Labor Hours: ${totalHours.toFixed(1)} hrs`);
  console.log(`🎯 Target: €4,400`);
  console.log(`📈 Match: ${((totalValue / 4400) * 100).toFixed(1)}%`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  // Save to contractor_work_contributions
  if (workOrders.length > 0) {
    console.log('💾 Saving to database...\n');
    
    for (const wo of workOrders) {
      const { error: insertError } = await supabase
        .from('contractor_work_contributions')
        .upsert({
          contractor_user_id: SKYLAR_USER_ID,
          organization_id: FBM_ORG_ID,
          work_description: `Work order extracted from image: ${wo.data.work_order_number || 'Unknown'}`,
          work_category: 'other',
          work_date: wo.date || img.taken_at?.split('T')[0],
          labor_hours: wo.hours,
          total_labor_value: wo.labor_total,
          materials_cost: wo.parts_total,
          total_value: wo.total,
          source_image_id: wo.image_id,
          extracted_from_ocr: true,
          is_public: false,
          show_financial_details: false,
          show_on_contractor_profile: true,
          confidence_score: wo.confidence,
          metadata: {
            currency: wo.currency,
            extracted_data: wo.data,
            auto_extracted: true
          }
        }, {
          onConflict: 'source_image_id'
        });
      
      if (insertError) {
        console.error(`   ❌ Failed to save work order:`, insertError.message);
      } else {
        console.log(`   ✅ Saved: €${wo.total} from ${wo.date}`);
      }
    }
  }
  
  console.log('\n✅ Analysis complete!');
}

analyzeFBMWorkOrders();


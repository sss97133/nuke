/**
 * Database Assessment Script
 * Runs comprehensive health checks on the database
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not found in environment');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runAssessment() {
  console.log('🔍 Running Database Assessment...\n');
  
  try {
    // 1. Table sizes
    console.log('📊 1. TABLE SIZES');
    console.log('─'.repeat(60));
    const { data: sizes, error: sizesError } = await supabase.rpc('exec_sql', {
      query: `
        SELECT 
          schemaname,
          tablename,
          pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
          pg_total_relation_size(schemaname||'.'||tablename) AS size_bytes
        FROM pg_tables
        WHERE schemaname = 'public'
        ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
        LIMIT 20;
      `
    });
    
    if (sizesError) {
      console.log('⚠️  Could not get table sizes (RPC may not exist)');
    } else {
      console.table(sizes);
    }
    
    // 2. Vehicle statistics
    console.log('\n📊 2. VEHICLE STATISTICS');
    console.log('─'.repeat(60));
    const { data: vehicles, error: vehiclesError } = await supabase
      .from('vehicles')
      .select('id, uploaded_by, user_id, profile_origin, discovery_url, year, make, model')
      .limit(10000);
    
    if (vehiclesError) {
      console.error('❌ Error:', vehiclesError);
    } else {
      const stats = {
        total_vehicles: vehicles.length,
        unique_uploaders: new Set(vehicles.map(v => v.uploaded_by).filter(Boolean)).size,
        unique_owners: new Set(vehicles.map(v => v.user_id).filter(Boolean)).size,
        craigslist_vehicles: vehicles.filter(v => v.profile_origin === 'craigslist_scrape').length,
        discovered_vehicles: vehicles.filter(v => v.discovery_url).length,
        missing_data: vehicles.filter(v => !v.year || !v.make || !v.model).length
      };
      console.table(stats);
    }
    
    // 3. Image analysis status
    console.log('\n📊 3. IMAGE ANALYSIS STATUS');
    console.log('─'.repeat(60));
    const { data: images, error: imagesError } = await supabase
      .from('vehicle_images')
      .select('id, vehicle_id, ai_scan_metadata, ai_last_scanned, angle, category, is_document')
      .limit(10000);
    
    if (imagesError) {
      console.error('❌ Error:', imagesError);
    } else {
      const vehicleImages = images.filter(img => !img.is_document);
      const stats = {
        total_images: vehicleImages.length,
        analyzed: vehicleImages.filter(img => img.ai_scan_metadata).length,
        last_scanned_set: vehicleImages.filter(img => img.ai_last_scanned).length,
        angle_classified: vehicleImages.filter(img => img.angle).length,
        with_category: vehicleImages.filter(img => img.category).length
      };
      console.table(stats);
    }
    
    // 4. Analysis queue status
    console.log('\n📊 4. ANALYSIS QUEUE STATUS');
    console.log('─'.repeat(60));
    const { data: queue, error: queueError } = await supabase
      .from('analysis_queue')
      .select('status, retry_count, created_at, llm_provider, analysis_tier')
      .limit(1000);
    
    if (queueError) {
      if (queueError.code === '42P01') {
        console.log('⚠️  analysis_queue table does not exist yet - run migration first');
      } else {
        console.error('❌ Error:', queueError);
      }
    } else {
      const statusCounts = {};
      queue.forEach(item => {
        statusCounts[item.status] = (statusCounts[item.status] || 0) + 1;
      });
      
      const avgRetries = queue.length > 0 
        ? queue.reduce((sum, item) => sum + (item.retry_count || 0), 0) / queue.length 
        : 0;
      
      console.table({
        ...statusCounts,
        total: queue.length,
        avg_retries: avgRetries.toFixed(2)
      });
    }
    
    // 5. Vehicle valuations
    console.log('\n📊 5. VEHICLE VALUATIONS');
    console.log('─'.repeat(60));
    const { data: valuations, error: valuationsError } = await supabase
      .from('vehicle_valuations')
      .select('id, vehicle_id, estimated_value, confidence_score, valuation_date')
      .order('valuation_date', { ascending: false })
      .limit(1000);
    
    if (valuationsError) {
      if (valuationsError.code === '42P01') {
        console.log('⚠️  vehicle_valuations table does not exist yet');
      } else {
        console.error('❌ Error:', valuationsError);
      }
    } else {
      const stats = {
        total_valuations: valuations.length,
        avg_value: valuations.length > 0 
          ? (valuations.reduce((sum, v) => sum + (v.estimated_value || 0), 0) / valuations.length).toFixed(2)
          : 0,
        avg_confidence: valuations.length > 0
          ? (valuations.reduce((sum, v) => sum + (v.confidence_score || 0), 0) / valuations.length).toFixed(2)
          : 0,
        latest_valuation: valuations[0]?.valuation_date || 'None'
      };
      console.table(stats);
    }
    
    // 6. Orphaned records check
    console.log('\n📊 6. ORPHANED RECORDS CHECK');
    console.log('─'.repeat(60));
    
    // Manual check for orphaned records
    const { data: allImages } = await supabase
      .from('vehicle_images')
      .select('vehicle_id')
      .limit(10000);
    
    const { data: allVehicles } = await supabase
      .from('vehicles')
      .select('id')
      .limit(10000);
    
    if (allImages && allVehicles) {
      const vehicleIds = new Set(allVehicles.map(v => v.id));
      const orphanedImages = allImages.filter(img => img.vehicle_id && !vehicleIds.has(img.vehicle_id));
      
      // Check timeline_events
      const { data: allEvents } = await supabase
        .from('timeline_events')
        .select('vehicle_id')
        .limit(10000);
      
      const orphanedEvents = allEvents ? allEvents.filter(e => e.vehicle_id && !vehicleIds.has(e.vehicle_id)) : [];
      
      // Check vehicle_valuations
      const { data: allValuations } = await supabase
        .from('vehicle_valuations')
        .select('vehicle_id')
        .limit(10000);
      
      const orphanedValuations = allValuations ? allValuations.filter(v => v.vehicle_id && !vehicleIds.has(v.vehicle_id)) : [];
      
      console.table([
        { table: 'vehicle_images', orphaned: orphanedImages.length, total: allImages.length },
        { table: 'timeline_events', orphaned: orphanedEvents.length, total: allEvents?.length || 0 },
        { table: 'vehicle_valuations', orphaned: orphanedValuations.length, total: allValuations?.length || 0 }
      ]);
    }
    
    // 7. Timeline events check
    console.log('\n📊 7. TIMELINE EVENTS');
    console.log('─'.repeat(60));
    const { data: events, error: eventsError } = await supabase
      .from('timeline_events')
      .select('id, vehicle_id, title, source, event_type')
      .limit(1000);
    
    if (eventsError) {
      console.error('❌ Error:', eventsError);
    } else {
      const stats = {
        total_events: events.length,
        missing_title: events.filter(e => !e.title).length,
        missing_source: events.filter(e => !e.source).length,
        unique_vehicles: new Set(events.map(e => e.vehicle_id).filter(Boolean)).size
      };
      console.table(stats);
    }
    
    console.log('\n✅ Assessment complete!');
    
  } catch (error) {
    console.error('❌ Assessment failed:', error);
    process.exit(1);
  }
}

runAssessment();


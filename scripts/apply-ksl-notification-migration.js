#!/usr/bin/env node
/**
 * Apply KSL notification migration to production database
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config({ path: '.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not found');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function applyMigration() {
  console.log('🔄 Applying KSL notification migration...\n');
  
  try {
    // Step 1: Drop old constraint
    console.log('1/4 Updating notification_type constraint...');
    await supabase.rpc('exec', {
      sql: `
        ALTER TABLE admin_notifications 
        DROP CONSTRAINT IF EXISTS admin_notifications_notification_type_check;
        
        ALTER TABLE admin_notifications
        ADD CONSTRAINT admin_notifications_notification_type_check 
        CHECK (notification_type IN (
          'ownership_verification_pending',
          'vehicle_verification_pending', 
          'user_verification_pending',
          'fraud_alert',
          'system_alert',
          'new_vehicle_import'
        ));
      `
    });
    console.log('   ✅ Done\n');
    
    // Step 2: Update action constraint
    console.log('2/4 Updating action_required constraint...');
    await supabase.rpc('exec', {
      sql: `
        ALTER TABLE admin_notifications 
        DROP CONSTRAINT IF EXISTS admin_notifications_action_required_check;
        
        ALTER TABLE admin_notifications
        ADD CONSTRAINT admin_notifications_action_required_check 
        CHECK (action_required IN (
          'approve_ownership',
          'reject_ownership', 
          'approve_vehicle',
          'reject_vehicle',
          'review_fraud',
          'system_action',
          'review_import'
        ));
      `
    });
    console.log('   ✅ Done\n');
    
    // Step 3: Create function
    console.log('3/4 Creating notification function...');
    await supabase.rpc('exec', {
      sql: `
        CREATE OR REPLACE FUNCTION notify_admin_new_vehicle_import()
        RETURNS TRIGGER AS $$
        DECLARE
          vehicle_info TEXT;
        BEGIN
          IF NEW.discovery_source = 'ksl_automated_import' AND NEW.is_public = true THEN
            vehicle_info := CONCAT(NEW.year, ' ', NEW.make, ' ', NEW.model);
            
            INSERT INTO admin_notifications (
              notification_type,
              vehicle_id,
              title,
              message,
              priority,
              action_required,
              metadata,
              status
            ) VALUES (
              'new_vehicle_import',
              NEW.id,
              'New Vehicle Imported from KSL',
              format('New vehicle imported: %s. Source: %s', 
                     vehicle_info, 
                     COALESCE(NEW.discovery_url, 'KSL')),
              2,
              'review_import',
              jsonb_build_object(
                'vehicle_id', NEW.id,
                'year', NEW.year,
                'make', NEW.make,
                'model', NEW.model,
                'discovery_url', NEW.discovery_url,
                'discovery_source', NEW.discovery_source,
                'imported_at', NEW.created_at
              ),
              'pending'
            );
          END IF;
          
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
      `
    });
    console.log('   ✅ Done\n');
    
    // Step 4: Create trigger
    console.log('4/4 Creating trigger...');
    await supabase.rpc('exec', {
      sql: `
        DROP TRIGGER IF EXISTS trigger_notify_admin_new_vehicle_import ON vehicles;
        CREATE TRIGGER trigger_notify_admin_new_vehicle_import
          AFTER INSERT ON vehicles
          FOR EACH ROW
          EXECUTE FUNCTION notify_admin_new_vehicle_import();
      `
    });
    console.log('   ✅ Done\n');
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ Migration applied successfully!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('New KSL imports will now create admin notifications.');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('\nFalling back to manual SQL execution...');
    console.log('\nPlease run this SQL in Supabase Dashboard → SQL Editor:');
    console.log(fs.readFileSync('supabase/migrations/20251202015702_ksl_import_notifications.sql', 'utf-8'));
  }
}

applyMigration();


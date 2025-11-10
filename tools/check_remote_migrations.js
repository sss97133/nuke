#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

const migrationsDir = path.resolve('supabase', 'migrations');

const remoteMigrations = [
  ['20250101', 'minimal_setup'],
  ['20250102', 'create_receipts_bucket'],
  ['20250104', 'discovery_system'],
  ['20250109', 'add_payment_verified'],
  ['20250111', 'add_gps_to_vehicle_images'],
  ['20250117', 'vehicle_images_table'],
  ['20250118', 'timeline_events_schema'],
  ['20250119', 'data_annotation_schema'],
  ['20250120', 'image_social_features'],
  ['20250121', 'universal_commenting_system'],
  ['20250123', 'vehicle_discovery_tracking'],
  ['20250130', 'ownership_verification_system'],
  ['20250131', 'profile_enhancement_system'],
  ['20250201', '120000_vin_validations_table'],
  ['20250202', '135000_user_verification_system'],
  ['20250203', 'bat_auction_data_fields'],
  ['20250204', 'fix_missing_profile_tables'],
  ['20250830', 'vehicle_events_extension'],
  ['20250831075312', 'profile_activity_system'],
  ['20250831093300', 'fix_timeline_events'],
  ['20250831100000', 'enhance_timeline_events'],
  ['20250831120000', 'fix_timeline_data_source'],
  ['20250831140000', 'professional_toolbox_system'],
  ['20250831155000', 'create_work_sessions'],
  ['20250831160000', 'user_activity_system'],
  ['20250831170000', 'fix_duplicate_detection_schema'],
  ['20250831220000', 'fix_auth_user_trigger'],
  ['20250901033218', 'fix_storage_policies_only'],
  ['20250902', 'enhanced_data_provenance'],
  ['20250903', 'pii_protection_system'],
  ['20250904', 'fix_vehicle_images_schema'],
  ['20250905', 'add_image_external_support'],
  ['20250906', 'add_drivetrain_field'],
  ['20250907', 'add_draft_support'],
  ['20250908201200', 'add_draft_support'],
  ['20250908201210', 'enhanced_data_provenance_fix'],
  ['20250908201220', 'fix_auth_rls_initplan'],
  ['20250908201230', 'fix_profile_creation_followup'],
  ['20250908201240', 'fix_trigger_security_fix'],
  ['20250908201250', 'shop_items'],
  ['20250908201300', 'user_live_state'],
  ['20250908213000', 'verification_rls'],
  ['20250908213500', 'promote_self_admin'],
  ['20250909', 'ownership_tracking'],
  ['20250911', 'fix_profile_id_trigger'],
  ['20250912', 'fix_vehicle_images_primary'],
  ['20250913', 'insert_missing_image_record'],
  ['20250914', 'discovery_feed_functions'],
  ['20250927', 'comprehensive_tagging_system'],
  ['20251001', 'add_brand_logos'],
  ['20251108', 'marketplace_deal_alerts']
];

const missing = [];
remoteMigrations.forEach(([version, name]) => {
  const fileName = `${version}_${name}.sql`;
  const filePath = path.join(migrationsDir, fileName);
  if (!fs.existsSync(filePath)) {
    missing.push(fileName);
  }
});

if (missing.length === 0) {
  console.log('All remote migrations are present locally.');
} else {
  console.log('Missing migration files:');
  missing.forEach((file) => console.log(`  - ${file}`));
  process.exitCode = 1;
}


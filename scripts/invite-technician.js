#!/usr/bin/env node
/**
 * Invite a technician to Nuke via SMS
 *
 * Usage:
 *   node scripts/invite-technician.js +17025551234 "John" [shop-id]
 *
 * This will:
 * 1. Create a technician_phone_link record
 * 2. Send them a welcome SMS
 * 3. Start the onboarding flow
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Your user ID (Skylar)
const INVITER_ID = '0b9f107a-d124-49de-9ded-94698f63c1c4';

async function hashPhone(phone) {
  const encoder = new TextEncoder();
  const data = encoder.encode(phone);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.log(`
╔════════════════════════════════════════════════════════════════╗
║             INVITE TECHNICIAN TO NUKE                          ║
╠════════════════════════════════════════════════════════════════╣
║                                                                ║
║  Usage:                                                        ║
║    node scripts/invite-technician.js <phone> [name] [shop-id]  ║
║                                                                ║
║  Examples:                                                     ║
║    node scripts/invite-technician.js +17025551234              ║
║    node scripts/invite-technician.js +17025551234 "John"       ║
║    node scripts/invite-technician.js +17025551234 "John" abc123║
║                                                                ║
║  Phone must be E.164 format: +1XXXXXXXXXX                      ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
`);
    process.exit(1);
  }

  const phone = args[0];
  const name = args[1] || null;
  const shopId = args[2] || null;

  // Validate phone format
  if (!phone.match(/^\+1\d{10}$/)) {
    console.error('❌ Phone must be E.164 format: +1XXXXXXXXXX');
    process.exit(1);
  }

  console.log(`\n📱 Inviting technician...`);
  console.log(`   Phone: ${phone}`);
  if (name) console.log(`   Name: ${name}`);
  if (shopId) console.log(`   Shop: ${shopId}`);

  // Hash phone
  const phoneHash = await hashPhone(phone);

  // Check if already exists
  const { data: existing } = await supabase
    .from('technician_phone_links')
    .select('id, display_name, onboarding_status')
    .eq('phone_hash', phoneHash)
    .single();

  if (existing) {
    console.log(`\n⚠️  Technician already exists:`);
    console.log(`   ID: ${existing.id}`);
    console.log(`   Name: ${existing.display_name || '(unnamed)'}`);
    console.log(`   Status: ${existing.onboarding_status}`);
    console.log(`\n   To re-send welcome message, use the scheduler.`);
    process.exit(0);
  }

  // Create technician link
  const { data: techLink, error: createError } = await supabase
    .from('technician_phone_links')
    .insert({
      phone_number: phone,
      phone_hash: phoneHash,
      display_name: name,
      invited_by: INVITER_ID,
      primary_shop_id: shopId,
      onboarding_status: 'pending_verification',
    })
    .select()
    .single();

  if (createError) {
    console.error('❌ Failed to create technician link:', createError.message);
    process.exit(1);
  }

  console.log(`\n✅ Technician link created: ${techLink.id}`);

  // Create welcome reminder (will be sent immediately or on next scheduler run)
  const welcomeMessage = name
    ? `Hey ${name}! You've been invited to log work on Nuke. Just text photos of your work here and I'll track it for you. Reply with your preferred payment method (venmo/zelle/paypal) to get started!`
    : `Hey! You've been invited to log work on Nuke. Just text photos of your work here and I'll track it for you. First, what should I call you?`;

  const { error: reminderError } = await supabase
    .from('sms_reminders')
    .insert({
      technician_phone_link_id: techLink.id,
      reminder_type: 'welcome',
      message_template: welcomeMessage,
      scheduled_for: new Date().toISOString(),
      status: 'scheduled',
    });

  if (reminderError) {
    console.log(`⚠️  Could not schedule welcome message: ${reminderError.message}`);
    console.log(`   You can manually text them or run the scheduler.`);
  } else {
    console.log(`📤 Welcome message scheduled`);
  }

  console.log(`
╔════════════════════════════════════════════════════════════════╗
║                    TECHNICIAN INVITED                          ║
╠════════════════════════════════════════════════════════════════╣
║                                                                ║
║  ID: ${techLink.id.padEnd(40)}║
║  Phone: ${phone.padEnd(38)}║
║  Name: ${(name || '(will ask)').padEnd(39)}║
║  Status: pending_verification                                  ║
║                                                                ║
║  Next steps:                                                   ║
║  1. Run scheduler to send welcome: npm run sms:send            ║
║  2. Or text them directly to start onboarding                  ║
║  3. They text back → AI handles onboarding                     ║
║  4. They send photos → AI logs work                            ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
`);
}

main().catch(console.error);

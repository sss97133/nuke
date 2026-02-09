/**
 * Test phone OTP (SMS) for Supabase Auth. Run after configuring Twilio in Supabase Dashboard.
 * Usage: npm run test:phone-otp -- +1XXXXXXXXXX
 */

import 'dotenv/config';
import { config } from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

config({ path: path.join(process.cwd(), '.env') });
config({ path: path.join(process.cwd(), 'nuke_api', '.env') });

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

const phone = process.argv.find((a) => a.startsWith('+') && /^\+?\d{10,15}$/.test(a.replace(/\s/g, '')))
  || process.argv[2];

if (!url || !key) {
  console.error('Missing VITE_SUPABASE_URL/SUPABASE_URL or VITE_SUPABASE_ANON_KEY/SUPABASE_ANON_KEY in .env');
  process.exit(1);
}

if (!phone) {
  console.error('Usage: npm run test:phone-otp -- +1XXXXXXXXXX');
  process.exit(1);
}

const normalized = phone.replace(/\s/g, '');
const supabase = createClient(url, key);

async function main() {
  console.log('Sending OTP to', normalized, '...');
  const { data, error } = await supabase.auth.signInWithOtp({ phone: normalized });
  if (error) {
    console.error('Error:', error.message);
    if (error.message.includes('20003') || error.message.toLowerCase().includes('authenticate')) {
      console.error('→ Twilio credentials in Supabase are wrong or expired. See docs/guides/TWILIO_PHONE_AUTH_SETUP.md');
    }
    process.exit(1);
  }
  console.log('OTP sent. Check the phone for the code.');
  if (data) console.log('Session:', !!data.session, 'User:', !!data.user);
}

main();

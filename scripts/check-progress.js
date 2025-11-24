#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

const envPath = path.resolve(process.cwd(), '.env.local');
const envConfig = dotenv.parse(fs.readFileSync(envPath));

const SUPABASE_URL = envConfig.VITE_SUPABASE_URL || envConfig.SUPABASE_URL;
const SUPABASE_KEY = envConfig.VITE_SUPABASE_SERVICE_ROLE_KEY || envConfig.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const { count: processed } = await supabase
  .from('vehicle_images')
  .select('*', { count: 'exact', head: true })
  .not('ai_last_scanned', 'is', null)
  .not('vehicle_id', 'is', null);

const { count: total } = await supabase
  .from('vehicle_images')
  .select('*', { count: 'exact', head: true })
  .not('vehicle_id', 'is', null);

const remaining = total - processed;
const percent = (processed / total * 100).toFixed(1);

console.log('');
console.log('════════════════════════════════════════════════════════════');
console.log('  IMAGE BACKFILL - LIVE PROGRESS');
console.log('════════════════════════════════════════════════════════════');
console.log('');
console.log(`  Total:      ${total.toLocaleString()} images`);
console.log(`  Processed:  ${processed.toLocaleString()} (${percent}%)`);
console.log(`  Remaining:  ${remaining.toLocaleString()}`);
console.log('');

// Progress bar
const barWidth = 50;
const filled = Math.floor(percent / 100 * barWidth);
const empty = barWidth - filled;
console.log('  [' + '█'.repeat(filled) + '░'.repeat(empty) + '] ' + percent + '%');

console.log('');
console.log(`  ${new Date().toLocaleTimeString()}`);
console.log('');
console.log('════════════════════════════════════════════════════════════');
console.log('');


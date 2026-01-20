#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');

dotenv.config({ path: path.join(repoRoot, 'nuke_frontend', '.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('ERROR: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run') || args.includes('-d');
const idFlagIndex = args.findIndex((arg) => arg === '--id' || arg === '-i');
const vehicleId = idFlagIndex >= 0 ? args[idFlagIndex + 1] : args.find((arg) => !arg.startsWith('-'));

const getJwtRole = (token) => {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
    return payload?.role || null;
  } catch {
    return null;
  }
};

const keyRole = getJwtRole(supabaseServiceKey);
if (keyRole && keyRole !== 'service_role') {
  console.warn(`WARNING: Supabase key role is "${keyRole}". Updates may be blocked without service_role.`);
}

if (!vehicleId) {
  console.error('Usage: node scripts/maintenance/unpublish_vehicle.js <vehicle_id> [--dry-run]');
  process.exit(1);
}

const formatLabel = (record) => {
  if (!record) return 'Unknown vehicle';
  const parts = [record.year, record.make, record.model].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : record.id;
};

async function unpublishVehicle() {
  const { data: existing, error: lookupError } = await supabase
    .from('vehicles')
    .select('id, year, make, model, is_public, status')
    .eq('id', vehicleId)
    .single();

  if (lookupError || !existing) {
    console.error('ERROR: Vehicle not found or lookup failed.', lookupError?.message || '');
    process.exit(1);
  }

  console.log(`Found vehicle: ${formatLabel(existing)} (${existing.id})`);
  console.log(`Current visibility: is_public=${existing.is_public} status=${existing.status || 'null'}`);

  if (dryRun) {
    console.log('Dry run enabled. No changes applied.');
    return;
  }

  const updates = {
    is_public: false,
    status: 'archived'
  };

  const { data: updatedRows, error: updateError } = await supabase
    .from('vehicles')
    .update(updates)
    .eq('id', vehicleId)
    .select('id, year, make, model, is_public, status');

  if (updateError) {
    console.error('ERROR: Failed to update vehicle.', updateError.message);
    process.exit(1);
  }

  let updated = Array.isArray(updatedRows) ? updatedRows[0] : null;
  if (!updated) {
    const { data: refreshed, error: refreshError } = await supabase
      .from('vehicles')
      .select('id, year, make, model, is_public, status')
      .eq('id', vehicleId)
      .single();
    if (refreshError || !refreshed) {
      console.error('ERROR: Update applied but confirmation fetch failed.', refreshError?.message || '');
      process.exit(1);
    }
    updated = refreshed;
  }

  console.log(`Updated vehicle: ${formatLabel(updated)} (${updated.id})`);
  console.log(`New visibility: is_public=${updated.is_public} status=${updated.status || 'null'}`);

  if (updated.is_public !== false) {
    console.error('ERROR: Vehicle is still public. Verify the service role key and retry.');
    process.exit(1);
  }

  if (updated.status !== 'archived') {
    console.warn('WARNING: Status did not update to archived. Visibility was still updated.');
  }
}

unpublishVehicle().catch((err) => {
  console.error('ERROR: Unhandled failure.', err?.message || err);
  process.exit(1);
});

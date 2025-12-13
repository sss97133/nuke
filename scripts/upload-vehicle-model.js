#!/usr/bin/env node

/**
 * Upload a 3D model file to Supabase Storage bucket `vehicle-models`
 * and print a signed URL you can share.
 *
 * Usage:
 *   node scripts/upload-vehicle-model.js /absolute/path/to/model.blend --vehicle <vehicleId>
 *
 * Notes:
 * - Requires SUPABASE_SERVICE_ROLE_KEY (preferred) OR VITE_SUPABASE_ANON_KEY (if you are logged-in flow elsewhere).
 * - With the migration, the in-app upload convention is:
 *     <auth.uid()>/<vehicleId>/<filename>
 *   This script uses `shared/<vehicleId>/...` by default because it runs with service role.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      args[key] = value;
    } else {
      args._.push(a);
    }
  }
  return args;
}

function guessContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.zip') return 'application/zip';
  if (ext === '.glb') return 'model/gltf-binary';
  if (ext === '.gltf') return 'model/gltf+json';
  if (ext === '.fbx') return 'application/x-fbx';
  // .blend and everything else
  return 'application/octet-stream';
}

async function main() {
  const args = parseArgs(process.argv);
  const filePath = args._[0];
  const vehicleId = args.vehicle || args.vehicleId || 'unknown-vehicle';
  const bucket = 'vehicle-models';

  if (!filePath) {
    console.error('Missing file path.\nUsage: node scripts/upload-vehicle-model.js /abs/path/to/model.blend --vehicle <vehicleId>');
    process.exit(1);
  }
  if (!path.isAbsolute(filePath)) {
    console.error('Please pass an absolute file path (e.g. /Users/you/Desktop/model.blend).');
    process.exit(1);
  }
  if (!fs.existsSync(filePath)) {
    console.error('File not found:', filePath);
    process.exit(1);
  }

  const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim();
  if (!supabaseUrl) {
    console.error('Missing VITE_SUPABASE_URL (or SUPABASE_URL) in your env.');
    process.exit(1);
  }
  if (!key) {
    console.error('Missing SUPABASE_SERVICE_ROLE_KEY in your env (required for this script).');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const baseName = path.basename(filePath).replace(/\s+/g, '_');
  const objectPath = `shared/${vehicleId}/${Date.now()}_${baseName}`;
  const contentType = guessContentType(filePath);
  const bytes = fs.readFileSync(filePath);

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(objectPath, bytes, { contentType, upsert: false });

  if (uploadError) {
    console.error('Upload failed:', uploadError);
    process.exit(1);
  }

  // 7 days
  const { data: signed, error: signedError } = await supabase.storage
    .from(bucket)
    .createSignedUrl(objectPath, 60 * 60 * 24 * 7);

  if (signedError) {
    console.error('Signed URL creation failed:', signedError);
    process.exit(1);
  }

  console.log('Uploaded to:', `${bucket}/${objectPath}`);
  console.log('Signed URL:', signed.signedUrl);
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});



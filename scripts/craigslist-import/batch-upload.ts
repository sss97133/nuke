#!/usr/bin/env npx tsx
import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { createClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';

const DB_PATH = '/Users/skylar/nuke/data/archive-inventory.db';
const LOG_PATH = '/Users/skylar/nuke/data/upload-progress.log';
const db = new Database(DB_PATH);

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) { console.error('Missing env vars'); process.exit(1); }

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_PATH, line + '\n');
}

const stats = { dupes: 0, uploaded: 0, skipped: 0, failed: 0, images: 0, contacts: 0, start: Date.now() };
const HISTORIAN_ID = '13450c45-3e8b-4124-9f5b-5c512094ff04';

log('=== BATCH UPLOAD STARTING ===');

try { db.exec(`ALTER TABLE listings ADD COLUMN is_duplicate BOOLEAN DEFAULT FALSE`); } catch {}
try { db.exec(`ALTER TABLE listings ADD COLUMN upload_status TEXT DEFAULT 'pending'`); } catch {}
try { db.exec(`ALTER TABLE listings ADD COLUMN remote_vehicle_id TEXT`); } catch {}

const dupeGroups = db.prepare(`
  SELECT post_id, GROUP_CONCAT(id) as ids FROM listings
  WHERE post_id IS NOT NULL AND post_id != ''
  GROUP BY post_id HAVING COUNT(*) > 1
`).all() as any[];

for (const g of dupeGroups) {
  const ids = g.ids.split(',').map(Number);
  const best = db.prepare(`SELECT id FROM listings WHERE id IN (${ids.join(',')}) ORDER BY data_quality_score DESC LIMIT 1`).get() as any;
  db.prepare(`UPDATE listings SET is_duplicate = TRUE WHERE id IN (${ids.join(',')}) AND id != ?`).run(best.id);
  stats.dupes += ids.length - 1;
}
db.prepare(`UPDATE listings SET is_duplicate = TRUE WHERE title IS NULL OR title = ''`).run();
log(`Marked ${stats.dupes} duplicates`);

const queue = db.prepare(`
  SELECT l.*, f.path as file_path FROM listings l
  JOIN files f ON l.file_id = f.id
  WHERE l.is_duplicate = FALSE AND (l.upload_status IS NULL OR l.upload_status = 'pending')
  AND l.data_quality_score >= 40
  ORDER BY l.data_quality_score DESC
`).all() as any[];

log(`${queue.length} listings to upload`);

async function uploadOne(listing: any) {
  try {
    const { data: existing } = await supabase.from('vehicles').select('id')
      .contains('origin_metadata', { craigslist_post_id: listing.post_id }).single();
    if (existing) { stats.skipped++; return { ok: true, id: existing.id, skip: true }; }

    const vData = {
      make: listing.make || 'Unknown', model: listing.model || listing.title?.substring(0,100),
      year: listing.year, vin: listing.vin, asking_price: listing.price, mileage: listing.odometer,
      notes: listing.description?.substring(0,5000),
      discovery_source: listing.source_site === 'ksl' ? 'ksl_archive' : 'craigslist_archive',
      discovery_url: listing.original_url, is_public: true, status: 'archived',
      origin_metadata: {
        craigslist_post_id: listing.post_id, listing_date: listing.post_date,
        location: listing.location, archive_file: listing.file_path,
        historian_id: HISTORIAN_ID, quality: listing.data_quality_score
      }
    };

    const { data: v, error } = await supabase.from('vehicles').insert(vData).select('id').single();
    if (error) throw new Error(error.message);

    await supabase.from('vehicle_contributor_roles').upsert({
      vehicle_id: v.id, user_id: HISTORIAN_ID, role: 'historian',
      notes: `Preserved ${listing.source_site} listing`, is_active: true
    }, { onConflict: 'vehicle_id,user_id,role' });

    if (listing.phone_normalized) {
      const hash = crypto.createHash('sha256').update(listing.phone_normalized).digest('hex');
      const { data: ec } = await supabase.from('unverified_contacts').select('id').eq('phone_hash', hash).single();
      let cid = ec?.id;
      if (!cid) {
        const { data: nc } = await supabase.from('unverified_contacts').insert({
          phone_number: listing.phone_normalized, phone_raw: listing.phone_raw,
          phone_hash: hash, location: listing.location
        }).select('id').single();
        cid = nc?.id; stats.contacts++;
      }
      if (cid) {
        await supabase.from('vehicle_unverified_owners').upsert({
          vehicle_id: v.id, contact_id: cid, source_post_id: listing.post_id,
          asking_price: listing.price, relationship_type: 'seller'
        }, { onConflict: 'vehicle_id,contact_id,source_post_id' });
      }
    }
    stats.uploaded++;
    return { ok: true, id: v.id };
  } catch (e: any) { stats.failed++; return { ok: false, err: e.message }; }
}

async function uploadImages(vid: string, listing: any) {
  let n = 0;
  const dir = listing.file_path.replace(/\.(html?|webarchive)$/i, '_files');
  if (!fs.existsSync(dir)) return 0;
  const imgs = fs.readdirSync(dir).filter(f => /\.(jpe?g|png|gif)$/i.test(f) && !f.includes('50x50')).slice(0,15);
  for (const img of imgs) {
    try {
      const p = path.join(dir, img); const s = fs.statSync(p);
      if (s.size < 5000) continue;
      const buf = fs.readFileSync(p);
      const ext = path.extname(img).toLowerCase();
      const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
      const sp = `archive/${vid}/${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
      const { error } = await supabase.storage.from('vehicle-images').upload(sp, buf, { contentType: mime });
      if (!error) {
        const { data } = supabase.storage.from('vehicle-images').getPublicUrl(sp);
        if (data?.publicUrl) {
          await supabase.from('vehicle_images').insert({ vehicle_id: vid, url: data.publicUrl, category: n===0?'exterior':'general' });
          n++; stats.images++;
        }
      }
    } catch {}
  }
  return n;
}

async function main() {
  for (let i = 0; i < queue.length; i++) {
    const l = queue[i];
    const r = await uploadOne(l);
    if (r.ok && r.id && !r.skip) {
      const imgs = await uploadImages(r.id, l);
      db.prepare(`UPDATE listings SET upload_status='uploaded', remote_vehicle_id=? WHERE id=?`).run(r.id, l.id);
      const yr = l.year||'????', mk = l.make||'?', md = (l.model||'').substring(0,15);
      const pr = l.price ? `$${l.price.toLocaleString()}` : 'N/A';
      log(`[${i+1}/${queue.length}] ${yr} ${mk} ${md} - ${pr} [${imgs} img]`);
    } else if (r.skip) {
      db.prepare(`UPDATE listings SET upload_status='skipped' WHERE id=?`).run(l.id);
    } else {
      db.prepare(`UPDATE listings SET upload_status='failed' WHERE id=?`).run(l.id);
      log(`FAIL: ${l.title?.substring(0,30)} - ${r.err}`);
    }
    await new Promise(r => setTimeout(r, 50));
  }

  const mins = ((Date.now() - stats.start) / 60000).toFixed(1);
  log('=== COMPLETE ===');
  log(`Time: ${mins} min | Uploaded: ${stats.uploaded} | Skipped: ${stats.skipped} | Failed: ${stats.failed}`);
  log(`Images: ${stats.images} | Contacts: ${stats.contacts} | Dupes: ${stats.dupes}`);
}

main().catch(e => { log(`FATAL: ${e.message}`); process.exit(1); });

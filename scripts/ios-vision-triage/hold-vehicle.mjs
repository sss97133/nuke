#!/usr/bin/env node
// Run the iOS app's photo rule over one vehicle's public frames, and hold what the rule holds.
//
//   dotenvx run -- node scripts/ios-vision-triage/hold-vehicle.mjs <vehicle_id> [--apply]
//
// Reads every frame of the vehicle the public can see (vision gate approved, pending or null; not superseded,
// duplicates included), downloads each from storage, and runs VisionEngine through the runner build.sh makes. A frame
// is held when the rule calls it clutter (a top-three label is a document, receipt, web or product capture) or
// personal (a prominent face and no vehicle). Everything else stays, including part close-ups Apple does not tag as
// a vehicle, and a frame that cannot be read is reported, not held. Without --apply it prints the verdicts only;
// with --apply it sends the holds to hold_frames_by_device_triage, which only hides public frames and recomputes the
// vehicle's cover. The rule decides which pixels may be public, not which vehicle a frame shows.
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const [vehicleId, ...flags] = process.argv.slice(2);
const apply = flags.includes('--apply');
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(vehicleId ?? '')) {
  console.error('usage: hold-vehicle.mjs <vehicle_id> [--apply]');
  process.exit(2);
}
const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const engine = execFileSync('git', ['-C', repo, 'hash-object', 'apps/nuke-capture-ios/Sources/NukeCapture/VisionEngine.swift'])
  .toString().trim().slice(0, 12);
const bin = execFileSync('bash', [join(here, 'build.sh')]).toString().trim().split('\n').pop();

// The vehicle's public frames, by id, 300 at a time.
const frames = [];
for (let last = '00000000-0000-0000-0000-000000000000'; ;) {
  const { data, error } = await sb.from('vehicle_images')
    .select('id, image_url, vision_gate_status')
    .eq('vehicle_id', vehicleId)
    .not('is_superseded', 'is', true)
    .or('vision_gate_status.is.null,vision_gate_status.in.(approved,pending)')
    .gt('id', last).order('id').limit(300);
  if (error) throw error;
  frames.push(...data.filter(f => f.image_url));
  if (data.length < 300) break;
  last = data[data.length - 1].id;
}

const dir = mkdtempSync(join(tmpdir(), 'ios-triage-'));
const verdicts = new Map();
let unreadable = 0;
try {
  // Download six at a time, then judge a hundred files per runner call.
  const files = [];
  for (let i = 0; i < frames.length; i += 6) {
    await Promise.all(frames.slice(i, i + 6).map(async f => {
      try {
        const res = await fetch(f.image_url, { signal: AbortSignal.timeout(90_000) });
        if (!res.ok) throw new Error(String(res.status));
        const path = join(dir, f.id);
        writeFileSync(path, Buffer.from(await res.arrayBuffer()));
        files.push(path);
      } catch { unreadable += 1; }
    }));
  }
  for (let i = 0; i < files.length; i += 100) {
    const out = execFileSync(bin, files.slice(i, i + 100), { maxBuffer: 64 << 20 }).toString();
    for (const line of out.split('\n').filter(Boolean)) {
      const v = JSON.parse(line);
      verdicts.set(v.file.split('/').pop(), v);
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const holds = [];
const tally = { clutter: 0, personal: 0, kept: 0, unreadable };
for (const f of frames) {
  const v = verdicts.get(f.id);
  if (!v) continue;
  if (!v.ok) { tally.unreadable += 1; continue; }
  const hold = v.clutter ? 'clutter' : v.isPersonal ? 'personal' : null;
  if (!hold) { tally.kept += 1; continue; }
  tally[hold] += 1;
  holds.push({ image_id: f.id, hold, engine, labels: v.labels.slice(0, 12), was: f.vision_gate_status ?? 'ungated' });
}
console.log(JSON.stringify({ vehicle_id: vehicleId, engine, public_frames: frames.length, ...tally }));
for (const h of holds) console.log(`${h.hold}\t${h.image_id}\t${h.was}\t${h.labels.slice(0, 3).join(', ')}`);

if (apply && holds.length) {
  for (let i = 0; i < holds.length; i += 500) {
    const chunk = holds.slice(i, i + 500).map(({ was, ...v }) => v);
    const { data, error } = await sb.rpc('hold_frames_by_device_triage', { p_verdicts: chunk });
    if (error) throw error;
    console.log(JSON.stringify(data));
  }
}

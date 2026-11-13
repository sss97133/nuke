#!/usr/bin/env node
// bat-submit-worker.mjs: fill a Bring a Trailer seller submission from a
// listing_exports browser_submit job, in the owner's own Chrome session.
//
// It fills every decode / observe / deliberate field the job carries, uploads
// the package's photos, presses Next between steps, and stops before Finish.
// Sign-tier questions (listing history, dealer, consignment, title and
// registration, purchase year, odometer, documents, reserve, fees,
// attestations, contact) are never touched: they are the owner's taps. BaT
// autosaves the draft under My Listings ("Resume submission"), so a stopped
// run resumes by running again with the same job.
//
// Chrome: quit Chrome, then start it with the owner's normal profile and a
// local debugging port, signed in to bringatrailer.com as usual:
//   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
//     --remote-debugging-port=9222 --user-data-dir="$HOME/Library/Application Support/Google/Chrome"
// (Recent Chrome refuses the port on the default data dir; if so, use a
// dedicated dir such as "$HOME/.chrome-bat" and sign in to BaT there once.)
// The worker never reads or stores a password or cookie; it drives the tab.
//
// Run (job from the database; the owner's session token reads and writes
// only the owner's own rows under RLS, and photos come from the gated
// vehicle_images read):
//   dotenvx run -- node scripts/listing/bat-submit-worker.mjs <listing_exports id>
// Offline (a local job JSON; writes the receipt beside it):
//   node scripts/listing/bat-submit-worker.mjs --job path/to/job.json
// Flags: --cdp http://127.0.0.1:9222   --draft-url <Resume submission URL>
//        --plan   read the form and print the plan without typing anything
//
// Env (database mode): VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (publishable),
// NUKE_USER_JWT (the owner's access token from a signed-in nuke.ag session).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { FORBIDDEN_BUTTON, pickOption, planFill } from './bat-submit-plan.mjs';

const START_URL = 'https://bringatrailer.com/account/listings/new/';

function args(argv) {
  const o = { id: null, job: null, cdp: 'http://127.0.0.1:9222', draftUrl: null, plan: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--job') o.job = argv[++i];
    else if (a === '--cdp') o.cdp = argv[++i];
    else if (a === '--draft-url') o.draftUrl = argv[++i];
    else if (a === '--plan') o.plan = true;
    else if (!a.startsWith('--')) o.id = a;
  }
  if (!o.id && !o.job) throw new Error('usage: bat-submit-worker.mjs <listing_exports id> | --job file.json [--plan]');
  return o;
}

async function db() {
  const { createClient } = await import('@supabase/supabase-js');
  const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const anon = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
  const jwt = process.env.NUKE_USER_JWT;
  if (!url || !anon || !jwt) throw new Error('database mode needs VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY and NUKE_USER_JWT');
  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}

async function loadJob(o) {
  if (o.job) {
    const j = JSON.parse(readFileSync(o.job, 'utf8'));
    return { row: null, job: j.metadata?.job ?? j.job ?? j };
  }
  const sb = await db();
  const { data, error } = await sb.from('listing_exports').select('id, vehicle_id, platform, metadata').eq('id', o.id).single();
  if (error) throw new Error(`listing_exports read failed: ${error.message}`);
  const job = data?.metadata?.job;
  if (job?.kind !== 'browser_submit' || job?.platform !== 'bat') throw new Error('not a BaT browser_submit job');
  return { row: data, job, sb };
}

// Photos: local paths (offline job) or rows the owner can read from
// vehicle_images (the gate applies); never a URL the job carries on its own.
async function stagePhotos(job, sb, dir) {
  const entries = job.field_map?.Photos?.value ?? [];
  const local = entries.filter((e) => e.path).map((e) => resolve(e.path));
  const ids = entries.map((e) => e.image_id).filter(Boolean);
  if (!ids.length || !sb) return { files: local, gated: 0 };
  const files = [...local];
  let gated = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const { data, error } = await sb.from('vehicle_images').select('id, image_url').in('id', chunk);
    if (error) throw new Error(`vehicle_images read failed: ${error.message}`);
    const readable = new Map((data ?? []).map((r) => [r.id, r.image_url]));
    gated += chunk.length - readable.size;
    for (const id of chunk) {
      const url = readable.get(id);
      if (!url) continue;
      const res = await fetch(url);
      if (!res.ok) { gated++; continue; }
      const ext = (res.headers.get('content-type') ?? '').includes('png') ? 'png' : 'jpg';
      const f = join(dir, `${String(files.length).padStart(3, '0')}-${id}.${ext}`);
      writeFileSync(f, Buffer.from(await res.arrayBuffer()));
      files.push(f);
    }
  }
  return { files, gated };
}

// Read the visible questions of the current step in DOM order. Gravity Forms
// wraps each question in .gfield with a .gfield_label; fall back to label[for].
async function readQuestions(page) {
  return page.evaluate(() => {
    const vis = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const out = [];
    const boxes = [...document.querySelectorAll('.gfield')].filter(vis);
    boxes.forEach((box, i) => {
      const lab = box.querySelector('.gfield_label, legend, label');
      const input = box.querySelector('input:not([type=hidden]), select, textarea');
      if (!lab || !input) return;
      box.setAttribute('data-nuke-q', String(i));
      out.push({ label: lab.textContent.trim(), name: input.getAttribute('name'), q: String(i) });
    });
    return out;
  });
}

async function fillOne(page, step, photos) {
  const box = page.locator(`[data-nuke-q="${step.q ?? ''}"]`).first();
  const v = step.value;
  switch (step.control) {
    case 'select': {
      const sel = box.locator('select').first();
      const options = await sel.locator('option').allTextContents();
      const pick = pickOption(options, v);
      if (!pick) return `no option for ${JSON.stringify(v)}`;
      await sel.selectOption({ label: pick });
      await page.waitForTimeout(900); // dependent selects (make -> model) load after a change
      return null;
    }
    case 'text':
    case 'textarea':
    case 'address': {
      const el = box.locator('input:not([type=hidden]), textarea').first();
      if ((await el.inputValue()).trim()) return 'kept existing value'; // resumed draft or owner edit
      await el.fill(String(v));
      return null;
    }
    case 'radio': {
      const opt = box.locator('label', { hasText: new RegExp(`^\\s*${String(v)}\\s*$`, 'i') }).first();
      if (!(await opt.count())) return `no choice ${v}`;
      await opt.click();
      return null;
    }
    case 'checkboxes': {
      const want = Array.isArray(v) ? v : [v];
      const missed = [];
      for (const w of want) {
        const cb = box.getByLabel(String(w), { exact: false }).first();
        if (await cb.count()) await cb.check(); else missed.push(w);
      }
      return missed.length ? `no checkbox ${missed.join(', ')}` : null;
    }
    case 'files': {
      if (!photos.files.length) return 'no readable photos';
      const input = page.locator('input[type=file][name="files[]"]').first();
      for (let i = 0; i < photos.files.length; i += 50) {
        await input.setInputFiles(photos.files.slice(i, i + 50));
        await page.waitForTimeout(3000);
      }
      return null;
    }
    default:
      return `unknown control ${step.control}`;
  }
}

async function pressNext(page) {
  const btns = page.locator('form input[type=button], form button, form input[type=submit]');
  const n = await btns.count();
  for (let i = 0; i < n; i++) {
    const b = btns.nth(i);
    if (!(await b.isVisible())) continue;
    const t = ((await b.getAttribute('value')) ?? (await b.textContent()) ?? '').trim();
    if (FORBIDDEN_BUTTON.test(t)) continue; // never Finish / Submit
    if (/^next\b/i.test(t)) { await b.click(); await page.waitForTimeout(2500); return true; }
  }
  return false;
}

async function main() {
  const o = args(process.argv.slice(2));
  const { row, job, sb } = await loadJob(o);
  const dir = join(tmpdir(), `bat-submit-${row?.id ?? 'job'}`);
  mkdirSync(dir, { recursive: true });
  const photos = o.plan ? { files: [], gated: 0 } : await stagePhotos(job, sb, dir);

  const { chromium } = await import('playwright');
  const browser = await chromium.connectOverCDP(o.cdp);
  const ctx = browser.contexts()[0];
  const resume = o.draftUrl ?? row?.metadata?.worker?.draft_url ?? null;
  let page = ctx.pages().find((p) => p.url().includes('bringatrailer.com/account/listings/new'));
  if (!page) { page = await ctx.newPage(); await page.goto(resume ?? START_URL, { waitUntil: 'domcontentloaded' }); }

  const filled = [], notes = [], unmatched = new Set(), notOnForm = new Set();
  let stoppedAt = null;
  for (let stepNo = 0; stepNo < 6; stepNo++) {
    const dom = await readQuestions(page);
    const plan = planFill(dom, job.field_map);
    plan.unmatched.forEach((u) => unmatched.add(u));
    plan.notOnForm.forEach((u) => notOnForm.add(u));
    for (const s of plan.fill) {
      s.q = dom[s.domIndex].q;
      if (o.plan) { filled.push({ label: s.label, value: s.value, tier: s.tier, planned: true }); continue; }
      const err = await fillOne(page, s, photos).catch((e) => e.message);
      if (err) notes.push({ label: s.label, note: err }); else filled.push({ label: s.label, tier: s.tier });
    }
    if (o.plan) { stoppedAt = 'plan only'; break; }
    const before = dom.map((d) => d.label).join('|');
    if (!(await pressNext(page))) { stoppedAt = 'last step before Finish'; break; }
    const after = (await readQuestions(page)).map((d) => d.label).join('|');
    if (after === before) { stoppedAt = 'step needs the owner (required sign-tier answers)'; break; }
  }

  const ownerTaps = Object.entries(job.field_map ?? {}).filter(([, f]) => f.tier === 'sign').map(([l]) => l);
  const worker = {
    filled,
    skipped: ownerTaps,
    human_keys: job.human_keys ?? [],
    unmatched: [...unmatched],
    not_on_form: [...notOnForm],
    notes,
    photos: { uploaded: o.plan ? 0 : photos.files.length, not_readable: photos.gated },
    stopped_at: stoppedAt,
    draft_url: page.url(),
    timestamp: new Date().toISOString(),
    plan_only: o.plan,
  };

  if (row && sb && !o.plan) {
    // Owner's own row under update_own_exports RLS: the sanctioned writer for listing_exports.
    const { error } = await sb.from('listing_exports')
      .update({ metadata: { ...(row.metadata ?? {}), worker } })
      .eq('id', row.id);
    if (error) throw new Error(`listing_exports write-back failed: ${error.message}`);
  } else if (o.job) {
    writeFileSync(o.job.replace(/\.json$/, '') + '.receipt.json', JSON.stringify(worker, null, 2));
  }

  console.log(`BaT submit ${o.plan ? 'plan' : 'run'}: ${filled.length} filled, ${ownerTaps.length} left to the owner, ` +
    `${worker.photos.uploaded} photos (${worker.photos.not_readable} not readable), stopped at: ${stoppedAt}`);
  console.log(`draft: ${worker.draft_url}`);
  if (notes.length) console.log('notes:', JSON.stringify(notes, null, 1));
  if (worker.unmatched.length) console.log('map labels not found on the form:', worker.unmatched.join(' | '));
  if (worker.not_on_form.length) console.log('form questions the map lacks:', worker.not_on_form.join(' | '));
  // No browser.close(): on a CDP connection it can close the owner's Chrome. Exiting detaches.
  process.exit(0);
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });

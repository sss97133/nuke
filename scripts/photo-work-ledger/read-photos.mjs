#!/usr/bin/env node
/**
 * Photo work ledger, stage 1: one vision reading per photo (tools, equipment, parts, materials, goods, work, commerce).
 *
 * Reads photo rows already in Nuke (a JSONL worklist of {id, url, taken_at, ...}), fetches the stored pixels,
 * resizes them to 768 px on the long edge, and asks a small vision model for a structured reading. Output is a local
 * JSONL of readings with token usage; `ingest-readings.mjs` lands them through record_photo_work_reading.
 * Never reads the Mac Photos library. The worklist selection skips rejected_personal and sensitive rows.
 *
 *   dotenvx run -- node scripts/photo-work-ledger/read-photos.mjs --worklist work.jsonl --out readings.jsonl \
 *     [--model claude-haiku-4-5] [--concurrency 6] [--limit N] [--batch] [--batch-id msgbatch_...]
 *
 * --batch submits chunks (--chunk 800) through the Message Batches API (half price, asynchronous), records the batch ids in
 * <out>.batches, polls and collects each one; --batch --collect-only resumes collection without submitting.
 * Already-read ids in --out are skipped, so a run resumes where it stopped.
 */
import Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';
import { readFileSync, appendFileSync, existsSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const PASS_VERSION = 'photo_work_v2';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return dflt;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};

export const SYSTEM = `You catalogue what a mechanic's own photo shows, for a private ledger of the tools, equipment, parts and work in their photo history. Report only what is visible. Never guess a brand or model: give one only when its name or badge is printed or legible in the frame, and copy that text into text_read. Prefer "unknown" and low confidence over a guess.

objects: every tool, machine, shop equipment, loose vehicle part, raw material stock and non-vehicle good of resale value that is visible and identifiable. Skip whole vehicles, people, buildings, consumables and supplies (tape, rags, cleaners, paint cans, fasteners, packaging, boxes, containers), household items (flags, furniture, decor) and parts that are simply installed on the vehicle being photographed. For each:
- kind: equipment (welders, plasma or laser cutting tables, lifts, hoists, gantry cranes, compressors, presses, lathes, benders, sandblast cabinets), tool (hand and power tools, welding pedals, gauges, diagnostic tools), part (a vehicle component off the vehicle: axles, seats, engines, transmissions, panels, wheels), material (unused metal stock: sheet, tubing, replacement floor pans or patch panels), goods (non-automotive items with resale value: cameras, lenses, projectors, audio or electronics, instruments, collectibles).
- key: dotted lowercase type. Use one of these when it fits exactly: welding.tig, welding.tig.foot_pedal, welding.mig, welding.stick, welding.oxyacetylene, welding.helmet, cutting.plasma, cutting.laser_table, equipment.gantry_crane, equipment.lift.engine_hoist, equipment.lift.vehicle, equipment.lift.floor_jack, equipment.lift.scissor, equipment.jack_stand, equipment.work_platform (a raised standing platform or rolling scaffold a person stands on), equipment.workbench, equipment.tool_chest, equipment.air_compressor, equipment.engine_stand, equipment.press, equipment.blast_cabinet, machining.lathe, machining.mill, metal.bender, tool.power.grinder, tool.power.drill, tool.power.impact_wrench, tool.power.polisher, tool.hand, tool.diagnostic, paint.spray_gun, part.axle.front, part.axle.rear, part.axle, part.differential, part.seat, part.engine, part.transmission, part.body_panel, part.wheel, material.sheet_metal, material.floor_pan, material.tubing, goods.camera, goods.camera_lens, goods.projector, goods.electronics. Otherwise invent a specific one in the same style.
- label: short plain name with colour ("yellow cordless drill", "red rolling tool chest").
- brand, model: printed/legible only, else null. text_read: the legible text, else null.
- role: in_use (being operated), present (in the scene), installed (fitted on a vehicle), loose (removed/inventory), for_sale (listing, sale table, price tag), being_moved (on a trailer, truck, forklift, dolly).
- count, confidence 0-1 (how sure the item and its key are right).

work: what labour the photo documents. activity one of welding, fabrication, cutting, paint_prep, painting, bodywork, wiring, mechanical_assembly, teardown, upholstery, machining, inspection, hauling, none. skill_keys use the same dotted keys (welding.tig, paint.refinish, ...). performer_visible: own_hands (hands/arms from the camera's viewpoint), other_person, none.

commerce: evidence of buying or selling. context one of listing_screenshot, receipt, invoice, payment_screenshot, message_screenshot, price_tag, sale_or_auction, estate_sale, loading_or_hauling, none. amount: the money figure printed for the item, as a number, else null. item_text: what the item is per the visible text. counterparty_present: true if a seller/buyer name or handle is visible (do not copy names).

scene: one sentence. place_kind: shop, home_garage, driveway, outdoors, business, sale_site, screen, other.`;

const KEY = { type: 'string' };
export const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['objects', 'work', 'commerce', 'scene', 'place_kind'],
  properties: {
    objects: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['kind', 'key', 'label', 'brand', 'model', 'text_read', 'role', 'count', 'confidence'],
      properties: {
        kind: { type: 'string', enum: ['equipment', 'tool', 'part', 'material', 'goods'] }, key: KEY, label: KEY,
        brand: { type: ['string', 'null'] }, model: { type: ['string', 'null'] }, text_read: { type: ['string', 'null'] },
        role: { type: 'string', enum: ['in_use', 'present', 'installed', 'loose', 'for_sale', 'being_moved'] },
        count: { type: 'integer' }, confidence: { type: 'number' } } } },
    work: { type: 'object', additionalProperties: false, required: ['activity', 'skill_keys', 'in_progress', 'performer_visible'],
      properties: {
        activity: { type: 'string', enum: ['welding', 'fabrication', 'cutting', 'paint_prep', 'painting', 'bodywork', 'wiring',
          'mechanical_assembly', 'teardown', 'upholstery', 'machining', 'inspection', 'hauling', 'none'] },
        skill_keys: { type: 'array', items: KEY }, in_progress: { type: 'boolean' },
        performer_visible: { type: 'string', enum: ['own_hands', 'other_person', 'none'] } } },
    commerce: { type: 'object', additionalProperties: false, required: ['context', 'amount', 'currency', 'item_text', 'counterparty_present'],
      properties: {
        context: { type: 'string', enum: ['listing_screenshot', 'receipt', 'invoice', 'payment_screenshot', 'message_screenshot',
          'price_tag', 'sale_or_auction', 'estate_sale', 'loading_or_hauling', 'none'] },
        amount: { type: ['number', 'null'] }, currency: { type: ['string', 'null'] }, item_text: { type: ['string', 'null'] },
        counterparty_present: { type: 'boolean' } } },
    scene: KEY,
    place_kind: { type: 'string', enum: ['shop', 'home_garage', 'driveway', 'outdoors', 'business', 'sale_site', 'screen', 'other'] },
  },
};

export async function fetchImage(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  let out;
  try {
    out = await sharp(buf, { failOn: 'none' }).rotate()
      .resize({ width: 768, height: 768, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer();
  } catch (e) {
    // HEIC/HEVC and some truncated files: macOS sips decodes what this sharp build cannot.
    if (process.platform !== 'darwin') throw e;
    const dir = mkdtempSync(join(tmpdir(), 'pwl-'));
    try {
      writeFileSync(join(dir, 'in'), buf);
      execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '75', '-Z', '768', join(dir, 'in'), '--out', join(dir, 'out.jpg')], { stdio: 'ignore', timeout: 60000 });
      out = readFileSync(join(dir, 'out.jpg'));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  return { data: out.toString('base64'), bytes_in: buf.length, bytes_out: out.length };
}

export function requestParams(model, image) {
  const sonnet = model.startsWith('claude-sonnet-5');
  return {
    model, max_tokens: 1500,
    // The instructions are identical on every request: cache them (Sonnet caches prefixes of 1,024+ tokens).
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    // Sonnet 5.5 cannot disable thinking; between_tools keeps a one-shot extraction free of thinking tokens.
    ...(sonnet ? { thinking: { type: 'between_tools' } } : {}),
    output_config: { ...(sonnet ? { effort: 'medium' } : {}), format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image.data } },
      { type: 'text', text: 'Catalogue this photo.' } ] }],
  };
}

const PRICES = { 'claude-haiku-4-5': [1, 5], 'claude-sonnet-5-5': [2, 10], 'claude-opus-5-5': [4, 20] };
export const costUsd = (model, u, batch = false) => {
  const [pi, po] = PRICES[model] ?? [NaN, NaN];
  return ((u.input_tokens + (u.cache_creation_input_tokens ?? 0) * 1.25 + (u.cache_read_input_tokens ?? 0) * 0.1) * pi
    + u.output_tokens * po) / 1e6 * (batch ? 0.5 : 1);
};

function parseReading(msg) {
  const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
  return JSON.parse(text);
}

async function main() {
  const worklist = arg('worklist'); const out = arg('out');
  if (!worklist || !out) { console.error('usage: --worklist <jsonl> --out <jsonl>'); process.exit(2); }
  const model = arg('model', 'claude-haiku-4-5');
  const conc = Number(arg('concurrency', 6)); const limit = Number(arg('limit', 1e9));
  const photoKey = process.env.NUKE_PHOTO_ANTHROPIC_API_KEY;
  const workspace = photoKey ? process.env.NUKE_PHOTO_ANTHROPIC_WORKSPACE_ID : undefined;
  const client = new Anthropic({ apiKey: photoKey || process.env.ANTHROPIC_API_KEY, maxRetries: 4,
    ...(workspace ? { defaultHeaders: { 'anthropic-workspace-id': workspace } } : {}) });
  const done = new Set(existsSync(out) ? readFileSync(out, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(l => l.reading).map(l => l.id) : []);
  const items = readFileSync(worklist, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
    .filter(r => !done.has(r.id) && r.url).slice(0, limit);
  console.error(`${items.length} to read (${done.size} already read), model ${model}`);
  let spent = 0, n = 0, failed = 0;

  if (arg('batch')) {
    // Chunked Message Batches: prepare and submit chunks of --chunk requests (each request carries its image, and a batch
    // body is capped near 256 MB), record every batch id in <out>.batches, then collect each ended batch once.
    const chunkSize = Number(arg('chunk', 800));
    const ledger = `${out}.batches`;
    const known = () => (existsSync(ledger) ? readFileSync(ledger, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
    const pending = new Set(known().filter(b => !b.collected).flatMap(b => b.ids));
    const todo = arg('collect-only') ? [] : items.filter(r => !pending.has(r.id));
    for (let c = 0; c < todo.length; c += chunkSize) {
      const slice = todo.slice(c, c + chunkSize); const requests = [];
      for (let i = 0; i < slice.length; i += conc) {
        const part = await Promise.all(slice.slice(i, i + conc).map(async r => {
          try { return { custom_id: r.id, params: requestParams(model, await fetchImage(r.url)) }; }
          catch (e) { appendFileSync(out, JSON.stringify({ id: r.id, error: String(e.message ?? e).slice(0, 300), pass: PASS_VERSION }) + '\n'); return null; }
        }));
        requests.push(...part.filter(Boolean));
      }
      if (!requests.length) continue;
      const batch = await client.messages.batches.create({ requests });
      appendFileSync(ledger, JSON.stringify({ id: batch.id, model, submitted_at: new Date().toISOString(), ids: requests.map(q => q.custom_id),
        taken: Object.fromEntries(slice.map(r => [r.id, r.taken_at])) }) + '\n');
      console.error(`submitted ${batch.id}: ${requests.length} requests (${c + slice.length}/${todo.length} prepared)`);
    }
    for (;;) {
      const open = known().filter(b => !b.collected);
      if (!open.length) break;
      let progressed = false;
      for (const b of open) {
        const st = await client.messages.batches.retrieve(b.id);
        if (st.processing_status !== 'ended') { console.error(`${b.id}: ${JSON.stringify(st.request_counts)}`); continue; }
        for await (const res of await client.messages.batches.results(b.id)) {
          const id = res.custom_id;
          if (res.result.type !== 'succeeded') { failed++; appendFileSync(out, JSON.stringify({ id, error: res.result.type, pass: PASS_VERSION }) + '\n'); continue; }
          const msg = res.result.message; const usd = costUsd(b.model, msg.usage, true); spent += usd; n++;
          let reading = null, perr = null;
          try { reading = parseReading(msg); } catch (e) { perr = String(e.message); }
          appendFileSync(out, JSON.stringify({ id, taken_at: b.taken?.[id], model: b.model, pass: PASS_VERSION, batch: b.id, usage: msg.usage, usd, reading, parse_error: perr }) + '\n');
        }
        writeFileSync(ledger, known().map(x => JSON.stringify(x.id === b.id ? { ...x, collected: new Date().toISOString() } : x)).join('\n') + '\n');
        console.error(`collected ${b.id}: total ${n} read, ${failed} failed, $${spent.toFixed(4)}`);
        progressed = true;
      }
      if (!progressed) await new Promise(r => setTimeout(r, 120000));
    }
  } else {
    let idx = 0;
    const worker = async () => {
      while (idx < items.length) {
        const r = items[idx++];
        try {
          const img = await fetchImage(r.url);
          const msg = await client.messages.create(requestParams(model, img));
          const usd = costUsd(model, msg.usage); spent += usd; n++;
          let reading = null, perr = null;
          try { reading = parseReading(msg); } catch (e) { perr = String(e.message); }
          appendFileSync(out, JSON.stringify({ id: r.id, taken_at: r.taken_at, model, pass: PASS_VERSION, batch: false, usage: msg.usage, usd, reading, parse_error: perr }) + '\n');
        } catch (e) {
          failed++;
          appendFileSync(out, JSON.stringify({ id: r.id, error: String(e.message ?? e).slice(0, 300), pass: PASS_VERSION }) + '\n');
        }
        if ((n + failed) % 50 === 0) console.error(`${n} read, ${failed} failed, $${spent.toFixed(4)}`);
      }
    };
    await Promise.all(Array.from({ length: conc }, worker));
  }
  console.error(`done: ${n} read, ${failed} failed, $${spent.toFixed(4)} (${n ? (spent / n).toFixed(5) : '-'} per photo)`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e); process.exit(1); });

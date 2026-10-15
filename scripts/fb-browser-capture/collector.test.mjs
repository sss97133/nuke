import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID, webcrypto } from 'node:crypto';
import * as core from './extension/core.mjs';
import { validateCommand, validateOrigin, frame, decodeFrame, handleCommand, runCli } from './bridge.mjs';
const require = createRequire(new URL('../../nuke_frontend/package.json', import.meta.url));
const { JSDOM } = require('jsdom');
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const extensionId = 'aidnmhdaljkomnocelhkcgogjonkjafi';
const card = (id = '1001') => ({ facebook_id: id, url: `https://www.facebook.com/marketplace/item/${id}/`, title: '1980 Example coupe', content_text: 'Original displayed card', status: 'active' });
const packet = () => ({ mode: 'browser_capture', capture: { capture_id: randomUUID(), observed_at: new Date().toISOString(), target_url: core.TARGET, actual_url: core.TARGET, actual_region: 'Displayed fixture region', retrieval_surface: 'chrome_mv3_rendered_search_cards', complete: false, access_state: 'available' }, batch: [card()] });
const ack = p => ({ success: true, capture_id: p.capture.capture_id, observed_at: p.capture.observed_at, counts: { raw_landed: p.batch.length, listings_landed: p.batch.length, sightings_landed: p.batch.length, errors: 0 } });
function page() {
  const dom = new JSDOM('<div role="main" aria-label="Collection of Marketplace items"></div>', { url: core.TARGET, runScripts: 'outside-only' });
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 200, height: 100, top: 10, bottom: 110, left: 10, right: 210 });
  dom.window.eval(fs.readFileSync(new URL('./extension/dom.js', import.meta.url), 'utf8'));
  return dom;
}
test('actual rendered role=main card shape retains raw text/label/image and asking amount; unknown prices stay unknown', () => {
  const dom = page(), parse = dom.window.NukeMarketplaceDOM.parseCard;
  const source = { href: '/marketplace/item/1001/?tracking=fixture', text: 'Just listed\n$4,321\n1987 Example coupe\nFixture City, NV', label: '1987 Example coupe, $4,321, Fixture City, NV, listing 1001', images: [{ url: 'https://scontent.example.fbcdn.net/photo.jpg', alt: 'Example coupe' }] };
  const result = parse(source, '2026-10-13T02:00:00Z');
  assert.equal(result.price, 4321); assert.equal(result.title, '1987 Example coupe'); assert.equal(result.location, 'Fixture City, NV'); assert.equal(result.parsed_year, 1987);
  assert.equal(JSON.parse(result.content_text).displayed_text, source.text); assert.equal(result.agent_context.currency, null);
  for (const text of ['Contact seller\nUnknown car\nCity', '$1,000\n$2,000\n1980 Example coupe', 'Free\nExample trailer']) assert.equal(parse({ ...source, text, label: '' }, '2026-10-13T02:00:00Z').price, undefined);
  for (const label of ['Sold','Pending']) { const attributed = parse({ ...source, text: label + '\n' + source.text }, '2026-10-13T02:00:00Z'); assert.equal(attributed.status, label.toLowerCase()); assert.equal(attributed.agent_context.status_basis, 'displayed_seller_label'); assert.equal(attributed.agent_context.source_status_label, label); }
  assert.equal(parse({ ...source, href: 'https://outside.example/marketplace/item/1001/' }, '2026-10-13T02:00:00Z'), null);
  dom.window.close();
});
test('rendered collection excludes outside recommendations, retains out-of-priority and stops reads at source cap', () => {
  const dom = page(), main = dom.window.document.querySelector('[role="main"]');
  for (let n = 1; n <= 3; n++) { const a = dom.window.document.createElement('a'); a.href = `/marketplace/item/${n}/`; a.innerText = `$100\n2026 Example truck\nCity`; a.setAttribute('aria-label', `2026 Example truck, $100, City, listing ${n}`); main.append(a); }
  const outside = dom.window.document.createElement('a'); outside.href = '/marketplace/item/999/'; outside.innerText = 'Private recommendation'; dom.window.document.body.append(outside);
  const result = dom.window.NukeMarketplaceDOM.scan(2);
  assert.equal(result.cards.length, 2); assert.equal(result.cards[0].parsed_year, 2026); assert(!result.cards.some(item => item.facebook_id === '999'));
  dom.reconfigure({ url: 'https://www.facebook.com/marketplace/item/1/' });
  assert.throws(() => dom.window.NukeMarketplaceDOM.scan(), /source_scope/); dom.window.close();
});
test('hostile origins, scopes, arbitrary commands/paths and duplicate/changed packets refused', () => {
  assert.throws(() => validateOrigin('chrome-extension://other/', extensionId));
  validateOrigin(`chrome-extension://${extensionId}/`, extensionId);
  for (const message of [{ command: 'exec', path: '/bin/sh' }, { command: 'ping', path: '/tmp' }, { command: 'capture', packet: packet(), commandPath: '/bin/sh' }]) assert.throws(() => validateCommand(message));
  for (const url of ['https://www.facebook.com/messages/', 'https://www.facebook.com/profile.php', 'https://outside.example/marketplace/category/vehicles/']) { const p = packet(); p.capture.actual_url = url; assert.throws(() => core.validatePacket(p)); }
  const p = packet(); p.batch[0].shell = 'forbidden'; assert.throws(() => core.validatePacket(p));
  const state = core.initialState(), first = packet(); core.enqueue(state, first); core.enqueue(state, first); assert.equal(state.queue.length, 1);
  const changed = structuredClone(first); changed.batch[0].content_text = 'different'; assert.throws(() => core.enqueue(state, changed), /changed_capture_replay/);
});
test('restart retains exact queued bytes/clock; ACK requires all canonical stages and budget blocks source', () => {
  const p = packet(), state = core.initialState(); state.enabled = true; core.enqueue(state, p);
  const restored = JSON.parse(JSON.stringify(state)); assert.equal(restored.queue[0].bytes, JSON.stringify(p));
  assert.equal(core.sourceRefusal(restored), 'landing_pending'); assert.throws(() => core.acknowledge(restored, p.capture.capture_id, { ...ack(p), counts: { ...ack(p).counts, sightings_landed: 0 } }));
  assert.equal(restored.queue.length, 1); core.acknowledge(restored, p.capture.capture_id, ack(p)); assert.equal(restored.queue.length, 0);
  restored.visits = Array(96).fill(Date.now()); assert.equal(core.sourceRefusal(restored), 'daily_source_budget');
  for (let n=0;n<8;n++) core.enqueue(restored, packet()); assert.throws(() => core.enqueue(restored, packet()), /queue_full/);
});
test('native framing bounds input and refuses extra commands', () => {
  const value = { command: 'ping' }; assert.deepEqual(decodeFrame(frame(value)), value); assert.equal(decodeFrame(frame(value).subarray(0,5)), null);
  const huge = Buffer.alloc(4); huge.writeUInt32LE(220001); assert.throws(() => decodeFrame(huge), /message_budget/);
  assert.throws(() => decodeFrame(Buffer.concat([frame(value), frame(value)])), /multiple_commands/);
});
test('failed landing retains original; identical restart/replay reuses immutable packet and verified ACK', async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nuke-collector-')), config = { stateDir }, p = packet(), message = { command: 'capture', packet: p }; let calls = 0;
  try {
    await assert.rejects(handleCommand(message, config, async () => { calls++; throw new Error('offline'); }));
    const file = path.join(stateDir, `${p.capture.capture_id}.json`); assert.equal(fs.readFileSync(file,'utf8'), JSON.stringify(p));
    const execute = async (_config, input) => { calls++; fs.writeFileSync(`${input}.prepared.json.receipts.jsonl`, JSON.stringify({ http_status: 200, receipt: ack(p) })+'\n'); };
    const landed = await handleCommand(message, config, execute); assert.equal(landed.success, true);
    assert.deepEqual(await handleCommand(message, config, () => { throw new Error('ACK replay must not execute'); }), landed); assert.equal(calls, 2);
    const changed = structuredClone(message); changed.packet.batch[0].title = 'changed'; await assert.rejects(handleCommand(changed, config, execute), /changed_capture_replay/);
  } finally { fs.rmSync(stateDir, { recursive: true, force: true }); }
});
test('dead host interruption lock recovers same packet; native ping works in minimal Chrome-like environment', async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nuke-host-')), p = packet(), config = { stateDir, extensionId, node: process.execPath, dotenvx: '/opt/homebrew/bin/dotenvx', cli: path.join(repo,'scripts/fb-import-urls.ts'), envCwd: repo };
  try {
    const file = path.join(stateDir, `${p.capture.capture_id}.json`); fs.writeFileSync(file, JSON.stringify(p)); fs.writeFileSync(`${file}.lock`, JSON.stringify({ pid: 2147483647, at: 0 }));
    const result = await handleCommand({ command: 'capture', packet: p }, config, async (_, input) => fs.writeFileSync(`${input}.prepared.json.receipts.jsonl`, JSON.stringify({ http_status: 200, receipt: ack(p) })+'\n')); assert.equal(result.success, true);
    const cfg = path.join(stateDir,'config.json'); fs.writeFileSync(cfg, JSON.stringify(config));
    const child = spawnSync(process.execPath, ['--import','tsx',path.join(repo,'scripts/fb-browser-capture/bridge.mjs'),cfg,`chrome-extension://${extensionId}/`], { cwd: repo, input: frame({ command: 'ping' }), env: { PATH: '/usr/bin:/bin' }, timeout: 10000 });
    assert.equal(child.status, 0, child.stderr.toString()); assert.equal(decodeFrame(child.stdout).success, true);
  } finally { fs.rmSync(stateDir, { recursive: true, force: true }); }
});


test('fixed argument-array CLI uses explicit Node PATH even under a minimal native environment', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nuke-cli-')), executable = path.join(dir,'fixture-dotenvx');
  const priorPath = process.env.PATH;
  try {
    fs.writeFileSync(executable, '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({args:process.argv.slice(2),path:process.env.PATH}));\n', {mode:0o700});
    process.env.PATH = '/usr/bin:/bin';
    const file = path.join(dir, 'source packet; not shell.json');
    const output = JSON.parse(await runCli({dotenvx:executable,node:process.execPath,cli:'/fixed/canonical-cli.ts',envCwd:dir},file));
    assert.deepEqual(output.args,['run','-q','--',process.execPath,'--import','tsx','/fixed/canonical-cli.ts','--capture',file,'--land']);
    assert(output.path.startsWith('/opt/homebrew/bin:'));
  } finally { process.env.PATH = priorPath; fs.rmSync(dir,{recursive:true,force:true}); }
});

function workerFixture(initial, native = async message => message.command === 'ping' ? {success:true} : ack(message.packet)) {
  let stored = structuredClone(initial), alarmListener, messageListener, startupListener, installedListener;
  const effects = { source:0, reload:0, created:0, cleared:0, native:[] };
  const chrome = {
    storage: {local:{ get:async()=>({collector:structuredClone(stored)}),set:async value=>{stored=structuredClone(value.collector);} }},
    action:{setBadgeText:async()=>{}},
    alarms:{get:async()=>({name:'nuke-marketplace-cycle'}),create:async()=>{},clear:async()=>{effects.cleared++;},onAlarm:{addListener:fn=>{alarmListener=fn;}}},
    tabs:{get:async()=>({id:77,url:core.TARGET,status:'complete'}),create:async()=>{effects.created++;return {id:77,url:core.TARGET,status:'complete'};},reload:async()=>{effects.reload++;}},
    scripting:{executeScript:async()=>{effects.source++;const p=packet();return [{result:{packets:[p],cards:1,cycleId:randomUUID()}}];}},
    runtime:{id:extensionId,sendNativeMessage:async(_host,message)=>{effects.native.push(structuredClone(message));return native(message);},onStartup:{addListener:fn=>{startupListener=fn;}},onInstalled:{addListener:fn=>{installedListener=fn;}},onMessage:{addListener:fn=>{messageListener=fn;}}},
  };
  const context = {chrome,console,crypto:webcrypto,Date,URL,TextEncoder,setTimeout:fn=>{queueMicrotask(fn);return 0;},...core};
  vm.createContext(context);
  const source = fs.readFileSync(new URL('./extension/worker.mjs',import.meta.url),'utf8').replace(/^import[^\n]+\n/,'');
  vm.runInContext(source,context);
  return {effects,context,getState:()=>structuredClone(stored),cycle:()=>vm.runInContext('cycle()',context),startup:()=>startupListener(),installed:()=>installedListener(),command:(command,sender={id:extensionId,url:`chrome-extension://${extensionId}/popup.html`})=>new Promise(resolve=>{const accepted=messageListener({command},sender,resolve);if(!accepted)resolve({refused:true});})};
}
test('scheduled failed ACK retries same bytes before new source; restart retains queue and daily budget', async () => {
  const p=packet(), state=core.initialState();state.enabled=true;state.nextDue=Date.now()+3600000;core.enqueue(state,p);let fail=true;
  const fixture=workerFixture(state,async message=>{if(fail)throw new Error('offline');return ack(message.packet);});
  await fixture.cycle();let retained=fixture.getState();assert.equal(retained.enabled,true);assert.equal(retained.queue[0].bytes,JSON.stringify(p));assert.equal(retained.queue[0].attempts,1);assert(retained.landingRetryAt>Date.now());assert.equal(fixture.effects.source,0);
  fail=false;retained.landingRetryAt=0;const resumed=workerFixture(retained,async message=>ack(message.packet));await resumed.startup();await resumed.cycle();assert.equal(resumed.getState().queue.length,0);assert.equal(resumed.effects.source,0);assert.equal(resumed.getState().lastLanding.captureId,p.capture.capture_id);
  const budget=core.initialState();budget.enabled=true;budget.visits=Array(96).fill(Date.now());const capped=workerFixture(budget);await capped.cycle();assert.equal(capped.effects.source,0);
});
test('Pause during pending native ACK retains queue/ACK and cannot be overwritten or trigger source work', async () => {
  const p=packet(),state=core.initialState();state.enabled=true;core.enqueue(state,p);let release;const pending=new Promise(resolve=>{release=resolve;});
  const fixture=workerFixture(state,async()=>{await pending;return ack(p);});const running=fixture.cycle();
  await new Promise(resolve=>setImmediate(resolve));await fixture.command('pause');release();await running;
  assert.equal(fixture.getState().enabled,false);assert.equal(fixture.getState().queue.length,0);assert.equal(fixture.getState().lastLanding.captureId,p.capture.capture_id);assert.equal(fixture.effects.source,0);
});
test('Pause after due-cycle staging prevents creation and initial source navigation', async () => {
  const state=core.initialState();state.enabled=true;const fixture=workerFixture(state);
  const get=fixture.context.chrome.storage.local.get;let pause=true;
  fixture.context.chrome.storage.local.get=async()=>{
    const value=await get();
    if(pause && value.collector.inFlight){pause=false;await fixture.command('pause');return get();}
    return value;
  };
  await fixture.cycle();
  assert.equal(fixture.getState().enabled,false);assert.equal(fixture.effects.created,0);assert.equal(fixture.effects.reload,0);assert.equal(fixture.effects.source,0);
});
test('fresh owned tab performs one source visit; installation preserves pending state and hostile tab sender cannot start', async () => {
  const state=core.initialState();state.enabled=true;const fixture=workerFixture(state);await fixture.cycle();assert.equal(fixture.effects.created,1);assert.equal(fixture.effects.reload,0);assert.equal(fixture.effects.source,1);assert.equal(fixture.getState().lastCycle.state,'acknowledged');
  const queued=core.initialState();core.enqueue(queued,packet());const restored=workerFixture(queued);await restored.installed();assert.equal(restored.getState().queue.length,1);assert.equal(restored.getState().enabled,false);
  assert.deepEqual(await restored.command('start',{id:extensionId,tab:{id:77},url:core.TARGET}),{refused:true});assert.equal(restored.effects.source,0);
});
test('targeting gate: cars and trucks 1964-1991 pass with tier; boats, trailers, off-era, placeholders rejected with reasons', () => {
  const dom = page(); dom.window.eval(fs.readFileSync(new URL('./extension/classify.js', import.meta.url), 'utf8'));
  const raw = dom.window.NukeClassify.classify, classify = card => JSON.parse(JSON.stringify(raw(card)));
  const c = (title, price, parsed_year) => ({ title, price, parsed_year });
  assert.deepEqual(classify(c('1965 Volkswagen beetle', 6800, 1965)), { accept: true, tier: 1, reasons: [] });
  assert.deepEqual(classify(c('1982 Dodge ram 1500', 4500, 1982)), { accept: true, tier: 2, reasons: [] });
  assert.equal(classify(c('1964 Chevrolet impala SS 2 door', 60000, 1964)).tier, 1);
  assert.equal(classify(c('1991 Ford F250 camper special', 5000, 1991)).accept, true);
  assert.equal(classify(c('1969 Triumph TR6', 9000, 1969)).accept, true);
  assert.equal(classify(c('1989 Chevrolet dolphin', 6000, 1989)).reasons[0], 'boat');
  assert.deepEqual(classify(c('1978 A-Liner na', 500, 1978)).reasons, ['rv_camper_trailer']);
  assert.deepEqual(classify(c('2021 ICON golf cart', 6000, 2021)).reasons, ['year_after_1991', 'offroad_utility']);
  assert.deepEqual(classify(c('2003 Acura rsx', 10, 2003)).reasons, ['year_after_1991', 'price_placeholder']);
  assert.deepEqual(classify(c('1958 Chevrolet Apache', 9000, 1958)).reasons, ['year_before_1964']);
  assert.deepEqual(classify(c('Vintage truck', 9000, null)).reasons, ['year_unknown']);
  assert.equal(classify(c('1975 Honda CB550', 2500, 1975)).reasons[0], 'motorcycle');
  assert.match(fs.readFileSync(new URL('./extension/content.js', import.meta.url), 'utf8'), new RegExp(core.TARGET.replace(/[?.]/g, '\\$&')));
  dom.window.close();
});

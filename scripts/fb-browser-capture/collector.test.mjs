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
const savedPacket = () => { const p = packet(); p.capture.target_url = p.capture.actual_url = core.SAVED_TARGET; p.capture.retrieval_surface = 'chrome_mv3_rendered_saved_cards'; p.batch[0].status = 'unknown'; p.batch[0].agent_context = { source_status_label: null, status_basis: 'saved_card_presence_not_availability' }; return p; };
const ack = p => ({ success: true, capture_id: p.capture.capture_id, observed_at: p.capture.observed_at, counts: { raw_landed: p.batch.length, listings_landed: p.batch.length, sightings_landed: p.batch.length, errors: 0, ...(core.sourceTarget(p.capture.target_url)==='saved'?{private_source:p.batch.length,linked_observations:0}:{}) } });
function page(url = core.TARGET) {
  const dom = new JSDOM(`<div role="main" aria-label="${url === core.SAVED_TARGET ? 'Preview of a saved item' : 'Collection of Marketplace items'}"></div>`, { url, runScripts: 'outside-only' });
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
function savedCardFixture(dom, id, price = '$16,500.00') {
  const main = dom.window.document.querySelector('[role="main"]'), wrapper = dom.window.document.createElement('div');
  wrapper.innerHTML = `<div><a href="/marketplace/item/${id}/"><img src="https://scontent.example.fbcdn.net/${id}.jpg" alt="Vehicle photo"></a></div><div><a data-title href="/marketplace/item/${id}/">1980 Example coupe</a><div>Product • ${price} • Fixture Seller</div><span>Saved from <a data-post href="/marketplace/item/${id}/">Fixture Seller's post</a></span><button>Add to Collection</button><a href="/profile.php?id=secret">Private profile</a></div>`;
  wrapper.innerText = `1980 Example coupe\nProduct • ${price} • Fixture Seller\nSaved from Fixture Seller's post\nAdd to Collection\nPrivate profile`;
  wrapper.querySelector('[data-title]').parentElement.innerText = wrapper.innerText;
  wrapper.querySelector('[data-title]').innerText = '1980 Example coupe';
  wrapper.querySelector('[data-post]').innerText = "Fixture Seller's post";
  wrapper.querySelector('[data-post]').parentElement.innerText = "Saved from Fixture Seller's post";
  main.append(wrapper); return wrapper;
}
test('Saved observed layout keeps same-item title/price/image witnesses and excludes controls, account text and other posts', () => {
  const dom = page(core.SAVED_TARGET), first = savedCardFixture(dom, '901'); savedCardFixture(dom, '902', 'Contact seller');
  const main = dom.window.document.querySelector('[role="main"]'), post = dom.window.document.createElement('a'); post.href = '/posts/private'; post.innerText = 'Private unrelated saved post'; main.append(post);
  const outside = dom.window.document.createElement('a'); outside.href = '/marketplace/item/999/'; outside.innerText = 'Outside recommendation'; dom.window.document.body.append(outside);
  const result = dom.window.NukeMarketplaceDOM.scan(200, new Set(), 'saved');
  assert.deepEqual(Array.from(result.cards, item => item.facebook_id), ['901', '902']);
  const item = result.cards[0]; assert.equal(item.title, '1980 Example coupe'); assert.equal(item.price, 16500); assert.equal(item.status, 'unknown'); assert.equal(item.agent_context.status_basis, 'saved_card_presence_not_availability'); assert.equal(item.agent_context.source_status_label, null);
  assert.equal(item.agent_context.asking_texts[0], '$16,500.00'); assert.equal(item.agent_context.image_witnesses.length, 1);
  assert.equal(JSON.parse(item.content_text).displayed_text, '1980 Example coupe\nProduct • $16,500.00');
  assert(!JSON.stringify(result.cards).match(/Fixture Seller|Add to Collection|Private profile|Private unrelated|Outside recommendation/));
  assert.equal(result.cards[1].price, undefined); assert.equal(result.actual_region, 'Saved collection (geographic scope unknown)');
  assert.equal(dom.window.NukeMarketplaceDOM.scan(1, new Set(['901']), 'saved').cards[0].facebook_id, '902');
  first.querySelector('[data-title]').getBoundingClientRect = () => ({width:0,height:0});
  assert.equal(dom.window.NukeMarketplaceDOM.scan(200, new Set(), 'saved').cards.length, 1);
  dom.window.close();
});
test('Saved attribution link cannot replace an offscreen listing title', () => {
  const dom=page(core.SAVED_TARGET),wrapper=savedCardFixture(dom,'901'),title=wrapper.querySelector('[data-title]'),attribution=wrapper.querySelector('[data-post]');
  title.getBoundingClientRect=()=>({width:200,height:100,top:-200,bottom:-100,left:10,right:210});
  assert.equal(attribution.innerText,"Fixture Seller's post");assert.equal(dom.window.NukeMarketplaceDOM.visible(attribution),true);
  assert.equal(dom.window.NukeMarketplaceDOM.scan(200,new Set(),'saved').cards.length,0);
  dom.window.close();
});
test('Saved unknown layout, nested scopes, challenge and mixed-item ancestor cannot silently broaden capture', () => {
  const dom = page(core.SAVED_TARGET), main = dom.window.document.querySelector('[role="main"]');
  const mixed = savedCardFixture(dom, '901'); mixed.querySelector('[data-title]').parentElement.append(Object.assign(dom.window.document.createElement('a'), {href:'/marketplace/item/902/'}));
  assert.equal(dom.window.NukeMarketplaceDOM.scan(200, new Set(), 'saved').cards.length, 0);
  const challenge = dom.window.document.createElement('div'); challenge.setAttribute('role','alert'); challenge.innerText = 'Confirm your identity'; main.append(challenge);
  assert.throws(() => dom.window.NukeMarketplaceDOM.scan(200, new Set(), 'saved'), /source_access_challenge/); challenge.remove();
  main.setAttribute('aria-label','Other Saved layout'); assert.throws(() => dom.window.NukeMarketplaceDOM.scan(200, new Set(), 'saved'), /saved_collection_unavailable/);
  dom.reconfigure({url:'https://www.facebook.com/saved/collection/123/'}); assert.throws(() => dom.window.NukeMarketplaceDOM.scan(200, new Set(), 'saved'), /source_scope_changed/);
  dom.window.close();
});
test('Saved price precision and availability remain qualified and capture surface cannot be swapped', () => {
  const dom = page(core.SAVED_TARGET), parse = dom.window.NukeMarketplaceDOM.parseSavedCard;
  for (const price of ['$16,500.25', '$1,2', 'Free', '€16,500.00']) {
    const item = parse({href:'/marketplace/item/901/',title:'1980 Example coupe',productLine:`Product • ${price} • Fixture Seller`}, '2026-10-13T02:00:00Z');
    assert.equal(item.price, undefined); assert.equal(item.agent_context.asking_texts[0], price); assert.equal(item.status, 'unknown');
  }
  const p = savedPacket(); core.validatePacket(p);
  for (const change of [q=>{q.capture.actual_url=core.TARGET;},q=>{q.capture.retrieval_surface='chrome_mv3_rendered_search_cards';},q=>{q.batch[0].status='active';},q=>{q.capture.target_url='https://www.facebook.com/saved/123/';}]) { const invalid=structuredClone(p);change(invalid);assert.throws(()=>core.validatePacket(invalid)); }
  dom.window.close();
});
test('Saved content cycle keeps the existing scroll budget and immutable scope; scope or pause changes stop the next read', async () => {
  const source=fs.readFileSync(new URL('./extension/content.js',import.meta.url),'utf8');
  for (const interruption of [null,'scope','pause']) {
    const dom=page(core.SAVED_TARGET);savedCardFixture(dom,'901');let scrolls=0;
    const state={...core.initialState(),enabled:true,savedEnabled:true,controlToken:'fixture-token',inFlight:{target:'saved'}};
    dom.window.chrome={storage:{local:{get:async()=>({collector:state})}}};dom.window.setTimeout=fn=>{queueMicrotask(fn);return 0;};
    dom.window.scrollBy=()=>{scrolls++;if(interruption==='scope')dom.reconfigure({url:core.TARGET});if(interruption==='pause')state.enabled=false;};
    const result=dom.window.eval(source);
    if (interruption) {await assert.rejects(result,interruption==='scope'?/source_scope_changed/:/collector_paused/);assert.equal(scrolls,1);}
    else {const pass=await result;assert.equal(scrolls,4);assert.equal(pass.scans,5);assert.equal(pass.packets.length,1);assert.equal(pass.cards,1);validateCommand({command:'capture',packet:pass.packets[0]});assert.equal(pass.packets[0].capture.target_url,core.SAVED_TARGET);assert.equal(pass.packets[0].capture.enumeration_tail,'unknown');assert.equal(pass.packets[0].capture.complete,false);}
    dom.window.close();
  }
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
test('Saved private-source ACK crosses native bridge and core without requiring a shared observation', async () => {
  const stateDir=fs.mkdtempSync(path.join(os.tmpdir(),'nuke-saved-ack-')),p=savedPacket(),state=core.initialState();core.enqueue(state,p);
  try {
    const receipt={...ack(p),counts:{...ack(p).counts,private_source:1,linked_observations:0,unlinked:0}};
    for (const counts of [{...receipt.counts,private_source:0},{...receipt.counts,linked_observations:1}]) {assert.throws(()=>core.acknowledge(state,p.capture.capture_id,{...receipt,counts}),/private_capture_ack_unavailable/);assert.equal(state.queue.length,1);}
    for (const counts of [{...receipt.counts,private_source:0},{...receipt.counts,linked_observations:1}]) {
      await assert.rejects(handleCommand({command:'capture',packet:p},{stateDir},async(_config,input)=>{fs.writeFileSync(`${input}.prepared.json.receipts.jsonl`,JSON.stringify({http_status:200,receipt:{...receipt,counts}})+'\n');}),/saved_private_ack_unavailable/);
      assert.equal(fs.readFileSync(path.join(stateDir,`${p.capture.capture_id}.json`),'utf8'),JSON.stringify(p));assert.equal(fs.existsSync(path.join(stateDir,`${p.capture.capture_id}.json.ack.json`)),false);
    }
    const landed=await handleCommand({command:'capture',packet:p},{stateDir},async(_config,input)=>{fs.writeFileSync(`${input}.prepared.json.receipts.jsonl`,JSON.stringify({http_status:200,receipt})+'\n');});
    core.acknowledge(state,p.capture.capture_id,landed);assert.equal(state.queue.length,0);assert.equal(state.targetState.saved.lastLanding.counts.private_source,1);assert.equal(state.targetState.saved.lastLanding.counts.linked_observations,0);
    const replay=await handleCommand({command:'capture',packet:p},{stateDir},()=>{throw new Error('must reuse original ACK');});assert.deepEqual(replay,landed);
  } finally {fs.rmSync(stateDir,{recursive:true,force:true});}
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
  let tabUrl = initial.tabTarget === 'saved' ? core.SAVED_TARGET : core.TARGET;
  const effects = { source:0, reload:0, created:0, updated:[], cleared:0, native:[] };
  const chrome = {
    storage: {local:{ get:async()=>({collector:structuredClone(stored)}),set:async value=>{stored=structuredClone(value.collector);} }},
    action:{setBadgeText:async()=>{}},
    alarms:{get:async()=>({name:'nuke-marketplace-cycle'}),create:async()=>{},clear:async()=>{effects.cleared++;},onAlarm:{addListener:fn=>{alarmListener=fn;}}},
    tabs:{get:async()=>({id:77,url:tabUrl,status:'complete'}),create:async({url})=>{effects.created++;tabUrl=url;return {id:77,url,status:'complete'};},update:async(_id,{url})=>{effects.updated.push(url);tabUrl=url;return {id:77,url,status:'complete'};},reload:async()=>{effects.reload++;}},
    scripting:{executeScript:async()=>{effects.source++;const p=core.sourceTarget(tabUrl)==='saved'?savedPacket():packet();return [{result:{packets:[p],cards:1,cycleId:randomUUID()}}];}},
    runtime:{id:extensionId,sendNativeMessage:async(_host,message)=>{effects.native.push(structuredClone(message));return native(message);},onStartup:{addListener:fn=>{startupListener=fn;}},onInstalled:{addListener:fn=>{installedListener=fn;}},onMessage:{addListener:fn=>{messageListener=fn;}}},
  };
  const context = {chrome,console,crypto:webcrypto,Date,URL,TextEncoder,setTimeout:fn=>{queueMicrotask(fn);return 0;},...core};
  vm.createContext(context);
  const source = fs.readFileSync(new URL('./extension/worker.mjs',import.meta.url),'utf8').replace(/^import[^\n]+\n/,'');
  vm.runInContext(source,context);
  return {effects,context,getState:()=>structuredClone(stored),setDue:()=>{stored.nextDue=0;},setTabUrl:url=>{tabUrl=url;},cycle:()=>vm.runInContext('cycle()',context),startup:()=>startupListener(),installed:()=>installedListener(),command:(command,sender={id:extensionId,url:`chrome-extension://${extensionId}/popup.html`})=>new Promise(resolve=>{const accepted=messageListener({command},sender,resolve);if(!accepted)resolve({refused:true});})};
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
test('Saved is off on old installs; explicit opt-in alternates owned targets under one persisted schedule', async () => {
  const legacy=core.initialState(); delete legacy.savedEnabled; delete legacy.targetState; delete legacy.nextTarget; delete legacy.tabTarget; legacy.version=1; legacy.enabled=true;
  const fixture=workerFixture(legacy); await fixture.installed(); await fixture.cycle();
  assert.equal(fixture.getState().savedEnabled,false); assert.equal(fixture.getState().lastCycle.target,'search');
  const configured=await fixture.command('enable_saved'); assert.equal(configured.state.nextTarget,'saved');
  assert.equal(configured.state.targetState.saved.nextDue,configured.state.nextDue); assert.equal(fixture.effects.source,1);
  fixture.setDue();await fixture.cycle();const saved=fixture.getState();
  assert.equal(saved.lastCycle.target,'saved');assert.equal(saved.nextTarget,'search');assert.equal(saved.targetState.saved.lastLanding.target,'saved');assert.equal(saved.targetState.search.nextDue,saved.nextDue);assert.equal(saved.visits.length,2);assert.equal(fixture.effects.created,1);assert.deepEqual(fixture.effects.updated,[core.SAVED_TARGET]);assert.equal(fixture.effects.reload,0);
  const restarted=workerFixture(saved);await restarted.startup();assert.equal(restarted.getState().nextTarget,'search');assert.equal(restarted.getState().targetState.saved.nextDue,saved.targetState.saved.nextDue);assert.equal(restarted.getState().nextDue,saved.nextDue);
  restarted.setDue();await restarted.cycle();assert.equal(restarted.getState().lastCycle.target,'search');assert.equal(restarted.getState().nextTarget,'saved');assert.equal(restarted.getState().visits.length,3);
  await restarted.command('disable_saved');restarted.setDue();await restarted.cycle();assert.equal(restarted.getState().lastCycle.target,'search');assert.equal(restarted.getState().nextTarget,'search');assert.equal(restarted.getState().targetState.saved.nextDue,null);
});
test('Saved replay survives disabling and pause/resume without navigation; shared source budget remains 96', async () => {
  const state=core.initialState(),p=savedPacket();state.enabled=true;state.savedEnabled=true;state.nextTarget='saved';state.nextDue=Date.now()+3600000;core.enqueue(state,p);
  const fixture=workerFixture(state);await fixture.command('disable_saved');await fixture.command('pause');await fixture.startup();await fixture.cycle();assert.equal(fixture.getState().queue[0].bytes,JSON.stringify(p));assert.equal(fixture.effects.source,0);
  await fixture.command('start');await new Promise(resolve=>setImmediate(resolve));assert.equal(fixture.getState().queue.length,0);assert.equal(fixture.getState().targetState.saved.lastLanding.captureId,p.capture.capture_id);assert.equal(fixture.effects.source,0);assert.equal(fixture.effects.created,0);
  const budget=core.initialState();budget.enabled=true;budget.savedEnabled=true;budget.nextTarget='saved';budget.visits=Array(96).fill(Date.now());const capped=workerFixture(budget);await capped.cycle();assert.equal(capped.getState().lastError,'daily_source_budget');assert.equal(capped.effects.source,0);assert.equal(capped.effects.created,0);
});
test('alarm cannot race Saved configuration into source work using a stale target snapshot', async () => {
  const state=core.initialState();state.enabled=true;const fixture=workerFixture(state),get=fixture.context.chrome.storage.local.get;let reads=0;
  fixture.context.chrome.storage.local.get=async()=>{const value=await get();reads++;if(reads===2)await fixture.cycle();return value;};
  const configured=await fixture.command('enable_saved');assert.equal(configured.state.savedEnabled,true);assert.equal(configured.state.nextTarget,'saved');assert.equal(fixture.effects.source,0);assert.equal(fixture.effects.created,0);
  await fixture.cycle();assert.equal(fixture.getState().lastCycle.target,'saved');assert.equal(fixture.getState().savedEnabled,true);
});
test('owned tab navigation to another allowed target still pauses, and source scope is checked after load', async () => {
  const state=core.initialState();state.enabled=true;state.savedEnabled=true;state.tabId=77;state.tabTarget='search';state.nextTarget='saved';
  const moved=workerFixture(state);moved.setTabUrl(core.SAVED_TARGET);await moved.cycle();assert.equal(moved.getState().enabled,false);assert.equal(moved.getState().lastError,'owned_tab_left_marketplace');assert.equal(moved.effects.source,0);assert.equal(moved.effects.updated.length,0);
  const redirected=workerFixture(state);const update=redirected.context.chrome.tabs.update;redirected.context.chrome.tabs.update=async(...args)=>{await update(...args);redirected.setTabUrl('https://www.facebook.com/login/');return {id:77};};
  await redirected.cycle();assert.equal(redirected.getState().enabled,false);assert.equal(redirected.getState().lastError,'owned_tab_left_marketplace');assert.equal(redirected.effects.source,0);assert.equal(redirected.effects.created,0);
});
test('explicit Resume relinquishes a diverted tab without touching it or bypassing cadence, queue or daily budget', async () => {
  for (const lastError of ['owned_tab_left_marketplace','source_scope_changed']) {
    const state=core.initialState(),p=packet();state.tabId=77;state.tabTarget='search';state.lastError=lastError;state.nextDue=Date.now()+3600000;state.visits=[Date.now()];core.enqueue(state,p);
    const fixture=workerFixture(state),oldUrl='https://www.facebook.com/marketplace/you/selling/',tabs=new Map([[77,{id:77,url:oldUrl,status:'complete'}]]),mutations=[];
    fixture.context.chrome.tabs.get=async id=>tabs.get(id);
    fixture.context.chrome.tabs.create=async ({url})=>{fixture.effects.created++;const tab={id:88,url,status:'complete'};tabs.set(88,tab);return tab;};
    fixture.context.chrome.tabs.update=async id=>{mutations.push(['update',id]);};fixture.context.chrome.tabs.reload=async id=>{mutations.push(['reload',id]);};fixture.context.chrome.tabs.remove=async id=>{mutations.push(['remove',id]);};
    await fixture.cycle();assert.equal(fixture.getState().tabId,77);assert.equal(fixture.effects.created,0);assert.equal(fixture.getState().queue[0].bytes,JSON.stringify(p));
    const resumed=await fixture.command('start');await new Promise(resolve=>setImmediate(resolve));
    assert.equal(resumed.state.tabId,null);assert.equal(resumed.state.tabTarget,null);assert.equal(resumed.state.queue[0].bytes,JSON.stringify(p));assert.equal(fixture.getState().queue.length,0);assert.equal(fixture.getState().lastLanding.captureId,p.capture.capture_id);assert.equal(fixture.getState().nextDue,state.nextDue);assert.deepEqual(fixture.getState().visits,state.visits);assert.equal(fixture.effects.created,0);assert.equal(fixture.effects.source,0);
    fixture.setDue();await fixture.cycle();assert.equal(fixture.getState().tabId,88);assert.equal(fixture.effects.created,1);assert.equal(fixture.effects.source,1);assert.equal(tabs.get(77).url,oldUrl);assert.deepEqual(mutations,[]);
    const cappedState={...state,queue:[],nextDue:0,visits:Array(96).fill(Date.now())},capped=workerFixture(cappedState);await capped.command('start');await new Promise(resolve=>setImmediate(resolve));assert.equal(capped.getState().lastError,'daily_source_budget');assert.equal(capped.effects.created,0);assert.equal(capped.effects.source,0);assert.equal(capped.getState().visits.length,96);
  }
});

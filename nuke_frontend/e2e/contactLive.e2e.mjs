// Live contact threads in a real browser: the dev server with Supabase mocked at the network, Realtime included
// (mockSupabase.mjs answers the websocket like the server's realtime.messages policy: a private join to your own
// contact_inbox topic only). A broadcast carries {request_id, kind}; the page must refetch through the reader, show
// the change within a few seconds, announce it in a polite live region, pause while the tab is hidden and catch up
// when it returns. Run: NODE_PATH=/tmp/pw/node_modules node --test e2e/contactLive.e2e.mjs
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startDevServer } from './devServer.mjs';
import { mockSupabase, persona, realtimeFor } from './mockSupabase.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const AXE = require.resolve('axe-core/axe.min.js');

const ME = persona('00000000-0000-4000-b000-00000000c101', 'e2elive');
const THREAD = '00000000-0000-4000-c000-0000000000a1';
const AS_OF = '2026-10-19T19:00:00Z';
const LIVE_MS = 5_000;

let server, browser;
before(async () => {
  server = await startDevServer(Number(process.env.E2E_LIVE_PORT ?? 4319));
  browser = await chromium.launch();
  const ctx = await browser.newContext();
  await mockSupabase(ctx, {});
  const page = await ctx.newPage();
  await page.goto(`${server.base}/messages`, { timeout: 120_000 });
  await page.waitForLoadState('networkidle', { timeout: 120_000 }).catch(() => {});
  await ctx.close();
}, { timeout: 240_000 });
after(async () => { await browser?.close(); server?.stop(); });

const viewer = { context: 'self', slots: [] };
const message = (id, mine, body) => ({ message_id: id, author: mine ? { kind: 'you' } : { kind: 'user', handle: 'e2eshop' }, body, created_at: AS_OF });
const thread = (messages) => ({ viewer, as_of: AS_OF, can_post: true, messages,
  request: { request_id: THREAD, direction: 'outgoing', status: 'accepted', counterpart: { kind: 'user', handle: 'e2eshop' }, recipient_kind: 'user', message: 'Hello' } });
const item = (id, direction, status, handle, messages = 0) => ({ request_id: id, direction, status, created_at: AS_OF, message: 'Synthetic request text',
  counterpart: { kind: 'user', handle }, recipient_kind: 'user', context: { kind: 'profile', id: null, label: null }, thread: { messages, last_message_at: null },
  actions: status === 'pending' ? (direction === 'incoming' ? ['respond_contact_request'] : ['withdraw_contact_request']) : ['post_contact_message'] });
const inbox = (incoming, outgoing) => ({ viewer, as_of: AS_OF, incoming, outgoing, limits: { requests_per_day: 10, requests_sent_last_day: 0, messages_per_thread_per_day: 200 } });

async function open(path, state, who = ME) {
  const ctx = await browser.newContext();
  const reads = { contact_thread_read: 0, my_contact_requests: 0 };
  await mockSupabase(ctx, { who, readers: {
    contact_thread_read: () => { reads.contact_thread_read++; return state.thread; },
    my_contact_requests: () => { reads.my_contact_requests++; return state.inbox; },
  } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30_000);
  await page.goto(`${server.base}${path}`);
  return { ctx, page, reads, realtime: realtimeFor(ctx) };
}

const until = async (check, ms = LIVE_MS, label = 'condition') => {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await check()) return Date.now() - start;
    await new Promise(r => setTimeout(r, 50));
  }
  assert.fail(`${label} not met within ${ms} ms`);
};
const announced = (page) => page.locator('[role="status"].jb-sr').textContent();
const setHidden = (page, hidden) => page.evaluate((h) => {
  Object.defineProperty(document, 'visibilityState', { value: h ? 'hidden' : 'visible', configurable: true });
  Object.defineProperty(document, 'hidden', { value: h, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}, hidden);

describe('live contact threads', () => {
  it('a thread joins only its own private inbox topic, then shows and announces a reply within seconds', async () => {
    const state = { thread: thread([message('m1', true, 'Are you free Friday?')]) };
    const { ctx, page, reads, realtime } = await open(`/messages/${THREAD}`, state);
    await page.getByText('Are you free Friday?').waitFor();
    await until(() => realtime.joins.some(j => j.ok), LIVE_MS, 'private join');
    // (The dev server's StrictMode mounts twice, so the page may join, leave and join again.)
    const contact = realtime.joins.filter(j => j.topic.startsWith('realtime:contact_inbox:'));
    assert.ok(contact.length >= 1);
    assert.deepEqual([...new Set(contact.map(j => JSON.stringify({ topic: j.topic, private: j.private, ok: j.ok })))],
      [JSON.stringify({ topic: `realtime:contact_inbox:${ME.id}`, private: true, ok: true })], 'private joins to the viewer\'s own topic only');
    assert.equal(await announced(page), '');

    state.thread = thread([message('m1', true, 'Are you free Friday?'), message('m2', false, 'Friday works for the flanges')]);
    const before = reads.contact_thread_read;
    assert.equal(realtime.broadcast(`contact_inbox:${ME.id}`, 'contact', { request_id: THREAD, kind: 'message', id: 'x' }), 1);
    const ms = await until(async () => (await page.getByText('Friday works for the flanges').count()) > 0, LIVE_MS, 'reply shown');
    assert.ok(ms < LIVE_MS, `shown in ${ms} ms`);
    assert.equal(reads.contact_thread_read, before + 1, 'one refetch through contact_thread_read');
    assert.equal(await announced(page), 'New message from @e2eshop.');
    await page.addScriptTag({ path: AXE });
    const blocking = await page.evaluate(async () => (await axe.run({ include: [['main']] }, { resultTypes: ['violations'] })).violations
      .filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id));
    assert.deepEqual(blocking, [], 'axe: no serious or critical violations after a live update');

    realtime.broadcast(`contact_inbox:${ME.id}`, 'contact', { request_id: '00000000-0000-4000-c000-0000000000ff', kind: 'message' });
    await page.waitForTimeout(600);
    assert.equal(reads.contact_thread_read, before + 1, 'a signal for another thread does not refetch this one');
    await ctx.close();
  });

  it('/messages shows a new request and an answer live, announced without the request text', async () => {
    const state = { inbox: inbox([], [item('r-out', 'outgoing', 'pending', 'e2eshop')]) };
    const { ctx, page, realtime } = await open('/messages', state);
    await page.getByText('To @e2eshop').waitFor();
    await until(() => realtime.joins.some(j => j.ok), LIVE_MS, 'private join');
    state.inbox = inbox([item('r-in', 'incoming', 'pending', 'e2ebuyer')], [item('r-out', 'outgoing', 'accepted', 'e2eshop')]);
    realtime.broadcast(`contact_inbox:${ME.id}`, 'contact', { request_id: 'r-in', kind: 'request' });
    await until(async () => (await page.getByText('From @e2ebuyer').count()) > 0, LIVE_MS, 'new request shown');
    const said = await announced(page);
    assert.equal(said, 'New contact request from @e2ebuyer. @e2eshop accepted your request.');
    assert.ok(!said.includes('Synthetic request text'));
    await ctx.close();
  });

  it('pauses while the tab is hidden and catches up when it returns', async () => {
    const state = { thread: thread([message('m1', true, 'Hello there')]) };
    const { ctx, page, reads, realtime } = await open(`/messages/${THREAD}`, state);
    await page.getByText('Hello there').waitFor();
    await until(() => realtime.joins.some(j => j.ok), LIVE_MS, 'private join');
    const joinedBefore = realtime.joins.filter(j => j.ok).length;
    await setHidden(page, true);
    await until(() => realtime.broadcast(`contact_inbox:${ME.id}`, 'contact', { request_id: THREAD, kind: 'message' }) === 0, LIVE_MS, 'channel left while hidden');
    const hiddenReads = reads.contact_thread_read;
    state.thread = thread([message('m1', true, 'Hello there'), message('m2', false, 'Sent while you were away')]);
    await page.waitForTimeout(600);
    assert.equal(reads.contact_thread_read, hiddenReads, 'no refetch while hidden');
    await setHidden(page, false);
    await until(async () => (await page.getByText('Sent while you were away').count()) > 0, LIVE_MS, 'caught up on return');
    await until(() => realtime.joins.filter(j => j.ok).length === joinedBefore + 1, LIVE_MS, 'rejoined');
    await ctx.close();
  });

  it('a signed-out visitor opens no Realtime channel', async () => {
    const { ctx, page, realtime } = await open('/messages', { inbox: inbox([], []) }, null);
    await page.waitForTimeout(1500);
    assert.deepEqual(realtime.joins, []);
    await ctx.close();
  });

  it('a refused join falls back to a slow poll instead of failing', async () => {
    const other = persona('00000000-0000-4000-b000-00000000c102', 'e2eother');
    const state = { thread: thread([message('m1', true, 'Hello there')]) };
    const ctx = await browser.newContext();
    let readsCount = 0;
    await mockSupabase(ctx, { who: other, readers: { contact_thread_read: () => { readsCount++; return state.thread; } } });
    await ctx.addInitScript(() => {
      const real = window.setInterval;
      window.setInterval = (fn, ms, ...rest) => real(fn, ms === 15000 ? 300 : ms, ...rest);
    });
    // The mock admits `other` only to its own topic; sign the page in as ME so the join names a topic it may not read.
    await ctx.addInitScript(([key, value]) => { window.localStorage.setItem(key, value); }, ['sb-e2e-mock-auth-token', JSON.stringify(ME.session)]);
    const page = await ctx.newPage();
    await page.goto(`${server.base}/messages/${THREAD}`);
    await page.getByText('Hello there').waitFor();
    const realtime = realtimeFor(ctx);
    const contact = () => realtime.joins.filter(j => j.topic.startsWith('realtime:contact_inbox:'));
    await until(() => contact().length > 0, LIVE_MS, 'join attempted');
    assert.ok(contact().every(j => !j.ok), 'join refused');
    const first = readsCount;
    await until(() => readsCount > first, LIVE_MS, 'fallback poll refetches');
    await ctx.close();
  });
});

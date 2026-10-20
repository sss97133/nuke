// Header activity indicator, end to end against the dev server with Supabase mocked at the network: nothing for a
// visitor; for a signed-in person, a count of what waits (Signs to make, contact requests, unread notifications) and a
// panel linking to the job and the conversation. Run: NODE_PATH=/tmp/pw/node_modules node --test e2e/activity.e2e.mjs
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startDevServer } from './devServer.mjs';
import { mockSupabase, persona } from './mockSupabase.mjs';
import { WO } from './fixtures.mjs';
import { activityNotes, activityReaders } from './activityFixtures.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const CUSTOMER = persona('00000000-0000-4000-b000-00000000c001', 'e2ebuyer');
let server, browser;

before(async () => {
  server = await startDevServer(Number(process.env.E2E_ACTIVITY_PORT ?? 4319));
  browser = await chromium.launch();
  const ctx = await browser.newContext();
  await mockSupabase(ctx, {});
  const page = await ctx.newPage();
  await page.goto(`${server.base}/jobs`, { timeout: 120_000 });
  await page.waitForLoadState('networkidle', { timeout: 120_000 }).catch(() => {});
  await ctx.close();
}, { timeout: 240_000 });
after(async () => { await browser?.close(); server?.stop(); });

async function open(path, opts) {
  const ctx = await browser.newContext();
  const reads = [];
  ctx.on('request', r => { const m = /\/rest\/v1\/(rpc\/)?([a-z_]+)/.exec(r.url()); if (m) reads.push(m[2]); });
  const writes = await mockSupabase(ctx, opts);
  const page = await ctx.newPage();
  page.setDefaultTimeout(30_000);
  await page.goto(`${server.base}${path}`);
  return { ctx, page, writes, reads };
}

describe('header activity', () => {
  it('shows nothing and reads nothing for a visitor', async () => {
    const { ctx, page, reads } = await open('/jobs', { readers: { open_requirements_read: { rows: [], coverage: { returned: 0, total_open: 0 }, as_of: '2026-10-19T19:00:00Z' } } });
    await page.waitForTimeout(3000);
    assert.equal(await page.getByRole('button', { name: /^Activity / }).count(), 0);
    for (const r of ['my_signature_queue', 'my_contact_requests', 'get_unread_notification_count', 'user_notifications']) assert.ok(!reads.includes(r), `${r} read for a visitor`);
    await ctx.close();
  });

  it('counts what waits for a signed-in person and links each item; opening a notification marks it read', async () => {
    const { ctx, page, writes } = await open('/work', { who: CUSTOMER, readers: activityReaders(), tables: { user_notifications: activityNotes } });
    const button = page.getByRole('button', { name: 'Activity 4 items waiting' });
    await button.waitFor();
    assert.equal(await button.getAttribute('aria-expanded'), 'false');
    await button.click();
    const panel = page.getByRole('region', { name: 'Activity' });
    await panel.waitFor();
    assert.equal(await button.getAttribute('aria-expanded'), 'true');
    assert.ok(await panel.getByRole('link', { name: /Offer to accept/ }).count() === 1);
    assert.equal(await panel.getByRole('link', { name: /Offer to accept/ }).getAttribute('href'), `/jobs/${WO}`);
    assert.equal(await panel.getByRole('link', { name: /Contact request from @e2etech/ }).getAttribute('href'), '/messages/req-c1');
    assert.equal(await panel.getByText('Can I see the car Thursday?').count(), 0, 'the request message stays in the thread');
    assert.equal(await panel.getByText(/Work day to confirm/).count(), 0, 'photo work days stay on /work');
    await page.keyboard.press('Escape');
    assert.equal(await panel.count(), 0);
    await button.click();
    await page.getByRole('region', { name: 'Activity' }).getByRole('link', { name: /Your quote was accepted/ }).click();
    for (let i = 0; i < 50 && !writes.some(w => w.rpc === 'mark_notification_read'); i++) await page.waitForTimeout(100);
    assert.deepEqual(writes.filter(w => w.rpc === 'mark_notification_read').map(w => w.args), [{ p_user_id: CUSTOMER.id, p_notification_id: 'n-1' }]);
    await page.waitForURL(`**/jobs/${WO}`);
    await ctx.close();
  });
});

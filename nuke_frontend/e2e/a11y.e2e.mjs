// Accessibility of every job-loop page, in the states people reach (see a11yStates.mjs): axe-core in a real browser against
// the dev server with Supabase mocked at the network. Serious and critical violations must be zero. The site header is
// outside these pages (scope: the app's main region and any open dialog); legacy pages are scoped to tonight's sections.
// Run: NODE_PATH=/tmp/pw/node_modules node --test e2e/a11y.e2e.mjs   (A11Y_SURVEY=1 prints counts instead of failing)
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startDevServer } from './devServer.mjs';
import { mockSupabase } from './mockSupabase.mjs';
import { STATES } from './a11yStates.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const AXE = require.resolve('axe-core/axe.min.js');
const SURVEY = process.env.A11Y_SURVEY === '1';
const BLOCKING = new Set(['serious', 'critical']);

let server, browser;
const results = [];

before(async () => {
  server = await startDevServer(Number(process.env.E2E_A11Y_PORT ?? 4318));
  browser = await chromium.launch();
  const ctx = await browser.newContext();
  await mockSupabase(ctx, {});
  const page = await ctx.newPage();
  await page.goto(`${server.base}/work/market`, { timeout: 120_000 });
  await page.waitForLoadState('networkidle', { timeout: 120_000 }).catch(() => {});
  await ctx.close();
}, { timeout: 240_000 });

after(async () => {
  if (SURVEY) console.log(`A11Y_RESULTS ${JSON.stringify(results)}`);
  await browser?.close(); server?.stop();
});

async function audit(state) {
  const ctx = await browser.newContext();
  await mockSupabase(ctx, { who: state.who ?? null, readers: state.readers ?? {}, tables: state.tables ?? {} });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30_000);
  await page.goto(`${server.base}${state.path}`);
  await page.getByText(state.ready, { exact: false }).first().waitFor();
  if (state.act) await state.act(page);
  await page.waitForTimeout(150);
  await page.addScriptTag({ path: AXE });
  const scope = state.scope ? state.scope.split(',').map(s => s.trim()) : ['main', '[role="dialog"]'];
  const violations = await page.evaluate(async (include) => {
    const present = include.filter(sel => document.querySelector(sel));
    // eslint-disable-next-line no-undef
    const r = await axe.run({ include: present.map(s => [s]) }, { resultTypes: ['violations'] });
    return r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, targets: v.nodes.slice(0, 3).map(n => n.target.join(' ')) }));
  }, scope);
  await ctx.close();
  return violations;
}

describe('accessibility (axe-core, serious + critical = 0)', () => {
  for (const state of STATES) {
    it(state.name, async () => {
      const violations = await audit(state);
      const blocking = violations.filter(v => BLOCKING.has(v.impact));
      results.push({ state: state.name, blocking: blocking.reduce((n, v) => n + v.nodes, 0), all: violations.reduce((n, v) => n + v.nodes, 0), violations });
      if (!SURVEY) assert.deepEqual(blocking, [], `${state.name}: ${JSON.stringify(blocking, null, 1)}`);
    });
  }
});

describe('Sign sheets by keyboard', () => {
  // The opener's label is the state's ready text for these sheets.
  for (const name of ['sheet: record payment', 'sheet: issue quote', 'sheet: co-sign']) {
    it(`${name}: Enter opens, focus moves in, Tab and Shift+Tab stay in, Escape closes and returns focus`, async () => {
      const state = STATES.find(s => s.name === name);
      assert.ok(state, name);
      const ctx = await browser.newContext();
      await mockSupabase(ctx, { who: state.who ?? null, readers: state.readers ?? {}, tables: state.tables ?? {} });
      const page = await ctx.newPage();
      page.setDefaultTimeout(30_000);
      await page.goto(`${server.base}${state.path}`);
      const opener = page.getByRole('button', { name: state.ready, exact: true }).first();
      await opener.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      const inside = () => page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')));
      assert.ok(await inside(), 'focus moves into the sheet');
      const stops = await dialog.locator('a[href], button:not([disabled]), input, select, textarea').count();
      for (let i = 0; i < stops + 2; i++) { await page.keyboard.press('Tab'); assert.ok(await inside(), `Tab ${i + 1} stays in the sheet`); }
      for (let i = 0; i < 3; i++) { await page.keyboard.press('Shift+Tab'); assert.ok(await inside(), `Shift+Tab ${i + 1} stays in the sheet`); }
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
      assert.ok(await opener.evaluate(el => el === document.activeElement), 'focus returns to the button that opened the sheet');
      await ctx.close();
    });
  }
});

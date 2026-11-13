// Screenshot the specimen in light and dark and fail if a period font did not load.
//   cd nuke_frontend && node ../tools/type/shoot.mjs /path/specimen.html OUT_DIR
import { createRequire } from 'module';
const pw = createRequire(process.cwd() + '/')('playwright');
const engine = process.argv[4] || 'chromium';
const chromium = pw[engine];
const [, , page_, out] = process.argv;
const fams = ['Pontiac 1973 Block', 'Pontiac 1973 Block Face', 'Firebird 1971 Script', 'Trans Am 1973 Decal',
  'Pontiac 1973 Brochure Numerals'];
const browser = await chromium.launch();
for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.goto('file://' + page_);
  await p.evaluate(() => document.fonts.ready);
  const loaded = await p.evaluate(async (fams) => {
    const r = {};
    for (const f of fams) { await document.fonts.load(`40px "${f}"`, 'A'); r[f] = document.fonts.check(`40px "${f}"`, 'A'); }
    r.statuses = [...document.fonts].map((x) => `${x.family}:${x.status}`);
    return r;
  }, fams);
  const bad = fams.filter((f) => !loaded[f]) .concat(loaded.statuses.filter((s) => !s.endsWith(':loaded')));
  if (bad.length) { console.error('FONT NOT LOADED', scheme, bad); process.exit(1); }
  await p.screenshot({ path: `${out}/specimen-${engine}-${scheme}.png`, fullPage: true });
  await p.screenshot({ path: `${out}/specimen-${engine}-${scheme}-header.png`, clip: { x: 0, y: 0, width: 1280, height: 520 } });
  console.log(scheme, loaded.statuses.join(' '));
  await ctx.close();
}
await browser.close();

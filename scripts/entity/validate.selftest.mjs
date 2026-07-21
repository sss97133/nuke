#!/usr/bin/env node
// scripts/entity/validate.selftest.mjs
//
// Every case below is a REAL defect this platform actually shipped, replayed
// against the gate. Nothing here is invented and nothing is written.
//
// Where a defect has since been remediated, the test uses the value PRESERVED
// by the remediation (`metadata.price_quarantine.base_price_as_found`,
// `metadata.mark_quarantine.logo_url_as_found`) — which is precisely why those
// scripts preserve it. Where the defect is still live, the test reads it live
// and says so.
//
//   cd /Users/skylar/nuke && dotenvx run --quiet -- node scripts/entity/validate.mjs selftest

import {
  db, validate, entityGate, geoScope, imageSanity, sharedValue,
  cohortDisplacement, unitCurrencyRequired, toNightly, fitRegion, STBARTH_REGION_TEXT,
} from './validate.mjs';

const C = { r: '\x1b[31m', y: '\x1b[33m', g: '\x1b[32m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
let passed = 0, failed = 0;

function assert(label, ok, detail) {
  if (ok) { passed++; console.log(`${C.g}CAUGHT${C.x}  ${label}\n        ${C.d}${detail}${C.x}`); }
  else { failed++; console.log(`${C.r}MISSED${C.x}  ${label}\n        ${C.d}${detail}${C.x}`); }
}

async function all(t, cols) {
  let o = [], f = 0;
  for (;;) { const { data, error } = await db().from(t).select(cols).order('id').range(f, f + 999); if (error) throw error; o = o.concat(data); if (data.length < 1000) break; f += 1000; }
  return o;
}

export async function run() {
  console.log(`${C.b}validate.mjs selftest — 9 real shipped defects${C.x}\n`);
  const props = await all('properties', 'id,name,base_price,price_currency,price_period,source_url,metadata');

  // ── 1. ELAN: 294-804 USD/week vs merchant-published 22,000-125,000 ────────
  const elan = props.filter((r) => r.metadata?.price_quarantine)
    .map((r) => ({ ...r.metadata.price_quarantine, name: r.name }));
  const perValue = [];
  for (const e of elan) {
    const v = await validate({
      subject_type: 'property', field: 'base_price', value: e.base_price_as_found,
      context: { currency: e.price_currency_as_found, period: e.price_period_as_found, subject: { name: e.name } },
    });
    perValue.push({ name: e.name, verdict: v.verdict, nightly: toNightly(e.base_price_as_found, e.price_period_as_found).value });
  }
  const caught = perValue.filter((p) => p.verdict !== 'pass');
  assert('[1a] Elan — per-value band', caught.length >= 5,
    `band catches ${caught.length}/${elan.length}: ${caught.map((c) => `${c.name}@${c.nightly.toFixed(0)}/nt`).join(', ')}. ` +
    `The remaining ${elan.length - caught.length} are individually plausible rates — the band CANNOT catch them and I do not claim it does.`);

  const live = props.filter((r) => r.base_price != null && r.price_currency === 'USD' && r.price_period);
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'unknown'; } };
  const cohortRows = [
    ...live.map((r) => ({ __name: r.name, source_host: hostOf(r.source_url), __nightly: toNightly(r.base_price, r.price_period).value })),
    // Elan replayed as it was BEFORE remediation — the state the gate would have seen.
    ...elan.map((e) => ({ __name: e.name, source_host: 'elanvillarental.com', __nightly: toNightly(e.base_price_as_found, e.price_period_as_found).value })),
  ];
  const coh = cohortDisplacement(cohortRows);
  const elanCoh = coh.find((c) => c.evidence.cohort === 'elanvillarental.com');
  assert('[1b] Elan — cohort displacement (the check that actually works)', !!elanCoh && elanCoh.evidence.direction === 'low',
    elanCoh ? `${elanCoh.reason}` : 'no cohort finding');
  const others = coh.filter((c) => c.evidence.cohort !== 'elanvillarental.com');
  console.log(`        ${C.d}other displaced cohorts surfaced: ${others.map((o) => `${o.evidence.cohort} ${o.evidence.decades > 0 ? '+' : ''}${o.evidence.decades}`).join(', ') || 'none'}${C.x}`);

  // ── 2. a garment at 0.12 EUR that the merchant sells at 12.00 ─────────────
  const g = await validate({ subject_type: 'product', field: 'price', value: 0.12, context: { currency: 'EUR', period: 'each' } });
  const gc = g.checks.find((c) => c.check === 'numeric_plausibility');
  assert('[2] garment 0.12 EUR (merchant sells 12.00 — 100x parse failure)', g.verdict === 'block',
    `verdict=${g.verdict}; ${gc?.reason}`);

  // ── 3. WIMCO nightly rendered as the weekly headline ─────────────────────
  // MEASURED: the STORED values are fine (USD/night median 1714 is coherent
  // with USD/week median 10045 → 1435/night). Nothing was mis-parsed. The
  // failure was a reader supplying its own unit. So the catchable defect is
  // the column mixing units at all, plus any value carrying no unit.
  const noUnit = unitCurrencyRequired({ field: 'base_price', value: 12000, context: { currency: 'USD', period: null } });
  assert('[3] WIMCO nightly-as-weekly (unit confusion)', noUnit.severity === 'block',
    `${noUnit.reason} — note: WIMCO's stored rows are CORRECT; the defect was at the render layer, so the gate's contribution is making the unit non-optional at the value.`);

  // ── 4. BODY+SOUL ST BARTH given an Indonesian gambling site's logo ────────
  const bs = entityGate({
    subject_type: 'organization', subject: { name: 'BODY+SOUL ST BARTH' },
    evidence: { url: 'https://bodysoulstbarth.com/', text: 'SLOT GACOR situs judi online terpercaya deposit pulsa' },
  });
  assert('[4] BODY+SOUL — lapsed domain seized by a gambling site', bs.severity !== 'pass',
    `${bs.reason}\n        NOTE: every host-level signal PASSES here (host_is_name + ISLAND_IN_HOST → island_domain → own_site) and always will — a domain outlives its owner. This is a measured gap in _org_entity_gate.mjs that only content corroboration closes.`);

  // ── 5. MEDIFLIGHT (St Barth) matched to "Mediflight Of Oklahoma" ──────────
  const region = await fitRegion('property');
  const mf = geoScope({
    subject: { name: 'MEDIFLIGHT' },
    evidence: { lat: 35.4676, lng: -97.5164, text: 'Mediflight Of Oklahoma, Oklahoma City, OK' },
    region: { ...region, ...STBARTH_REGION_TEXT },
  });
  assert('[5] MEDIFLIGHT → Mediflight Of Oklahoma', mf.severity === 'block',
    `${mf.reason}  [region bbox fitted from ${region.n} live property coordinates, not hardcoded]`);

  // ── 6. a St Barth restaurant → Saint-Barthelemy-de-Bellegarde, Dordogne ───
  const dd = geoScope({
    subject: { name: 'BARTHOME' },
    evidence: { text: 'Le Barthôme, Saint-Barthélemy-de-Bellegarde, Dordogne, Nouvelle-Aquitaine, France' },
    region: { ...region, ...STBARTH_REGION_TEXT },
  });
  assert('[6] St Barth restaurant → Dordogne commune namesake', dd.severity === 'block', dd.reason);
  const ambiguous = geoScope({
    subject: { name: 'X' }, evidence: { text: 'a lovely spot in Saint-Barthélemy' },
    region: { ...region, ...STBARTH_REGION_TEXT },
  });
  assert('[6b] place-name alone returns UNKNOWN, never a silent pass', ambiguous.severity === 'unknown', ambiguous.reason);

  // ── 7. Bagatelle cited from a page headed "Bagatelle ST TROPEZ" ───────────
  // No single check catches this and it is important to show that honestly:
  // entity_gate is RIGHT that bagatelle.com is Bagatelle's own site. Only the
  // composition finds it.
  const bagGate = entityGate({
    subject_type: 'organization', subject: { name: 'BAGATELLE ST BARTH' },
    evidence: { url: 'https://bagatelle.com/venues/st-tropez', text: 'Bagatelle St Tropez — beach club on Plage de Pampelonne' },
  });
  const bag = await validate({
    subject_type: 'organization', field: 'source_citation', value: 'https://bagatelle.com/venues/st-tropez',
    context: {
      subject: { name: 'BAGATELLE ST BARTH' },
      region: { ...region, ...STBARTH_REGION_TEXT },
      evidence: { url: 'https://bagatelle.com/venues/st-tropez', text: 'Bagatelle St Tropez — beach club on Plage de Pampelonne' },
    },
  });
  assert('[7] Bagatelle ST BARTH cited from the ST TROPEZ outlet', bag.verdict === 'block',
    `entity_gate alone says "${bagGate.reason}" (correctly — it IS Bagatelle's site); the composed verdict is ${bag.verdict} via ` +
    `${bag.checks.filter((c) => c.severity === 'block').map((c) => `${c.check}: ${c.reason}`).join('; ')}`);

  // ── 8. 5 marks that composite to pure white and render as an empty box ────
  const orgs = await all('organizations', 'id,name,logo_url,metadata');
  // The quarantine ledger holds SEVERAL defect classes under one key. Test each
  // against the check that owns it — the classes are not interchangeable, and
  // an earlier draft of this file wrongly asserted they were.
  const quar = orgs.filter((o) => o.metadata?.mark_quarantine?.logo_url_as_found);
  const byReason = {};
  for (const o of quar) (byReason[o.metadata.mark_quarantine.reason] ??= []).push(o);
  console.log(`        ${C.d}quarantine ledger: ${Object.entries(byReason).map(([r, v]) => `${r}=${v.length}`).join(', ')}${C.x}`);

  const blanks = byReason.blank_renders_invisible || [];
  let blankHits = 0;
  for (const o of blanks) {
    const r = await imageSanity({ value: o.metadata.mark_quarantine.logo_url_as_found });
    const hit = r.severity !== 'pass' && /blank_renders_invisible|low_resolution/.test(r.reason);
    if (hit) blankHits++;
    console.log(`        ${C.d}${o.name.padEnd(34)} ${hit ? 'RE-DETECT' : 'miss     '} ${r.reason.slice(0, 84)}${C.x}`);
  }
  assert('[8] blank marks that composite to the paper ground',
    blanks.length > 0 && blankHits === blanks.length,
    `${blankHits}/${blanks.length} marks quarantined as blank are re-detected from their preserved URLs by generalised ink-coverage compositing — no hardcoded name list, unlike the one-off scan these came from`);

  // ── 8b. LIVE blanks the original one-off scan never saw ──────────────────
  // The 605-mark scan covered the St Barth org set. The same method run over
  // the whole `organizations` table finds more, which is the point of a gate
  // over a one-off: it does not have a scope that expires.
  const liveMarks = orgs.filter((o) => o.logo_url && /^https?:/i.test(o.logo_url));
  const sample = liveMarks.slice(0, 130);
  const newBlanks = [];
  await Promise.all(sample.map(async (o) => {
    const r = await imageSanity({ value: o.logo_url });
    if (r.severity === 'quarantine' && /blank_renders_invisible/.test(r.reason)) newBlanks.push([o.name, r.evidence.ink_pct, `${r.evidence.w}x${r.evidence.h}`]);
  }));
  assert('[8b] NEW — live blank marks outside the original scan scope', newBlanks.length > 0,
    `${newBlanks.length} of ${sample.length} sampled live marks composite to nothing: ` +
    newBlanks.map(([n, i, d]) => `${n} (${d}, ink ${i}%)`).join(', ') + ` — each currently scores as a captured mark.`);

  // ── 9. 244 villas wearing one logo binary belonging to their agency ───────
  // Replayed at full scale: every mark quarantined as `shared_binary` is
  // restored to its as-found value in memory, and the check is asked to find
  // the clusters again with no knowledge of the answer.
  const sb9 = orgs.filter((o) => o.metadata?.mark_quarantine?.reason === 'shared_binary' && o.metadata.mark_quarantine.sha256);
  const replayBin = sharedValue(
    sb9.map((o) => ({ id: o.id, name: o.name, __sha256: o.metadata.mark_quarantine.sha256 })),
    { field: '__sha256', threshold: 2 },
  );
  const misBin = replayBin.filter((s) => !s.evidence.duplicate_rows);
  const biggest = misBin[0];
  assert('[9] one binary worn by N unrelated subjects (244-villa defect, replayed on sha256)',
    !!biggest && biggest.evidence.n >= 200,
    `${sb9.length} marks carry a preserved sha256; clustering on the digest re-finds ${misBin.length} misattribution groups, largest ${biggest?.evidence.n}× one binary (${biggest?.evidence.subjects.slice(0, 4).join(' / ')}…). ` +
    `Clustering on logo_url instead finds NOTHING here — each villa has its own storage URL. That is the correction the first draft of this check needed.`);

  // Still worth running on raw values — it is what catches placeholder strings.
  const withLogoRows = orgs.filter((o) => o.logo_url).map((o) => ({ id: o.id, name: o.name, logo_url: o.logo_url }));
  const shared = sharedValue(withLogoRows, { field: 'logo_url', threshold: 2 });
  const misattributed = shared.filter((s) => !s.evidence.duplicate_rows);
  console.log(`        ${C.d}same check on raw logo_url, live right now: ${misattributed.map((m) => `${m.evidence.n}× "${m.evidence.value.slice(-40)}"`).join(', ')}${C.x}`);
  console.log(`        ${C.d}duplicate-row findings correctly separated from misattribution (same business, two rows): ${shared.length - misattributed.length}${C.x}`);

  // ── 10. LIVE defect found by this tool, not previously on the list ────────
  const placeholders = withLogoRows.filter((o) => !/^(https?:|data:|\/)/i.test(o.logo_url));
  assert('[10] NEW — placeholder strings stored in an image column', placeholders.length > 0,
    `${placeholders.length} orgs store a literal string instead of a URL: ${[...new Set(placeholders.map((p) => `"${p.logo_url}"`))].join(', ')} — each scores as a captured mark (logo_url IS NOT NULL) and renders nothing. Live right now.`);

  console.log(`\n${C.b}${passed} caught, ${failed} missed${C.x}`);
  console.log(`${C.d}No rows were written, nulled or deleted by this selftest.${C.x}`);
  return failed === 0;
}

if (import.meta.url === `file://${process.argv[1]}`) run().then((ok) => process.exit(ok ? 0 : 1));

#!/usr/bin/env node
/**
 * Selftest for page-people-reconcile. Pure — no DB, no env, no network.
 *
 * Every case below is a REAL page shape measured in the corpus on 2026-07-20,
 * not a hypothetical. This file is the reason a future agent cannot quietly
 * loosen a rule: loosen one and a named defect goes red here.
 *
 *   node scripts/entity/page-people-reconcile.selftest.mjs
 *   npm run reconcile:page-people:selftest
 */
import { reconcilePage, isName, norm, roleRelation, isGeneric } from './page-people-reconcile.mjs';

let pass = 0, fail = 0;
const t = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};

console.log('\n── normalisation ──');
t('KATIE LISTER === Katie Lister', norm('KATIE LISTER') === norm('Katie Lister'));
t('accents fold (Kénzia === Kenzia)', norm('Kénzia Bengel') === norm('Kenzia Bengel'));
t('underscores fold (frank_binder === frank binder)', norm('frank_binder') === norm('frank binder'));

console.log('\n── what is not a name (measured placeholder echo) ──');
t('"str" rejected (1,386 credit names in corpus)', !isName('str'));
t('"photographer" as a NAME rejected (175 in corpus)', !isName('photographer'));
t('"writer" as a NAME rejected (38 in corpus)', !isName('writer'));
t('prompt placeholder rejected', !isName('ALL visible text on the page, verbatim'));
t('a real name survives', isName('Katie Lister') && isName("E. Désirée Asher"));

console.log('\n── generic bodies ──');
t('null name is generic', isGeneric(null));
t('"model" is generic', isGeneric('model'));
t('a named human is not generic', !isGeneric('Jeanne Damas'));

console.log('\n── role relations ──');
t('"founder|chairman" ≡ "founder_and_chairman"', roleRelation('founder|chairman', 'founder_and_chairman') === 'same');
t('"photographer" ⊂ "art director & photographer"', roleRelation('photographer', 'art director & photographer') === 'subsumption');
t('"photographer" vs "writer" is a conflict', roleRelation('photographer', 'writer') === 'conflict');

console.log('\n── THE CASE: Katie Lister (page 0004ccd5…, lofficiel-riviera-12 p21) ──');
const katie = reconcilePage({
  people_in_image: [{ name: 'Katie Lister', role: 'unknown', bbox: [0.4, 0.2, 0.5, 0.3] }],
  creative_credits: [{ name: 'KATIE LISTER', role: 'writer' }],
  people_mentioned: [],
});
t('the unknown is filled with "writer"', katie.adopted.length === 1 && katie.adopted[0].role === 'writer',
  JSON.stringify(katie.adopted));
t('the fill cites its donor layer', katie.adopted[0]?.from?.layer === 'creative_credits');
t('spatial_tags itself is untouched (pure fn returns a verdict only)',
  !('people_in_image' in katie) && Array.isArray(katie.adopted));

console.log('\n── refusals ──');
const informative = reconcilePage({
  people_in_image: [{ name: 'Mory Sacko', role: 'cover_star' }],
  people_mentioned: [{ name: 'Mory Sacko', role: 'chef' }],
});
t('an INFORMATIVE role is never overwritten', informative.adopted.length === 0);
t('the disagreement is recorded as a conflict', informative.conflicts.length === 1);
t('cross-axis is labelled as such (a chef can be a cover star)',
  informative.conflicts[0].kind === 'role_conflict_cross_axis', informative.conflicts[0]?.kind);

const ambiguous = reconcilePage({
  people_in_image: [{ name: 'Daniel Arsham', role: 'unknown' }],
  creative_credits: [{ name: 'Daniel Arsham', role: 'photographer' }],
  people_mentioned: [{ name: 'Daniel Arsham', role: 'artist' }],
});
t('two disagreeing donors adopt NOTHING', ambiguous.adopted.length === 0);
t('…and are recorded as ambiguous_donor',
  ambiguous.conflicts.some(c => c.kind === 'ambiguous_donor'));

const subsumed = reconcilePage({
  people_in_image: [{ name: 'Jane Roe', role: 'unknown' }],
  creative_credits: [{ name: 'Jane Roe', role: 'photographer' }],
  people_mentioned: [{ name: 'JANE ROE', role: 'contributing photographer' }],
});
t('donors differing only by specificity adopt the COMMON claim, not the richest',
  subsumed.adopted.length === 1 && norm(subsumed.adopted[0].role) === 'photographer',
  JSON.stringify(subsumed.adopted.map(a => a.role)));

console.log('\n── the fabrication guard: never name a face ──');
const guess = reconcilePage({
  people_in_image: [{ name: null, role: 'model', bbox: [0.3, 0.2, 0.7, 0.9] }],
  creative_credits: [],
  people_mentioned: [{ name: 'Jeanne Damas', role: 'model' }],
});
t('a lone body + a lone name is NOT merged', guess.adopted.length === 0);
t('…it is recorded as a candidate with evidence',
  guess.candidates.length === 1 && !!guess.candidates[0].evidence, JSON.stringify(guess.candidates));
t('…and the refusal is stated in the row itself',
  /NOT MERGED/.test(guess.candidates[0]?.resolution || ''));

const twoBodies = reconcilePage({
  people_in_image: [{ name: null, role: 'model' }, { name: null, role: 'model' }],
  people_mentioned: [{ name: 'Jeanne Damas', role: 'model' }],
});
t('two bodies and one name yields NO candidate (ambiguous)', twoBodies.candidates.length === 0);

console.log('\n── the person/organisation seam ──');
const org = reconcilePage({
  people_in_image: [{ name: null, role: 'model', bbox: [0.1, 0, 0.8, 1] }],
  creative_credits: [{ name: 'APM Monaco', role: 'stylist' }],
  people_mentioned: [{ name: 'APM Monaco', role: 'brand' }],
  brands: [{ name: 'APM Monaco' }],
});
t('a brand is never offered as the person in the photo', org.candidates.length === 0,
  JSON.stringify(org.candidates));
t('…and is recorded as excluded, with a reason', org.excluded_non_human.length >= 1);
t('…and no role is adopted for it', org.adopted.length === 0);

const boutique = reconcilePage({
  people_in_image: [{ name: null, role: 'model' }],
  people_mentioned: [{ name: 'CARLA SAINT BARTH', role: 'boutique' }],
});
t('role="boutique" marks a non-human even with no brands array', boutique.candidates.length === 0);

console.log('\n── silence is not a finding ──');
const empty = reconcilePage({});
t('an empty page produces an empty verdict',
  !empty.adopted.length && !empty.conflicts.length && !empty.candidates.length);
const single = reconcilePage({ creative_credits: [{ name: 'Solo Person', role: 'writer' }] });
t('one layer alone yields nothing to reconcile', !single.adopted.length && !single.conflicts.length);

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);

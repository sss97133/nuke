// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LaborAppraisalView, rangeText, witnessText, witnessedHoursText, witnessedTotalText } from './LaborAppraisal';
import live214500 from './__fixtures__/labor-appraisal-214500.json';
import type { LaborAppraisal } from './hooks/useLaborAppraisal';
import live from './__fixtures__/labor-appraisal.json';

const appraisal = live as unknown as LaborAppraisal;
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ');

/** Every number the reader sent, as text, so a printed number can be traced to it. */
function readerNumbers(value: unknown, out = new Set<string>()): Set<string> {
  if (typeof value === 'number') out.add(String(value));
  else if (typeof value === 'string') for (const m of value.match(/\d+(?:\.\d+)?/g) ?? []) out.add(String(Number(m)));
  else if (Array.isArray(value)) { out.add(String(value.length)); value.forEach(v => readerNumbers(v, out)); }
  else if (value && typeof value === 'object') Object.values(value).forEach(v => readerNumbers(v, out));
  return out;
}

describe('LaborAppraisalView', () => {
  it('prints every segment with its own grade and never the blended totals', () => {
    const page = text(renderToStaticMarkup(<LaborAppraisalView appraisal={appraisal} />));
    for (const s of appraisal.segments) expect(page).toContain(s.segment.replace(/_/g, ' '));
    expect(page).toContain('Ungraded by the reader');
    expect(page).toContain('photographed stage');
    const { hours_min, hours_typical, hours_max } = appraisal.totals!;
    for (const blended of [hours_min, hours_typical, hours_max]) expect(page).not.toMatch(new RegExp(`\\b${String(blended).replace('.', '\\.')} h`));
  });

  it('prints no number the reader did not send', () => {
    const page = text(renderToStaticMarkup(<LaborAppraisalView appraisal={appraisal} />));
    const allowed = readerNumbers(appraisal);
    const printed = (page.replace(/(\d),(\d)/g, '$1$2').match(/\d+(?:\.\d+)?/g) ?? []).map(n => String(Number(n)));
    const foreign = printed.filter(n => !allowed.has(n));
    expect(foreign).toEqual([]);
  });

  it('prints the reader per-grade sums when it sends them, and nothing for an inapplicable car', () => {
    const graded: LaborAppraisal = { ...appraisal, totals: { ...appraisal.totals!, by_grade: { shop_paper: { hours_min: 50.75, hours_typical: 50.75, hours_max: 50.75 } } } };
    expect(text(renderToStaticMarkup(<LaborAppraisalView appraisal={graded} />))).toMatch(/Hours by evidence grade\s+shop paper\s+50\.75 h/);
    expect(renderToStaticMarkup(<LaborAppraisalView appraisal={{ ...appraisal, applicable: false }} />)).toBe('');
    expect(renderToStaticMarkup(<LaborAppraisalView appraisal={{ ...appraisal, segments: [] }} />)).toBe('');
    const unpriced = appraisal.segments.map(s => ({ ...s, hours_min: null, hours_typical: null, hours_max: null }));
    expect(renderToStaticMarkup(<LaborAppraisalView appraisal={{ ...appraisal, segments: unpriced }} />)).toBe('');
  });

  it('names a fitted part only in the reader words and counts the rest', () => {
    const page = text(renderToStaticMarkup(<LaborAppraisalView appraisal={appraisal} />));
    // Parts the reader does not name are counted; no operation code and no "not named" defect text reach the page.
    expect(page).not.toMatch(/not named|INT-CARPET-RR|Rule:/);
    expect(page).toMatch(/Fitted parts with a book operation: \d+/);
    expect(rangeText({ hours_min: 8, hours_typical: 12, hours_max: 16 })).toBe('8 h to 16 h, typical 12 h');
    expect(rangeText({ hours_min: 2.75, hours_typical: 2.75, hours_max: 2.75 })).toBe('2.75 h');
  });

  // Shapes ta-labor announced on 2026-11-24 (20261124194000, 20261124214500, 20261124220000), not live when written.
  it('prints the two totals side by side when the reader sends them, never one blended figure', () => {
    const two: LaborAppraisal = { ...appraisal, totals: { ...appraisal.totals!, rule: 'Witnessed hours exclude purchases not seen fitted.',
      witnessed: { hours_min: 88.5, hours_typical: 112.5, hours_max: 149.5 },
      with_unwitnessed_purchases: { hours_min: 130.5, hours_typical: 174.5, hours_max: 259.5 } } };
    const page = text(renderToStaticMarkup(<LaborAppraisalView appraisal={two} />));
    expect(page).toMatch(/Witnessed\s+88\.5 h to 149\.5 h, typical 112\.5 h/);
    expect(page).toMatch(/With purchases not seen fitted\s+130\.5 h to 259\.5 h, typical 174\.5 h/);
    // The reader's rule is its own identifiers: kept in the title attribute, not printed.
    expect(page).not.toContain('Witnessed hours exclude purchases not seen fitted.');
    expect(renderToStaticMarkup(<LaborAppraisalView appraisal={two} />)).toContain('title="Witnessed hours exclude purchases not seen fitted."');
  });

  it('says "not appraised" when the reader prices nothing', () => {
    const none: LaborAppraisal = { ...appraisal, segments: appraisal.segments.map(s => ({ ...s, hours_min: null, hours_typical: null, hours_max: null })),
      totals: { hours_min: null, hours_typical: null, hours_max: null, priced_segments: 0 } };
    expect(text(renderToStaticMarkup(<LaborAppraisalView appraisal={none} />))).toContain('Not appraised');
  });

  it('counts pieces by witness and never calls an unwitnessed piece not fitted', () => {
    const seg = (extra: object) => ({ ...appraisal.segments[0], ...extra }) as LaborAppraisal['segments'][number];
    expect(witnessText(seg({ witness_share: { fitted_with_operation: 0, fitted_without_operation: 1, not_fitted: 0, unwitnessed: 13,
      none_raised: 13, cannot_tell: 3, pieces: [] } })))
      .toBe('1 fitted without a book operation · 13 bought, not seen fitted (13 with no fitted question raised) · 3 cannot tell');
    expect(witnessText(seg({ stage_steps: [{ pieces: [
      { item_id: 'a', hours: null, witness: 'unwitnessed', question_state: 'cannot_tell' },
      { item_id: 'b', hours: null, witness: 'unwitnessed', question_state: 'open' },
      { item_id: 'c', hours: null, witness: 'fitted' } ] }] }))).toBe('1 fitted · 1 bought; fitted question cannot tell · 1 bought; fitted question open');
    expect(witnessText(seg({}))).toBeNull();
  });

  it('prints the witnessed total as a floor only when the reader marks its max unwitnessed', () => {
    const w = { hours_min: 71, hours_typical: 81, hours_max: 247 };
    expect(witnessedTotalText(w)).toBe('71 h to 247 h, typical 81 h');
    expect(witnessedTotalText({ ...w, max_witnessed: false })).toBe('at least 71 h, typical 81 h');
    expect(witnessedTotalText({ ...w, hours_max: null })).toBe('at least 71 h, typical 81 h');
    expect(witnessedTotalText({ hours_min: null, hours_typical: null, hours_max: 40 })).toBeNull();
  });

  it('says a missing witnessed minimum instead of filling it', () => {
    const seg = (extra: object) => ({ ...appraisal.segments[0], ...extra }) as LaborAppraisal['segments'][number];
    expect(witnessedHoursText(seg({ witnessed_reason: 'not witnessed', witnessed_hours_min: null, witnessed_hours_typical: null, witnessed_hours_max: 84 })))
      .toBe('Witnessed: not witnessed; minimum unknown, at most 84 h');
    expect(witnessedHoursText(seg({ witnessed_hours_min: 7, witnessed_hours_typical: 7, witnessed_hours_max: 40 }))).toBe('Witnessed: 7 h to 40 h, typical 7 h');
  });

  it('renders the live 20261124214500 shape: two totals, witness counts, and no foreign number', () => {
    const a = live214500 as unknown as LaborAppraisal;
    const page = text(renderToStaticMarkup(<LaborAppraisalView appraisal={a} />));
    expect(page).toContain('Witnessed');
    expect(page).toContain('With purchases not seen fitted');
    expect(page).toContain('bought; fitted question cannot tell');
    expect(page).not.toMatch(/\d+ not fitted/);
    const allowed = readerNumbers(a);
    const printed = (page.replace(/(\d),(\d)/g, '$1$2').match(/\d+(?:\.\d+)?/g) ?? []).map(x => String(Number(x)));
    expect(printed.filter(x => !allowed.has(x))).toEqual([]);
  });

  it('names a reassembly piece by its catalog part and says when a piece has none', () => {
    const seg = { ...appraisal.segments[0], reassembly: { matched: [
      { item_id: 'a', hours: 2, operation_code: 'INT-SEAT', part: { catalog_part_id: 'c1', name: 'Front bucket seat cover' } },
      { item_id: 'b', hours: 1, operation_code: 'INT-SEAT' } ] } };
    const page = text(renderToStaticMarkup(<LaborAppraisalView appraisal={{ ...appraisal, segments: [seg] }} />));
    expect(page).toContain('Front bucket seat cover, 2 h; 1 more');
    expect(page).not.toMatch(/INT-SEAT|not in catalog/);
  });
});

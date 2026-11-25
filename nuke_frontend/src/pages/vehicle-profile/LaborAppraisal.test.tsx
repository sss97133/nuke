// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LaborAppraisalView, rangeText } from './LaborAppraisal';
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
    expect(page).toContain('3 of 3 not named by the reader');
    expect(page).toContain('INT-CARPET-RR 2 h');
    expect(rangeText({ hours_min: 8, hours_typical: 12, hours_max: 16 })).toBe('8 h to 16 h, typical 12 h');
    expect(rangeText({ hours_min: 2.75, hours_typical: 2.75, hours_max: 2.75 })).toBe('2.75 h');
  });
});

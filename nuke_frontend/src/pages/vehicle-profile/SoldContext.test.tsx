import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { expect, it, vi } from 'vitest';
vi.mock('../../components/PrefetchLink', () => ({ PrefetchLink: ({ to, children, ...props }: any) => <a href={to} {...props}>{children}</a> }));
import SoldContext, { groupSoldContext } from './SoldContext';
import type { CompSale } from './hooks/useVehicleIntel';

const subject = { year: 1997, make: 'Porsche', model: '911 Turbo' };
const sale = (id: string, model: string, price: number, year = 1997): CompSale => ({
  id, model, year, sale_price: price, sale_date: '2026-09-01', thumbnail: null, mileage: null, source_url: `https://example.com/${id}`,
});
const records = [sale('cabriolet', '911 Carrera Cabriolet', 70000), sale('turbo-a', '911 Turbo', 291000),
  sale('turbo-b', '911 Turbo', 382500), sale('turbo-s', '911 Turbo S', 852000),
  sale('other-year', '911 Turbo', 300000, 1996), sale('carrera-4', '911 Carrera 4 Cabriolet', 135000)];

it('keeps Turbo S, other model years and cabriolets outside the exact current-label comparison', () => {
  const groups = groupSoldContext(records, subject);
  expect(groups[0].sameLabel).toBe(true);
  expect(groups[0].sales.map(record => record.id)).toEqual(['turbo-a', 'turbo-b']);
  expect(groups.flatMap(group => group.sales)).toHaveLength(6);
});

it('computes the difference from the matching records and retains every record with inspection links', () => {
  const html = renderToStaticMarkup(<SoldContext comps={records} subject={subject} recordedSale={378000} />);
  const doc = new JSDOM(html).window.document;
  expect(doc.querySelector('summary')!.textContent).toContain('+12.2% vs same-label median · 2 records');
  expect(doc.querySelectorAll('.vp-sold-context__sale')).toHaveLength(6);
  expect(doc.querySelectorAll('.vp-sold-context__record')).toHaveLength(6);
  expect(doc.querySelectorAll('a[target="_blank"]')).toHaveLength(6);
  expect(html).not.toContain('$378,000');
  expect(doc.querySelector('details')!.open).toBe(false);
  expect(doc.body.textContent).toContain('condition');
  expect(doc.body.textContent).not.toMatch(/percentile|premium of|estimated value/i);
});

it('withholds the median comparison for a single match, missing sale, unknown labels or undated prices', () => {
  const html = renderToStaticMarkup(<SoldContext comps={[records[1], {...records[2], sale_date: null}, sale('invalid', '911 Turbo', Infinity), sale('unknown', '', 300000)]} subject={subject} recordedSale={378000} />);
  expect(html).not.toContain('%');
  const missing = renderToStaticMarkup(<SoldContext comps={records} subject={subject} />);
  expect(missing).not.toContain('%');
});

it('does not turn an untrusted source URL into an executable link', () => {
  const html = renderToStaticMarkup(<SoldContext comps={[{...records[1], source_url:'javascript:alert(1)'}]} subject={subject} />);
  expect(html).not.toContain('javascript:');
});

// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BuildRecord } from './BuildRecord';
import type { BuildReconstruction } from './hooks/useBuildReconstruction';

const record = (amounts: boolean): BuildReconstruction => ({
  version: 1, as_of: '2026-11-20T00:00:00Z', amounts_visible: amounts, rule: '', systems_without_paper: ['paint', 'tires'],
  totals: { lines: 4, placed_lines: 4, receipts: 2, first_day: '2024-10-07', last_day: '2025-05-04', part_lines: 2, paper_work_lines: 2,
    paper_hours: 4.5, reference_hours: 8, reference_operations: 1, parts_without_reference: 1, recorded_amount: amounts ? 900 : null },
  systems: [
    { system_key: 'machining', first_day: '2024-10-07', last_day: '2024-10-07', part_lines: 0, backordered_lines: 0, suppliers: [],
      paper: { lines: 2, lines_without_hours: 1, hours: 4.5, performers: 1, shops: ['Machine Shop'] },
      reference: { hours: null, parts_without_reference: 0, operations: [] }, priced_lines: 1, recorded_amount: amounts ? 500 : null,
      lines: [{ item_id: 'a', receipt_id: 'r1', kind: 'labor', day: '2024-10-07', source: 'Machine Shop', description: 'Bore cylinders .060', part_number: null, paper_hours: 4.5, operation_code: null, amount: null },
        { item_id: 'b', receipt_id: 'r1', kind: 'service', day: '2024-10-07', source: 'Machine Shop', description: 'Valve Job', part_number: null, paper_hours: null, operation_code: null, amount: amounts ? 500 : null }] },
    { system_key: 'electrical', first_day: '2025-05-04', last_day: '2025-05-04', part_lines: 2, backordered_lines: 0, suppliers: ['Supplier'],
      paper: { lines: 0, lines_without_hours: 0, hours: null, performers: 0, shops: [] },
      reference: { hours: 8, parts_without_reference: 1, operations: [{ code: 'ELEC-WIRING-HARNESS', name: 'Wiring harness R&R', hours: 8, part_lines: 1, basis: 'part_on_receipt' }] },
      priced_lines: 2, recorded_amount: amounts ? 400 : null,
      lines: [{ item_id: 'c', receipt_id: 'r2', kind: 'part', day: '2025-05-04', source: 'Supplier', description: 'UNDERDASH WIRING HRNS', part_number: 'W1', paper_hours: null, operation_code: 'ELEC-WIRING-HARNESS', amount: amounts ? 300 : null },
        { item_id: 'd', receipt_id: 'r2', kind: 'part', day: '2025-05-04', source: 'Supplier', description: 'MINI BULB', part_number: 'B1', paper_hours: null, operation_code: null, amount: amounts ? 100 : null }] },
  ],
});

describe('BuildRecord', () => {
  it('shows paper hours and reference time as separate measures and never a sum', () => {
    const html = renderToStaticMarkup(<BuildRecord record={record(false)} />);
    expect(html).toContain('4.5 h');
    expect(html).toContain('8 h');
    expect(html).not.toContain('12.5');
    expect(html).toContain('1 of 2');
    expect(html).toContain('Paint, Wheels &amp; tires');
    expect(html).toContain('1 line printed without hours');
  });
  it('shows recorded amounts only when the reader says the viewer may see them', () => {
    expect(renderToStaticMarkup(<BuildRecord record={record(false)} />)).not.toContain('$');
    const own = renderToStaticMarkup(<BuildRecord record={record(true)} />);
    expect(own).toContain('$900.00');
    expect(own).toContain('visible to you only');
  });
  it('shows a system seen only in photos, with its photographs and no invented paper', () => {
    const withPhotos = record(false); withPhotos.totals.photo_images = 9;
    withPhotos.systems.push({ system_key: 'tires', first_day: null, last_day: null, part_lines: 0, backordered_lines: 0, suppliers: [],
      paper: { lines: 0, lines_without_hours: 0, hours: null, performers: 0, shops: [] }, reference: { hours: null, parts_without_reference: 0, operations: [] },
      priced_lines: 0, recorded_amount: null, lines: null,
      photos: { images: 9, readings: 9, first_day: '2026-10-28', last_day: '2026-10-28', sample: [{ image_id: 'p1', image_url: 'https://x.test/1.jpg' }] } });
    const html = renderToStaticMarkup(<BuildRecord record={withPhotos} />);
    expect(html).toContain('Wheels &amp; tires');
    expect(html).toContain('No paper on file');
    expect(html).toContain('As photographed · 9 photos, Oct 2026');
    expect(html).toContain('Open Wheels &amp; tires photo');
  });
  it('renders nothing when the vehicle has no receipt lines', () => {
    const empty = record(false); empty.totals.lines = 0;
    expect(renderToStaticMarkup(<BuildRecord record={empty} />)).toBe('');
  });
});

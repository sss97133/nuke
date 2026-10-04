import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FieldEvidenceGroup } from './hooks/useFieldEvidence';

const fixture = vi.hoisted(() => ({ provenance: {} as any }));
vi.mock('./hooks/useFieldProvenance', async importOriginal => ({
  ...await importOriginal<typeof import('./hooks/useFieldProvenance')>(), useFieldProvenance: () => fixture.provenance,
}));
vi.mock('./hooks/useVehicleImageEvidence', async importOriginal => ({
  ...await importOriginal<typeof import('./hooks/useVehicleImageEvidence')>(),
  useVehicleImageEvidence: () => ({ data: { images: [], complete: true }, isLoading: false }),
}));
vi.mock('../../components/PrefetchLink', () => ({ default: ({ to, children }: any) => <a href={to}>{children}</a> }));
vi.mock('../../components/popups/usePopup', () => ({ usePopup: () => ({ closeTop: vi.fn() }) }));
import FieldEvidencePopup from './FieldEvidencePopup';
const render = (evidence?: FieldEvidenceGroup) => renderToStaticMarkup(<FieldEvidencePopup vehicleId="local-vehicle" field="vin" label="VIN" value="Unknown" evidence={evidence} />);

beforeEach(() => {
  fixture.provenance = { isLoading: false, error: null, data: { value: null, evidence: [], observations: [
    { id: 'local-observation', value: 'SOURCE-VIN', confidence: 0.6, source_url: 'https://example.com/listing', source_slug: 'listing-source', observed_at: '2026-10-03T12:00:00Z' },
  ] } };
});
describe('canonical value -> attributed observation', () => {
  it('keeps canonical unknown separate from a real report and links the observation and source', () => {
    const html = render();
    expect(html).toContain('The canonical value is unknown'); expect(html).toContain('SOURCE-VIN');
    expect(html).toContain('href="/vehicle/local-vehicle/observation/local-observation"');
    expect(html).toContain('href="https://example.com/listing"');
    expect(html).toContain('Ingest time: Unavailable'); expect(html).toContain('Method: Unavailable');
    expect(html).toContain('Stored confidence: 0.6');
  });
  it('does not hide a report with no usable link or turn repeated reports into independent support', () => {
    fixture.provenance.data.observations[0].source_url = 'javascript:alert(1)';
    fixture.provenance.data.observations.push({ ...fixture.provenance.data.observations[0], id: 'local-repeat' });
    const html = render(); expect(html).toContain('Link unavailable'); expect(html).not.toContain('javascript:');
    expect(html).toContain('local-repeat'); expect(html).not.toContain('independent confirmations');
  });
  it('preserves optional deployed clocks and method without deriving a resolution', () => {
    Object.assign(fixture.provenance.data.observations[0], { ingested_at: '2026-10-03T13:00:00Z', extraction_method: 'structured_import' });
    const group = { sources: [], hasConflict: true, conflictType: 'genuine' } as unknown as FieldEvidenceGroup;
    const html = render(group);
    expect(html).toContain('Source claims differ'); expect(html).toContain('No resolution is established');
    expect(html).toContain('structured_import'); expect(html).not.toContain('Ingest time: Unavailable');
  });
  it('qualifies multiple claims when opened before the parent evidence group arrives', () => {
    fixture.provenance.data.value = '4x4';
    fixture.provenance.data.evidence = [
      { source: 'nhtsa', source_type: 'vin_decode', value: '4x2' },
      { source: 'bat', source_type: 'bat', value: '4x4' },
    ];
    const html = render();
    expect(html).toContain('4x2'); expect(html).toContain('4x4');
    expect(html).toContain('This display does not establish whether differences have been resolved');
    expect(html).not.toContain('Source claims differ.');
  });
  it('renders denial without leaking a supplied value or treating failure as absence', () => {
    fixture.provenance.data = null;
    const html = renderToStaticMarkup(<FieldEvidencePopup vehicleId="local-private" field="vin" label="VIN" value="DO-NOT-EXPOSE" />);
    expect(html).toContain('unavailable or this record is private'); expect(html).not.toContain('DO-NOT-EXPOSE');
    fixture.provenance.error = new Error('local simulated failure');
    expect(render()).toContain('could not be read. Its absence has not been established');
  });
});

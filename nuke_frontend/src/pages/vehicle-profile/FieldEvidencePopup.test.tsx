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
  it('shows the qualified engine winner with its unit and identifies its report', () => {
    fixture.provenance.data.canonical = { status: 'resolved', value: '2.5', observation_id: 'local-observation' };
    fixture.provenance.data.observations[0].value = '2.5';
    const html = renderToStaticMarkup(<FieldEvidencePopup vehicleId="local-vehicle" field="engine_displacement_l" label="DISPLACEMENT" value="2.5 L" />);
    expect(html).toContain('RESOLVED SOURCE CLAIM'); expect(html).toContain('<strong>2.5 L</strong>');
    expect(html).toContain('RESOLVED REPORT'); expect(html).toContain('does not establish factory or current physical configuration');
  });
  it('keeps reports available when the engine winner cannot be read', () => {
    fixture.provenance.data.canonical = { status: 'unavailable' };
    const html = renderToStaticMarkup(<FieldEvidencePopup vehicleId="local-vehicle" field="engine_configuration" label="ENGINE CONFIGURATION" value="Unknown" />);
    expect(html).toContain('resolved value could not be read'); expect(html).toContain('SOURCE-VIN');
    expect(html).not.toContain('RESOLVED REPORT'); expect(html).not.toContain('canonical value is unknown');
  });
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
    fixture.provenance.data.observations[0].source_url = null;
    expect(render()).toContain('Inspect observation local-observation');
  });
  it('preserves optional deployed clocks and method without deriving a resolution', () => {
    Object.assign(fixture.provenance.data.observations[0], { ingested_at: '2026-10-03T13:00:00Z', extraction_method: 'structured_import' });
    const group = { sources: [], hasConflict: true, conflictType: 'genuine' } as unknown as FieldEvidenceGroup;
    const html = render(group);
    expect(html).toContain('Source claims differ'); expect(html).toContain('No resolution is established');
    expect(html).toContain('structured_import'); expect(html).not.toContain('Ingest time: Unavailable');
  });
  it('lets readers open a retained excerpt and its original record with distinct source clocks and unknowns', () => {
    Object.assign(fixture.provenance.data.observations[0], {
      content: 'Retained source claim: This 1995 example was reported by its seller.',
      source_observation_id: '00000000-0000-4000-8000-000000000001',
      source_observed_at: '2026-10-01T12:00:00Z', source_recorded_at: '2026-10-01T12:01:00Z',
      independent_source: false, source_event_time_status: 'unknown', identity_resolution_status: 'unverified',
      factory_configuration_status: 'unknown', current_configuration_status: 'unknown',
    });
    const html = render();
    expect(html).toContain('<details><summary>Read retained evidence</summary>');
    expect(html).toContain('Retained source claim: This 1995 example');
    expect(html).toContain('OBSERVATION EXCERPT · UP TO 400 CHARACTERS');
    expect(html).toContain('/vehicle/local-vehicle/observation/00000000-0000-4000-8000-000000000001');
    expect(html).toContain('Source observation time: 2026-10-01T12:00:00Z');
    expect(html).toContain('Source record time: 2026-10-01T12:01:00Z');
    expect(html).toContain('Source event time: Unknown');
    expect(html).toContain('not an independent confirmation');
    expect(html).toContain('This report leaves vehicle identity unverified');
    expect(html).toContain('Factory and current configuration are unknown in this report');
  });
  it('escapes retained text and refuses malformed source-record routes without inventing clocks', () => {
    Object.assign(fixture.provenance.data.observations[0], {
      content: '<script>untrusted source text</script>', source_observation_id: '../../another-vehicle',
      independent_source: true,
    });
    const html = render();
    expect(html).toContain('&lt;script&gt;untrusted source text&lt;/script&gt;');
    expect(html).not.toContain('<script>'); expect(html).not.toContain('another-vehicle');
    expect(html).toContain('Source observation time: Unknown');
    expect(html).toContain('Source record time: Unknown');
    expect(html).not.toContain('independent confirmation');
  });
  it('does not add an empty evidence detail to older reader responses', () => {
    expect(render()).not.toContain('Read retained evidence');
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
  it('renders refused coverage without treating withheld arrays as empty evidence', () => {
    fixture.provenance.data.coverage = { status: 'refused_input_limit' };
    const html = render({ sources: [{ source_type: 'bat', field_value: 'SUPPLIED-CLAIM' }] } as unknown as FieldEvidenceGroup);
    expect(html).toContain('Source evidence could not be loaded completely');
    expect(html).toContain('Coverage is unknown');
    expect(html).not.toContain('SOURCE-VIN');
    expect(html).not.toContain('SUPPLIED-CLAIM');
    expect(html).not.toContain('canonical value is unknown');
  });
});

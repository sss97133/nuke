import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import FieldProvenanceDrawer, { SourceBadge } from './FieldProvenanceDrawer';
import type { FieldEvidenceGroup, FieldEvidenceRow } from './hooks/useFieldEvidence';

function claim(overrides: Partial<FieldEvidenceRow> = {}): FieldEvidenceRow {
  return { id: 'offline-claim', vehicle_id: 'offline-vehicle', field_name: 'color', field_value: 'Reported blue',
    source_type: 'bat_listing', confidence: .75, source_confidence: 75, evidence_origin: 'field_evidence',
    extraction_context: 'Retained extraction context', status: 'pending',
    extracted_at: '2026-01-01T23:30:00-08:00', created_at: '2026-01-03T04:05:06Z', ...overrides };
}
function group(row = claim()): FieldEvidenceGroup {
  return { primary: row, sources: [row], agreementCount: 1, totalSources: 1, hasConflict: false };
}
function render(row = claim()) {
  const dom = new JSDOM(renderToStaticMarkup(<FieldProvenanceDrawer fieldName="color" fieldLabel="COLOR"
    group={group(row)} isOpen onToggle={() => {}} />));
  return { doc: dom.window.document, text: dom.window.document.body.textContent || '' };
}

describe('Retained claim score and clock qualification', () => {
  it('shows the stored score without a calibrated percentage or pass/fail colors, retaining the claim and context', () => {
    const { doc, text } = render();
    expect(text).toContain('Stored score 75/100');
    expect(text).toContain('calibration');
    expect(text).toContain('independence');
    expect(text).toContain('unknown');
    expect(text).toContain('Reported blue');
    expect(text).toContain('Retained extraction context');
    expect(text).not.toContain('75%');
    expect(doc.querySelector('[data-testid="claim-score-offline-claim"]')?.getAttribute('style')).not.toMatch(/success|warning|error/);
  });
  it('names both stored clocks separately in UTC without making them original source events', () => {
    const { text, doc } = render();
    expect(text).toContain('Stored extraction: 2026-01-02 07:30:00.000 UTC');
    expect(text).toContain('Claim row created: 2026-01-03 04:05:06.000 UTC');
    expect(text).toContain('original source event time');
    expect([...doc.querySelectorAll('time')].map(t => t.dateTime)).toEqual([
      '2026-01-01T23:30:00-08:00', '2026-01-03T04:05:06Z',
    ]);
  });
  it('does not fill a missing extraction clock with row creation or an epoch', () => {
    const { text } = render(claim({ extracted_at: null }));
    expect(text).toContain('Stored extraction: unknown');
    expect(text).toContain('Claim row created: 2026-01-03 04:05:06.000 UTC');
    expect(text).not.toContain('1970');
  });
  it('keeps invalid and absent clocks unknown', () => {
    const { text, doc } = render(claim({ extracted_at: 'invalid', created_at: null as any }));
    expect(text).toContain('Stored extraction: unknown');
    expect(text).toContain('Claim row created: unknown');
    expect(doc.querySelectorAll('time')).toHaveLength(0);
    expect(text).not.toMatch(/Invalid Date|1970/);
  });
  it.each([null, undefined])('does not display absent stored confidence %s as zero', source_confidence => {
    const { text } = render(claim({ source_confidence, confidence: 0 }));
    expect(text).toContain('Stored score unknown');
    expect(text).not.toContain('0/100');
  });
  it('preserves an explicitly stored zero score', () => {
    expect(render(claim({ source_confidence: 0, confidence: 0 })).text).toContain('Stored score 0/100');
  });
  it.each(['2026-01-01', '2026-01-01T23:30:00'])('keeps the extraction clock unknown when precision or timezone is absent: %s', extracted_at => {
    expect(render(claim({ extracted_at })).text).toContain('Stored extraction: unknown');
  });
  it('does not relabel a wiki-derived score and client-created timestamp as stored native evidence', () => {
    const { text } = render(claim({ id: 'agent-color', evidence_origin: 'vehicle_wiki', source_confidence: undefined,
      source_type: 'agent_report', confidence: .75, extracted_at: null }));
    expect(text).toContain('Derived score 75/100');
    expect(text).toContain('Stored extraction: unknown');
    expect(text).toContain('Claim row created: unknown');
    expect(text).not.toContain('2026-01-03');
    expect(text).not.toContain('Stored score 75');
  });
  it('qualifies the inline source badge score too', () => {
    const dom = new JSDOM(renderToStaticMarkup(<SourceBadge group={group()} onClick={() => {}} />));
    expect(dom.window.document.querySelector('[title]')?.getAttribute('title')).toContain('Stored score 75/100; calibration unknown');
    expect(dom.window.document.body.textContent).toContain('BAT');
  });
});

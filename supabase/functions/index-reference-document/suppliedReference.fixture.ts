import { sha256 } from './suppliedReference.ts';
export async function referenceFixture() {
  const bytes = new TextEncoder().encode('%PDF-1.4\nSynthetic test reference\n%%EOF');
  const quote = '1 UPPER A100; 2 RIGHT A101; 3 LEFT A102; 4 CORNERS A103/A104';
  return {
    mode: 'supplied_reference', document: { title: 'Synthetic manufacturer reference', category: 'parts_catalog',
      source_url: 'https://manufacturer.example/reference.pdf', pdf_sha256: await sha256(bytes),
      pdf_base64: btoa(String.fromCharCode(...bytes)), page_count: 3, retrieved_day: '2026-01-01', retrieved_at: null },
    reviewed_at: '2026-01-02T12:00:00.000Z', reader: { method: 'interactive_visual_review', model: 'fixture-model', run_id: 'fixture-run' },
    pages: [{ page_number: 2, printed_label: 'Diagram 1', extracted_text: quote, has_diagrams: true }],
    assembly: { name: 'outer_moldings', category: 'trim', description: 'Outer finish molding expectation', scope: 'Five outer molding pieces only',
      application: { year_start: 1973, year_end: 1973, make: 'Fixture', model: 'Example', body_style: 'coupe', series: [] },
      positions: ['upper', 'right', 'left', 'corner.right', 'corner.left'].map((key, i) => ({ key, label: key, subject_id: null,
        quantity: 1, part_numbers: i < 3 ? [`A10${i}`] : ['A103', 'A104'], part_number_binding: i < 3 ? 'exact_position' : 'unordered_pair',
        source_refs: [{ page_number: 2, figure: 'Fixture figure', callout: String(Math.min(i + 1, 4)), excerpt: quote }] })),
      exclusions: ['Glass', 'Retainer clips', 'Seals'], limitations: ['Current installed state is not established'] },
  };
}

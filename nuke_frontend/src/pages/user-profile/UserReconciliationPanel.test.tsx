import React from 'react';
import { renderToString } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: vi.fn() } }));
import UserReconciliationPanel from './UserReconciliationPanel';
import type { PhotoSourceAnalysis } from '../../services/personalPhotoLibraryService';
const coverage = {
  records: 28000, distinct_hashed_files: 11000, without_hash: 16000,
  images_with_analysis_records: 5700, images_with_current_analysis: 5600,
  images_with_work_extractions: 1000, images_with_witnesses: 12000,
  sources: [{ source: 'image_library', records: 28000, with_analysis_records: 5700, with_work_extractions: 1000, with_witnesses: 12000 }],
  recent: { sample_size: 100, failed: 82, pending: 18, classifier_failed: 99, with_analysis_records: 0, with_work_extractions: 0, with_witnesses: 0 },
  reviewed_classifications: { items: 2200, verified: 102, agrees: 92, differs: 10 },
  analysis_records: 5800, cited_analysis_records: 60, analysis_records_missing_method: 0,
  marked_complete: 18000, marked_failed: 8000, marked_duplicates: 2200,
} as PhotoSourceAnalysis;
it('never exposes even populated owner coverage to visitors', () => {
  expect(renderToString(<UserReconciliationPanel userId="owner" isOwnProfile={false} sourceAnalysis={coverage} />)).toBe('');
});
it('shows source and output gaps before slower reconciliation resolves, without claiming accuracy', () => {
  const html = renderToString(<UserReconciliationPanel userId="owner" isOwnProfile sourceAnalysis={coverage} />).replace(/<!--.*?-->/g, '');
  expect(html).toContain('28,000 captured image records');
  expect(html).toContain('82 marked failed');
  expect(html).toContain('accuracy unknown');
  expect(html).toContain('Current device-library coverage: unknown');
  expect(html).toContain('does not measure whole-library accuracy');
});
it('reports failed coverage as unknown rather than an empty library', () => {
  const html = renderToString(<UserReconciliationPanel userId="owner" isOwnProfile sourceError="Reader failed" />);
  expect(html).toContain('Reader failed'); expect(html).toContain('Coverage is unknown');
});

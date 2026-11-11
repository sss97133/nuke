/** Image-analysis coverage over the exact inventory the existing gallery can display. */
import React, { useMemo } from 'react';
import { Section, Rows, Row, Text } from '../../kit';
import type { GalleryAnalysisRead } from '../../components/images/ImageGallery';

interface Props {
  vehicleId: string;
  viewerKey: string;
  read: GalleryAnalysisRead | null;
  onSelectImages: (imageIds: string[], label: string) => void;
  onRetry: () => void;
}

type Population = { label: string; ids: string[] };
const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;
const humanize = (value: string) => value.replace(/_/g, ' ');

export function imageAnalysisPopulations(images: GalleryAnalysisRead['images']) {
  const classified: string[] = [], detailed: string[] = [], reviewed: string[] = [], unread: string[] = [];
  const subjects = new Map<string, string[]>(), scenes = new Map<string, string[]>(), phases = new Map<string, string[]>();
  const add = (groups: Map<string, string[]>, value: unknown, id: string) => {
    const key = text(value);
    if (key) groups.set(key, [...(groups.get(key) ?? []), id]);
  };
  const seen = new Set<string>();
  for (const image of images) {
    if (seen.has(image.id)) continue;
    seen.add(image.id);
    const m = image.ai_scan_metadata ?? {};
    const subject = text(m.classification?.image_type);
    const deep = m.byok_deep_analysis;
    const hasDetail = !!(text(deep?.scene_type) || text(deep?.build_phase_guess) || text(deep?.narrative_one_line)
      || (Array.isArray(deep?.components_seen) && deep.components_seen.length)
      || m.classifier === 'claude-opus-4-7-byok' || m.classifier === 'caller-byok-cascade');
    if (subject) { classified.push(image.id); add(subjects, subject, image.id); }
    if (hasDetail) {
      detailed.push(image.id);
      if (deep?.prompt_version === 'reviewed_image_analysis_v1'
        && typeof deep.observation_id === 'string'
        && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deep.observation_id)) reviewed.push(image.id);
      // One membership per image per dimension. Legacy and nested fields are not separate photos.
      add(scenes, deep?.scene_type ?? m.scene_class, image.id);
      add(phases, deep?.build_phase_guess ?? m.phase, image.id);
    }
    if (!subject && !hasDetail) unread.push(image.id);
  }
  const groups = (map: Map<string, string[]>): Population[] => Array.from(map, ([label, ids]) => ({ label: humanize(label), ids }))
    .sort((a, b) => b.ids.length - a.ids.length || a.label.localeCompare(b.label));
  return { total: seen.size, classified, detailed, reviewed, unread, subjects: groups(subjects), scenes: groups(scenes), phases: groups(phases) };
}

const VehicleFindingsCard: React.FC<Props> = ({ vehicleId, viewerKey, read, onSelectImages, onRetry }) => {
  // Never retain the prior vehicle/viewer's counts while the next inventory is loading.
  const current = read?.vehicleId === vehicleId && read.viewerKey === viewerKey ? read : null;
  const findings = useMemo(() => imageAnalysisPopulations(current?.images ?? []), [current]);
  if (!current || current.status === 'loading') return <Text role="caption">Reading image analysis…</Text>;
  if (current.status === 'error') return <section className="k-section" aria-label="Image analysis">
    <Text role="label" as="h2">Image analysis</Text>
    <p role="alert">Image analysis could not be read.</p>
    <button type="button" className="gallery-btn" onClick={onRetry}>Retry image read</button>
  </section>;
  if (!findings.total) return null;

  const count = (ids: string[], label: string, denominator = false) => ids.length
    ? <button type="button" className="gallery-btn" aria-label={`Show ${ids.length} ${label.toLowerCase()} images`}
        onClick={() => onSelectImages(ids, label)}>{ids.length.toLocaleString('en-US')}{denominator ? ` / ${findings.total.toLocaleString('en-US')}` : ''}</button>
    : <span>{denominator ? `0 / ${findings.total.toLocaleString('en-US')}` : '0'}</span>;
  const distribution = (title: string, groups: Population[]) => groups.length > 0 && <Rows title={title}>
    {groups.map(group => <Row key={group.label} label={group.label} role="measure">{count(group.ids, `${title}: ${group.label}`)}</Row>)}
  </Rows>;

  return <Section title="Image analysis" coverage={{ n: findings.total, of: findings.total,
    grain: current.partial ? 'loaded gallery images' : 'gallery images', as_of: current.readAt }} ariaLabel="Image-analysis findings">
    {current.partial && <p role="status">Only part of the gallery has loaded. These counts cover the loaded images. <button type="button" className="gallery-btn" onClick={onRetry}>Retry image read</button></p>}
    <Rows title="Coverage">
      <Row label="Photo classification" role="measure">{count(findings.classified, 'Photo classification', true)}</Row>
      <Row label="Reviewed images" role="measure">{count(findings.reviewed, 'Reviewed', true)}</Row>
      <Row label="Detailed observations" role="measure">{count(findings.detailed, 'Detailed observations', true)}</Row>
      {findings.unread.length > 0 && <Row label="No analysis record" role="measure">{count(findings.unread, 'No analysis record', true)}</Row>}
    </Rows>
    <Text role="caption">Classification groups photos by subject. Reviewed images have a cited review in the current workflow; other detailed records may be partial. The same image can have both. Select a count to see its photos.</Text>
    {distribution('Photo subjects', findings.subjects)}
    {distribution('Detailed scenes', findings.scenes)}
    {distribution('Recorded build phases', findings.phases)}
  </Section>;
};

export default VehicleFindingsCard;

import React from 'react';
import { Section, Rows, Row, Text, codeText } from '../../kit';
import { useLaborAppraisal, type LaborAppraisal as Appraisal, type LaborPart, type LaborRange, type LaborSegment, type LaborStageStep } from './hooks/useLaborAppraisal';

/**
 * vehicle_labor_appraisal, segment by segment, as the reader returns it. Every hour figure, grade and rule is the reader's;
 * nothing is added, averaged or blended here. The reader's blended totals are never printed: a segment's hours carry their
 * own evidence grade, and the only sums shown are the reader's per-grade sums (totals.by_grade) when it sends them.
 */

const h = (n: number | null | undefined) => (n == null ? null : `${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })} h`);

/** A range in the reader's three numbers: "8 h to 16 h, typical 12 h", or one figure when the reader's min and max agree. */
export function rangeText(r: LaborRange | null | undefined): string | null {
  if (!r || r.hours_typical == null) return null;
  if (r.hours_min == null || r.hours_max == null || r.hours_min === r.hours_max) return h(r.hours_typical);
  return `${h(r.hours_min)} to ${h(r.hours_max)}, typical ${h(r.hours_typical)}`;
}

const stepText = (s: LaborStageStep) => [
  [s.from_stage, s.to_stage].filter(Boolean).map(v => codeText(String(v))).join(' to '),
  s.zone && !s.zone.includes('*') ? codeText(s.zone) : null,
  s.status ? codeText(s.status) : null,
  s.photo_phase ? `photographed as ${codeText(s.photo_phase)}` : null,
  s.images != null ? `${s.images} ${s.images === 1 ? 'photo' : 'photos'}` : null,
  s.panel_count != null ? `${s.panel_count} panels` : null,
  rangeText({ hours_min: s.hours_min ?? null, hours_typical: s.hours_typical ?? null, hours_max: s.hours_max ?? null }),
].filter(Boolean).join(' · ');

/** A part line as the reader names it: the catalog part's name, else the reader's own words. Without them it is counted. */
const partWords = (p: LaborPart) => p.part?.name || p.name || p.description || null;

/** The reassembly parts: each named part with its hours, the rest counted. Operation codes are the book's keys, not
 *  words, so they are not printed; a part the reader does not name is counted, never flagged. */
function PartsLine({ title, parts }: { title: string; parts: LaborPart[] }) {
  const named = parts.filter(p => partWords(p));
  const said = named.map(p => [partWords(p), h(p.hours)].filter(Boolean).join(', '));
  const others = parts.length - named.length;
  return <Text role="caption" as="p" className="k-item__line">
    {title}: {parts.length}{said.length ? `. ${said.join('; ')}` : ''}{said.length && others ? `; ${others} more` : ''}
  </Text>;
}

/** Pieces the reader witnessed or questioned outside witness_share: body_metal's stage pieces, reassembly parts. */
function otherPieces(segment: LaborSegment): LaborPart[] {
  return [
    ...(segment.stage_steps ?? []).flatMap(s => s.pieces ?? []),
    ...(segment.reassembly?.matched ?? []), ...(segment.reassembly?.unmatched ?? []),
  ].filter(p => p.witness);
}

const n = (v: number | null | undefined) => (v ?? 0);
const said = (count: number, words: string) => (count ? `${count} ${words}` : null);

/** The reader's witness counts for a segment, in its own numbers. A piece bought but not seen fitted is never printed
 *  as "not fitted": that is a different answer. witness_share's counts are printed as sent; pieces elsewhere are
 *  counted by the witness the reader gave each one. */
export function witnessText(segment: LaborSegment): string | null {
  const ws = segment.witness_share;
  const parts: (string | null)[] = [];
  if (ws && (ws.fitted_with_operation != null || ws.unwitnessed != null)) {
    parts.push(
      said(n(ws.fitted_with_operation), 'fitted with a book operation'),
      said(n(ws.fitted_without_operation), 'fitted without a book operation'),
      said(n(ws.not_fitted), 'not fitted'),
      ws.unwitnessed ? `${ws.unwitnessed} bought, not seen fitted` + (ws.none_raised ? ` (${ws.none_raised} with no fitted question raised)` : '') : null,
      said(n(ws.cannot_tell), 'cannot tell'),
    );
  }
  const pieces = otherPieces(segment);
  if (pieces.length) {
    const count = (f: (p: LaborPart) => boolean) => pieces.filter(f).length;
    const states = [...new Set(pieces.filter(p => p.witness === 'unwitnessed').map(p => p.question_state ?? 'not raised'))];
    parts.push(
      said(count(p => p.witness === 'fitted'), 'fitted'),
      said(count(p => p.witness === 'not_fitted'), 'not fitted'),
      ...states.map(st => said(count(p => p.witness === 'unwitnessed' && (p.question_state ?? 'not raised') === st),
        `bought; fitted question ${codeText(st)}`)),
      said(count(p => p.witness === 'cannot_tell'), 'cannot tell'),
    );
  }
  return parts.filter(Boolean).join(' · ') || null;
}

/** The segment's witnessed hours, when the reader sends them and they differ from its hours. A missing minimum is
 *  said, not filled: "minimum unknown, at most 84 h". */
export function witnessedHoursText(segment: LaborSegment): string | null {
  const { witnessed_hours_min: lo, witnessed_hours_typical: mid, witnessed_hours_max: hi } = segment;
  if (lo == null && mid == null && hi == null) return segment.witnessed_reason ? `Witnessed: ${segment.witnessed_reason}` : null;
  if (lo === segment.hours_min && mid === segment.hours_typical && hi === segment.hours_max) return null;
  const range = mid != null ? rangeText({ hours_min: lo ?? null, hours_typical: mid, hours_max: hi ?? null })
    : hi != null ? `minimum unknown, at most ${h(hi)}` : null;
  return `Witnessed: ${[segment.witnessed_reason, range].filter(Boolean).join('; ')}`;
}

/** One segment as one kit item: its name and hours on the row, then how the hours are known, line by line. */
export function SegmentRows({ segment }: { segment: LaborSegment }) {
  const r = segment.reassembly;
  const known = [
    segment.evidence_grade ? `Evidence: ${codeText(segment.evidence_grade)}` : 'Ungraded by the reader',
    segment.counts_in === 'unwitnessed_purchase' ? 'counted with purchases not seen fitted' : null,
    segment.hours_basis ? `hours from ${codeText(segment.hours_basis)}` : null,
    segment.paper_hours != null ? `${h(segment.paper_hours)} on shop paper` : null,
    segment.book_hours ? `book range ${rangeText(segment.book_hours)}` : null,
    segment.hours_counted_elsewhere != null ? `${h(segment.hours_counted_elsewhere)} counted in other segments` : null,
    segment.evidence_count != null ? `${segment.evidence_count} evidence rows` : null,
  ].filter(Boolean).join(' · ');
  const witnessed = witnessText(segment);
  const witnessedHours = witnessedHoursText(segment);
  return <div className="k-item" data-key={segment.segment} data-status={segment.evidence_grade ?? 'ungraded'} title={segment.citation ?? undefined}>
    <div className="k-row">
      <Text role="label">{codeText(segment.segment)}</Text>
      <Text role="measure">{rangeText(segment) ?? 'No hours'}</Text>
    </div>
    <Text role="caption" as="p" className="k-item__line">{known}</Text>
    {witnessedHours && <Text role="caption" as="p" className="k-item__line">{witnessedHours}</Text>}
    {witnessed && <Text role="caption" as="p" className="k-item__line">Pieces: {witnessed}</Text>}
    {segment.range_below_paper && <Text role="caption" as="p" className="k-item__line">The book range is below the hours on shop paper; the paper hours are used.</Text>}
    {!!segment.stage_steps?.length && <Text role="caption" as="p" className="k-item__line">Stages: {segment.stage_steps.map(stepText).join('; ')}</Text>}
    {!!r?.matched?.length && <PartsLine title="Fitted parts with a book operation" parts={r.matched} />}
    {!!r?.unmatched?.length && <PartsLine title="Fitted parts without a book operation" parts={r.unmatched} />}
  </div>;
}

export function LaborAppraisalView({ appraisal }: { appraisal: Appraisal }) {
  // A segment the reader gives no hours is not printed (no empty rows); the coverage line still counts every segment it returned.
  const priced = appraisal.segments.filter(s => s.hours_typical != null);
  const coverage = { n: priced.length, of: appraisal.segments.length, grain: 'segments with hours', as_of: appraisal.as_of };
  // The reader says "nothing priced" with priced_segments = 0: that is an answer, printed as one.
  if (appraisal.applicable && appraisal.totals?.priced_segments === 0 && appraisal.segments.length) {
    return <Section title="Labor appraisal by segment" coverage={coverage}>
      <Text role="caption" as="p">Not appraised: the reader has no segment with hours for this car yet.</Text>
      {appraisal.logic_version && <Text role="caption" as="p" className="vp-reader-version">Reader: vehicle_labor_appraisal · {appraisal.logic_version}</Text>}
    </Section>;
  }
  if (!appraisal.applicable || !priced.length) return null;
  const byGrade = appraisal.totals?.by_grade ? Object.entries(appraisal.totals.by_grade) : [];
  const witnessedTotal = rangeText(appraisal.totals?.witnessed);
  const withPurchases = rangeText(appraisal.totals?.with_unwitnessed_purchases);
  return <Section title="Labor appraisal by segment" coverage={coverage}>
    <Text role="caption" as="p">Each segment carries its own hours and how they are witnessed. Segments are not added into one figure.</Text>
    {witnessedTotal && withPurchases && <div title={appraisal.totals?.rule ?? undefined}><Rows title="Hours, two totals side by side">
      <Row label="Witnessed" role="measure">{witnessedTotal}{appraisal.totals?.witnessed?.unknown_min_segments
        ? ` (${appraisal.totals.witnessed.unknown_min_segments} segments with no witnessed minimum)` : ''}</Row>
      <Row label="With purchases not seen fitted" role="measure">{withPurchases}</Row>
    </Rows></div>}
    {byGrade.length > 0 && <Rows title="Hours by evidence grade">
      {byGrade.map(([grade, range]) => <Row key={grade} label={codeText(grade)} role="measure">{rangeText(range) ?? 'No hours'}</Row>)}
    </Rows>}
    <div className="k-items">{priced.map(s => <SegmentRows key={s.segment} segment={s} />)}</div>
    {appraisal.logic_version && <Text role="caption" as="p" className="vp-reader-version">Reader: vehicle_labor_appraisal · {appraisal.logic_version}</Text>}
  </Section>;
}

/** The profile's labor appraisal. Renders nothing until the reader answers, and nothing when it has no segments. */
export function LaborAppraisal({ vehicleId }: { vehicleId: string }) {
  const read = useLaborAppraisal(vehicleId);
  if (read.isLoading) return <p role="status" className="vp-labor-status" data-reading="labor">Reading the labor appraisal…</p>;
  if (read.isError) return <p role="status" className="vp-labor-status">The labor appraisal could not load. <button type="button" onClick={() => void read.refetch()}>Retry</button></p>;
  if (!read.data) return null;
  return <div id="labor-appraisal" className="vp-labor"><LaborAppraisalView appraisal={read.data} /></div>;
}

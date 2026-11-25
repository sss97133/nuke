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
  s.zone && s.zone !== '*' ? codeText(s.zone) : null,
  s.status ? codeText(s.status) : null,
  s.photo_phase ? `photographed as ${codeText(s.photo_phase)}` : null,
  s.images != null ? `${s.images} ${s.images === 1 ? 'photo' : 'photos'}` : null,
  s.panel_count != null ? `${s.panel_count} panels` : null,
  rangeText({ hours_min: s.hours_min ?? null, hours_typical: s.hours_typical ?? null, hours_max: s.hours_max ?? null }),
].filter(Boolean).join(' · ');

/** A part line as the reader names it; the reader's words only. Without them the part is counted, not named. */
const partWords = (p: LaborPart) => p.name || p.description || null;

/** The reassembly parts: named in the reader's words, the rest counted. */
function PartsLine({ title, parts }: { title: string; parts: LaborPart[] }) {
  const named = parts.filter(p => partWords(p));
  const said = parts.filter(p => partWords(p) || p.operation_code).map(p => [partWords(p), p.operation_code, h(p.hours), p.reason].filter(Boolean).join(' '));
  const unnamed = parts.length - named.length;
  return <Text role="caption" as="p" className="k-item__line">
    {title}: {parts.length}{said.length ? `. ${said.join('; ')}` : ''}{unnamed ? ` (${unnamed} of ${parts.length} not named by the reader)` : ''}
  </Text>;
}

/** One segment as one kit item: its name and hours on the row, then how the hours are known, line by line. */
export function SegmentRows({ segment }: { segment: LaborSegment }) {
  const r = segment.reassembly;
  const known = [
    segment.evidence_grade ? `Evidence: ${codeText(segment.evidence_grade)}` : 'Ungraded by the reader',
    segment.hours_basis ? `hours from ${codeText(segment.hours_basis)}` : null,
    segment.paper_hours != null ? `${h(segment.paper_hours)} on shop paper` : null,
    segment.book_hours ? `book range ${rangeText(segment.book_hours)}` : null,
    segment.hours_counted_elsewhere != null ? `${h(segment.hours_counted_elsewhere)} counted in other segments` : null,
    segment.evidence_count != null ? `${segment.evidence_count} evidence rows` : null,
  ].filter(Boolean).join(' · ');
  return <div className="k-item" data-key={segment.segment} data-status={segment.evidence_grade ?? 'ungraded'}>
    <div className="k-row">
      <Text role="label">{codeText(segment.segment)}</Text>
      <Text role="measure">{rangeText(segment) ?? 'No hours'}</Text>
    </div>
    <Text role="caption" as="p" className="k-item__line">{known}</Text>
    {segment.range_below_paper && <Text role="caption" as="p" className="k-item__line">The book range is below the hours on shop paper; the paper hours are used.</Text>}
    {!!segment.stage_steps?.length && <Text role="caption" as="p" className="k-item__line">Stages: {segment.stage_steps.map(stepText).join('; ')}</Text>}
    {!!r?.matched?.length && <PartsLine title="Fitted parts with a book operation" parts={r.matched} />}
    {!!r?.unmatched?.length && <PartsLine title="Fitted parts without a book operation" parts={r.unmatched} />}
    {segment.citation && <Text role="caption" as="p" className="k-item__line">Rule: {segment.citation}</Text>}
  </div>;
}

export function LaborAppraisalView({ appraisal }: { appraisal: Appraisal }) {
  // A segment the reader gives no hours is not printed (no empty rows); the coverage line still counts every segment it returned.
  const priced = appraisal.segments.filter(s => s.hours_typical != null);
  if (!appraisal.applicable || !priced.length) return null;
  const byGrade = appraisal.totals?.by_grade ? Object.entries(appraisal.totals.by_grade) : [];
  return <Section title="Labor appraisal by segment" coverage={{ n: priced.length, of: appraisal.segments.length, grain: 'segments with hours', as_of: appraisal.as_of }}>
    <Text role="caption" as="p">Each segment carries its own hours and how they are witnessed. Segments are not added into one figure.</Text>
    {byGrade.length > 0 && <Rows title="Hours by evidence grade">
      {byGrade.map(([grade, range]) => <Row key={grade} label={codeText(grade)} role="measure">{rangeText(range) ?? 'No hours'}</Row>)}
    </Rows>}
    <div className="k-items">{priced.map(s => <SegmentRows key={s.segment} segment={s} />)}</div>
    {appraisal.logic_version && <Text role="caption" as="p">Reader: vehicle_labor_appraisal · {appraisal.logic_version}</Text>}
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

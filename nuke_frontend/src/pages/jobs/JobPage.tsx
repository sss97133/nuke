import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { PrefetchLink } from '../../components/PrefetchLink';
import { usePageTitle } from '../../hooks/usePageTitle';
import { Masthead, Row, Rows, Section, Text, type Coverage } from '../../kit';
import { JobStageRail, JobStageRailLegend } from './JobStageRail';
import { SignActions } from './SignAction';
import {
  acceptanceText, arr, day, gapText, conflictText, lineLabel, linePrice, money, num, obj, parseLine, parseStages, parseViewer,
  paymentsVisible, personHref, personLabel, plainValue, releaseCondition, RUNG_WORD, sentence, slotWord, stageFacts,
  stageRung, STAGES, stateLine, str, strings, vehicleText, viewingAs,
  type JobAction, type JsonObject, type Stage, type Viewer,
} from './jobRead';
import { readJob, type Load } from './readJob';
import './job-page.css';
const BestMatches = React.lazy(() => import('./BestMatches'));

const READERS = {
  operations: { rpc: 'work_order_operations_read', title: 'Operations' },
  resources: { rpc: 'work_order_resources_read', title: 'Resources and requirements' },
  offers: { rpc: 'work_order_offers_read', title: 'Offers' },
  quotes: { rpc: 'work_order_quotes_read', title: 'Quote' },
  bookings: { rpc: 'work_order_facility_reservations_read', title: 'Shop bookings' },
  inspection: { rpc: 'work_order_inspection_read', title: 'Inspection' },
  evidence: { rpc: 'work_order_evidence_read', title: 'Evidence' },
  invoices: { rpc: 'work_order_invoices_read', title: 'Invoice and payment' },
} as const;
type ReaderKey = keyof typeof READERS;
const READER_KEYS = Object.keys(READERS) as ReaderKey[];

const loaded = (l: Load | undefined): JsonObject | null => (l?.status === 'loaded' ? l.data : null);
const cov = (n: number, of: number, grain: string, asOf: unknown): Coverage => ({ n, of: Math.max(of, n), grain, as_of: str(asOf) });

function Person({ p }: { p: unknown }) {
  const href = personHref(p);
  const label = personLabel(p);
  return href ? <PrefetchLink className="job-link" to={href}>{label}</PrefetchLink> : <>{label}</>;
}

function List({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return <ul className="job-list">{items.map(s => <li key={s}><Text role="body">{s}</Text></li>)}</ul>;
}

// MARK: - Stages

function StageBlock({ stage }: { stage: Stage }) {
  const meta = STAGES.find(s => s.key === stage.key)!;
  const rung = stageRung(stage.state, stage.inconsistencies.length > 0);
  const facts = stageFacts(stage);
  return <div className={`job-stage job-stage--${rung ?? stage.state ?? 'missing'}`} role="group" aria-label={meta.title}>
    <div className="job-stage__head">
      <Text role="label" as="h3">{meta.title}</Text>
      <Text role="body">{stateLine(stage.state)}</Text>
      {rung && <Text role="caption">{RUNG_WORD[rung]}</Text>}
    </div>
    {stage.gaps.length > 0 && <div className="job-stage__gaps">
      <Text role="label">What's missing</Text>
      <List items={stage.gaps.map(gapText)} />
    </div>}
    {stage.inconsistencies.length > 0 && <div className="job-stage__conflicts">
      <Text role="label">Records disagree</Text>
      <List items={stage.inconsistencies.map(conflictText)} />
    </div>}
    {facts.length > 0 && <details className="job-details">
      <summary><Text role="caption">What's on record ({facts.length})</Text></summary>
      <Rows title={`${meta.title}: on record`}>
        {facts.map(f => <Row key={f.key} label={f.label}>{f.value}</Row>)}
      </Rows>
    </details>}
  </div>;
}

// MARK: - Sections, one per reader. Each renders nothing when its reader has nothing to say.

function OperationsSection({ d }: { d: JsonObject }) {
  const ops = arr(d.operations).map(obj).filter((o): o is JsonObject => !!o);
  const parts = arr(d.parts).map(obj).filter((o): o is JsonObject => !!o);
  const labor = arr(d.labor).map(obj).filter((o): o is JsonObject => !!o);
  if (!ops.length && !parts.length && !labor.length) return null;
  const c = obj(d.coverage);
  return <Section title="Operations" coverage={cov(ops.length, num(c?.operations) ?? ops.length, 'operations', d.as_of)}>
    <Text role="caption" as="p">Prices are open: recorded line prices, not payments.</Text>
    <Rows title="Operations" count={ops.length}>
      {ops.map((o, i) => {
        const specs = arr(o.specifications).map(obj).filter((s): s is JsonObject => !!s)
          .map(s => [str(s.material_key), str(s.process_key)].filter(Boolean).join(' · ') + (str(s.specification_stage) ? ` (${sentence(str(s.specification_stage)!).toLowerCase()})` : ''));
        return <Row key={str(o.id) ?? i} label={`${num(o.line_number) ?? i + 1}. ${sentence(str(o.task_type) ?? 'operation')}`}>
          {str(o.description) ?? 'No description'}{str(o.status) ? ` · ${sentence(str(o.status)!).toLowerCase()}` : ''}{specs.length ? ` · ${specs.join('; ')}` : ''}
        </Row>;
      })}
    </Rows>
    <Rows title="Parts" count={parts.length}>
      {parts.map((p, i) => <Row key={str(p.id) ?? i} label={[str(p.part_name) ?? 'Part', str(p.brand)].filter(Boolean).join(' · ')} role="measure">
        {[num(p.quantity) !== null && num(p.unit_price) !== null ? `${num(p.quantity)} × ${money(num(p.unit_price), 'USD')}` : null,
          p.is_comped === true ? 'comped' : num(p.total_price) !== null ? `${money(num(p.total_price), 'USD')} total` : null].filter(Boolean).join(' · ') || 'Not priced'}
      </Row>)}
    </Rows>
    <Rows title="Labor" count={labor.length}>
      {labor.map((l, i) => {
        const hours = num(l.hours), rate = num(l.hourly_rate);
        return <Row key={str(l.id) ?? i} label={str(l.task_name) ?? 'Labor'} role="measure">
          {[hours !== null ? `${hours} h` : null, rate !== null ? `${money(rate, 'USD')}/h` : null,
            l.is_comped === true ? 'comped' : num(l.total_cost) !== null ? money(num(l.total_cost), 'USD') : null].filter(Boolean).join(' · ') || 'Not priced'}
        </Row>;
      })}
    </Rows>
  </Section>;
}

function ResourcesSection({ d }: { d: JsonObject }) {
  const reqs = arr(d.requirements).map(obj).filter((o): o is JsonObject => !!o);
  const specs = arr(d.specifications).map(obj).filter((o): o is JsonObject => !!o);
  const comparisons = arr(d.specification_comparisons).map(obj).filter((o): o is JsonObject => !!o);
  if (!reqs.length && !specs.length) return null;
  const c = obj(d.coverage);
  const differ = comparisons.filter(x => x.material_relation === 'different' || x.process_relation === 'different');
  return <Section title="Resources and requirements" coverage={cov(num(c?.requirements_with_candidates) ?? 0, num(c?.recorded_requirements) ?? reqs.length, 'requirements with a candidate', d.as_of)}>
    <Rows title="Requirements" count={reqs.length}>
      {reqs.map((r, i) => <Row key={str(r.id) ?? i} label={sentence(str(r.requirement_kind) ?? 'requirement')}>
        {str(r.description) ?? 'No description'}{num(r.confidence_score) !== null ? ` · read with ${Math.round(num(r.confidence_score)! * 100)}% confidence` : ''}
      </Row>)}
    </Rows>
    <Rows title="Specifications" count={specs.length}>
      {specs.map((s, i) => <Row key={str(s.id) ?? i} label={sentence(str(s.specification_stage) ?? 'specification')}>
        {[str(s.material_label) ?? str(s.material_key), str(s.process_label) ?? str(s.process_key)].filter(Boolean).join(' · ') || 'Not stated'}
      </Row>)}
    </Rows>
    {differ.length > 0 && <div className="job-stage__conflicts">
      <Text role="label">Records disagree</Text>
      <Text role="body" as="p">{differ.length === 1 ? 'One requested specification differs' : `${differ.length} requested specifications differ`} from what was reported performed.</Text>
    </div>}
    <Text role="caption" as="p">Requirement list complete: {plainValue(c?.requirement_population)} · specification list complete: {plainValue(c?.specification_population)}</Text>
  </Section>;
}

function OffersSection({ d, onSigned }: { d: JsonObject; onSigned: () => void }) {
  const viewer = parseViewer(d.viewer);
  const reqs = arr(d.requirements).map(obj).filter((o): o is JsonObject => !!o);
  const accepted = arr(d.accepted_providers).map(obj).filter((o): o is JsonObject => !!o);
  const actions = viewer?.actions ?? [];
  if (!reqs.length && !accepted.length && !actions.length) return null;
  const withOffers = reqs.filter(r => arr(r.offers).length > 0).length;
  const forOffer = (id: string | null) => actions.filter(a => id && str(a.args.p_offer_id) === id);
  const general = actions.filter(a => !str(a.args.p_offer_id));
  return <Section title="Offers" coverage={cov(withOffers, reqs.length, 'requirements with offers', d.as_of)}>
    {accepted.length > 0 && <Rows title="Accepted providers" count={accepted.length}>
      {accepted.map((a, i) => <Row key={i} label={slotWord(str(a.role) ?? 'performer')}>
        <Person p={a.provider ?? a.performer} />{day(str(a.accepted_at)) ? ` · accepted ${day(str(a.accepted_at))}` : ''}
      </Row>)}
    </Rows>}
    {reqs.map((r, ri) => {
      const offers = arr(r.offers).map(obj).filter((o): o is JsonObject => !!o);
      return <div key={str(r.requirement_id) ?? ri} className="job-block">
        <Text role="label" as="h3">{sentence(str(r.requirement_kind) ?? 'requirement')}: {str(r.description) ?? 'no description'}</Text>
        {offers.length === 0 && <Text role="caption" as="p">No offers yet.</Text>}
        {offers.map((o, oi) => {
          const terms = arr(obj(o.terms)?.lines).map(parseLine);
          const acc = obj(o.acceptance);
          const who = o.offer_kind === 'organization' ? o.facility ?? o.provider : o.provider;
          const window = [day(str(o.available_from)), day(str(o.available_until))].filter(Boolean).join(' – ');
          const cosigns = arr(o.co_signs).map(obj).filter((x): x is JsonObject => !!x);
          return <div key={str(o.offer_id) ?? oi} className="job-offer">
            <Rows title="Offer">
              <Row label="From"><Person p={who} /></Row>
              <Row label="Technician profile">{offerRung(str(o.offer_rung))}</Row>
              {terms.map((l, li) => <Row key={li} label={lineLabel(l)} role="measure">{linePrice(l)}</Row>)}
              {window && <Row label="Available">{window}</Row>}
              <Row label="Acceptance">{acc?.state === 'accepted' ? `Accepted by the customer${day(str(acc.accepted_at)) ? ` · ${day(str(acc.accepted_at))}` : ''}` : acc?.state === 'withheld' ? 'Acceptance on hold' : 'Not accepted yet'}</Row>
              {cosigns.map((c, ci) => <Row key={ci} label="Co-signed by"><Person p={c.co_signer} />{strings(c.kinds).length ? `: ${strings(c.kinds).map(k => sentence(k).toLowerCase()).join(', ')}` : ''}</Row>)}
            </Rows>
            <SignActions actions={forOffer(str(o.offer_id))} onSigned={onSigned} />
          </div>;
        })}
      </div>;
    })}
    <SignActions actions={general} onSigned={onSigned} />
  </Section>;
}

function offerRung(r: string | null): string {
  switch (r) {
    case 'work_evidence': return 'Backed by their work';
    case 'co_sign': return 'Vouched for by someone they worked with';
    case 'authenticated_sign': return 'Signed';
    case 'organization_owner': return 'Shop owner';
    case null: case 'self_claim': case 'unknown': return 'Linked by them — not yet backed by work';
    default: return sentence(r);
  }
}

function QuoteSection({ d, onSigned }: { d: JsonObject; onSigned: () => void }) {
  const viewer = parseViewer(d.viewer);
  const q = obj(d.current_quote);
  const history = arr(d.history).map(obj).filter((o): o is JsonObject => !!o);
  const actions: JobAction[] = [...(viewer?.actions ?? []), ...(viewer?.issuerActions ?? [])];
  if (!q && !history.length && !actions.length) return null;
  const c = obj(d.coverage);
  const release = obj(d.release_conditions);
  const lines = arr(q?.lines).map(parseLine);
  const totals = arr(q?.totals_by_currency).map(obj).filter((o): o is JsonObject => !!o);
  const deposit = obj(q?.deposit_requested);
  const change = obj(q?.change_order) ?? (q?.is_change_order === true ? {} : null);
  const conditions = arr(q?.release_conditions).map(releaseCondition).filter((s): s is string => !!s);
  const version = num(q?.version) ?? 1;
  return <Section title={change ? 'Quote · change order' : 'Quote'} coverage={cov(num(c?.versions_with_current_source) ?? 0, num(c?.quote_versions) ?? history.length, 'quote versions current', d.as_of)}>
    {q && <Rows title={`Version ${version}${version > 1 ? ` · revised ${version - 1 === 1 ? 'once' : `${version - 1} times`}` : ''}`}>
      <Row label="Quoted by"><Person p={q.quoting_party} /></Row>
      {str(q.valid_until) && <Row label="Valid until">{day(str(q.valid_until))}{q.expired === true ? ' · expired' : ''}</Row>}
      {lines.map((l, i) => <Row key={i} label={lineLabel(l)} role="measure">{linePrice(l)}</Row>)}
      {totals.map((t, i) => <Row key={`t${i}`} label={t.complete === true ? 'Total' : 'Total, at least'} role="measure">{money(num(t.total), str(t.currency))}</Row>)}
      {deposit && <Row label="Deposit requested" role="measure">{money(num(deposit.amount), str(deposit.currency))} · a term, not a payment</Row>}
      <Row label="Acceptance">{acceptanceText(obj(d.acceptance))}</Row>
    </Rows>}
    {change && <Rows title="Change order">
      {str(change.reason) && <Row label="Reason">{str(change.reason)}</Row>}
      {arr(change.changes).map(obj).filter((o): o is JsonObject => !!o).map((ch, i) => {
        const from = obj(ch.from_line) ? parseLine(ch.from_line) : null;
        const to = obj(ch.to_line) ? parseLine(ch.to_line) : null;
        const spec = obj(ch.specification);
        return <Row key={i} label={sentence(str(ch.action) ?? 'modify')}>
          {[from ? `${lineLabel(from)} (${linePrice(from)})` : null, to ? `${lineLabel(to)} (${linePrice(to)})` : null].filter(Boolean).join(' → ')}
          {spec ? ` · ${str(spec.from_label) ?? str(spec.from_key) ?? '?'} → ${str(spec.to_label) ?? str(spec.to_key) ?? '?'}` : ''}
        </Row>;
      })}
    </Rows>}
    {q && <div className="job-block">
      <Text role="label">Payment release</Text>
      <Text role="body" as="p">{conditions.length ? `Payment is released when: ${conditions.join('; ')}.` : 'This quote sets no release conditions.'}</Text>
      <Text role="caption" as="p">{release?.declared_by === 'accepted_quote' ? "These are the accepted quote's conditions." : "Until a quote with conditions is accepted, Nuke's standard conditions apply."} Nuke records when these are met; it doesn't hold or move the money.</Text>
    </div>}
    {history.length > 1 && <Rows title="Versions" count={history.length}>
      {history.map((h, i) => <Row key={i} label={`Version ${num(h.version) ?? '?'}`}>{[str(h.state) ? sentence(str(h.state)!) : null, day(str(h.observed_at))].filter(Boolean).join(' · ')}</Row>)}
    </Rows>}
    <SignActions actions={actions} onSigned={onSigned} />
  </Section>;
}

function BookingsSection({ d, onSigned }: { d: JsonObject; onSigned: () => void }) {
  const items = arr(d.reservations).map(obj).filter((o): o is JsonObject => !!o);
  const actions = parseViewer(d.viewer)?.actions ?? [];
  if (!items.length) return null;
  return <Section title="Shop bookings" coverage={cov(items.length, items.length, 'bookings visible to you', d.as_of)}>
    <Rows title="Bookings" count={items.length}>
      {items.map((r, i) => {
        const asset = obj(r.asset), w = obj(r.window);
        return <Row key={i} label={[str(asset?.label), str(asset?.kind) ? sentence(str(asset?.kind)!).toLowerCase() : null].filter(Boolean).join(' · ') || 'Shop space'}>
          {[personLabel(r.shop), [day(str(w?.from)), day(str(w?.until))].filter(Boolean).join(' – '), str(r.state) ? sentence(str(r.state)!).toLowerCase() : null].filter(Boolean).join(' · ')}
        </Row>;
      })}
    </Rows>
    <Text role="caption" as="p">{str(obj(d.coverage)?.visibility) ?? ''}</Text>
    <SignActions actions={actions} onSigned={onSigned} />
  </Section>;
}

function InspectionSection({ d, onSigned }: { d: JsonObject; onSigned: () => void }) {
  const inspections = arr(d.inspections).map(obj).filter((o): o is JsonObject => !!o);
  const actions = parseViewer(d.viewer)?.actions ?? [];
  if (!inspections.length) return null;
  const withFindings = inspections.filter(i => obj(i.current_report)).length;
  return <Section title="Inspection" coverage={cov(withFindings, inspections.length, 'inspections with findings', d.as_of)}>
    {inspections.map((ins, i) => {
      const report = obj(ins.current_report);
      const findings = arr(obj(report?.inspection)?.findings).map(obj).filter((o): o is JsonObject => !!o);
      const checklist = arr(ins.checklist).map(obj).filter((o): o is JsonObject => !!o);
      const permission = obj(ins.seller_permission);
      return <div key={i} className="job-block">
        <Rows title={sentence(str(ins.inspection_type) ?? 'inspection')}>
          <Row label="Requested">{[day(str(ins.requested_at)), personLabel(ins.requested_by)].filter(Boolean).join(' · ')}</Row>
          {str(ins.state) && <Row label="State">{sentence(str(ins.state)!)}</Row>}
          {permission && <Row label="Seller permission">{plainValue(permission.state)}</Row>}
          {report && <Row label="Findings recorded">{[day(str(report.recorded_at)), personLabel(report.recorded_by)].filter(Boolean).join(' · ')}</Row>}
          {str(obj(report?.inspection)?.summary) && <Row label="Summary">{str(obj(report?.inspection)?.summary)}</Row>}
        </Rows>
        <Rows title="Checklist" count={checklist.length}>
          {checklist.map((item, ci) => {
            const mine = findings.filter(f => f.item_id === item.item_id);
            return <Row key={ci} label={str(item.question) ?? str(item.system) ?? 'Item'}>
              {mine.length ? mine.map(f => [str(f.verdict) ? sentence(str(f.verdict)!) : null, str(f.finding), str(f.severity)].filter(Boolean).join(' · ')).join('; ') : 'No finding yet'}
            </Row>;
          })}
        </Rows>
        <Rows title="Other findings">
          {findings.filter(f => !f.item_id).map((f, fi) => <Row key={fi} label={str(f.system) ?? 'Finding'}>{[str(f.finding), str(f.severity)].filter(Boolean).join(' · ')}</Row>)}
        </Rows>
      </div>;
    })}
    <SignActions actions={actions} onSigned={onSigned} />
  </Section>;
}

function EvidenceSection({ d, onSigned }: { d: JsonObject; onSigned: () => void }) {
  const viewer = parseViewer(d.viewer);
  const items = arr(d.attachments).map(obj).filter((o): o is JsonObject => !!o);
  if (!items.length) return null;
  return <Section title="Evidence" coverage={cov(items.length, items.length, 'evidence attachments', d.as_of)}>
    {items.map((a, i) => {
      const images = arr(a.images).map(obj).filter((o): o is JsonObject => !!o && !!str(o.image_url));
      const withheld = num(a.images_withheld) ?? 0;
      const op = obj(a.operation);
      return <div key={str(a.attachment_id) ?? i} className="job-block">
        <Rows title={`Attached ${day(str(a.attached_at)) ?? ''}`}>
          <Row label="By"><Person p={a.attached_by} />{str(obj(a.attached_by)?.role) ? ` · ${slotWord(str(obj(a.attached_by)?.role)!)}` : ''}{a.attribution === 'authenticated_sign' ? ' · signed through Nuke' : ''}</Row>
          {op && <Row label="Operation">{`${num(op.line_number) ?? ''}. ${str(op.task_description) ?? ''}`}</Row>}
          {viewer?.party && str(a.note) && <Row label="Note (parties only)">{str(a.note)}</Row>}
          {withheld > 0 && <Row label="Photos not shown to you" role="measure">{withheld}</Row>}
        </Rows>
        {images.length > 0 && <div className="job-images">
          {images.map((img, ii) => <img key={str(img.image_id) ?? ii} className="job-images__img" src={str(img.image_url)!} width={160} height={120} loading="lazy"
            alt={`Job evidence photo${day(str(img.captured_at)) ? `, ${day(str(img.captured_at))}` : ''}`} />)}
        </div>}
      </div>;
    })}
    <SignActions actions={viewer?.actions ?? []} onSigned={onSigned} />
  </Section>;
}

function InvoicesSection({ d, onSigned }: { d: JsonObject; onSigned: () => void }) {
  const viewer = parseViewer(d.viewer);
  const invoices = arr(d.invoices).map(obj).filter((o): o is JsonObject => !!o);
  if (!invoices.length) return null;
  const showPayments = paymentsVisible(viewer, d.payments);
  const payments = showPayments ? arr(d.payments).map(obj).filter((o): o is JsonObject => !!o) : [];
  const rec = showPayments ? obj(d.reconciliation) : null;
  const release = showPayments ? obj(d.release) : null;
  const current = str(d.current_invoice_id);
  return <Section title="Invoice and payment" coverage={cov(invoices.filter(i => i.current === true || str(i.invoice_id) === current).length, invoices.length, 'invoice versions current', d.as_of)}>
    {invoices.map((inv, i) => {
      const cur = inv.current === true || str(inv.invoice_id) === current;
      const currency = str(inv.currency) ?? 'USD';
      const lines = arr(inv.lines).map(obj).filter((o): o is JsonObject => !!o);
      const changes = obj(inv.changes_from_quote);
      return <Rows key={str(inv.invoice_id) ?? i} title={`Invoice version ${num(inv.version) ?? 1}${cur ? ' · current' : ' · superseded'}`}>
        <Row label="Issued">{[day(str(inv.issued_at)), personLabel(inv.issuer)].filter(Boolean).join(' · ')}</Row>
        {str(inv.due_at) && <Row label="Due">{day(str(inv.due_at))}</Row>}
        {lines.map((l, li) => <Row key={li} label={str(l.description) ?? `Line ${num(l.line) ?? li + 1}`} role="measure">
          {money(num(l.line_total) ?? num(l.amount), str(l.currency) ?? currency)}{str(l.change) ? ` · ${sentence(str(l.change)!).toLowerCase()}` : ''}
        </Row>)}
        <Row label="Total" role="measure">{money(num(inv.total), currency)}</Row>
        {changes && num(changes.delta_from_quote) !== null && <Row label="Difference from the quote" role="measure">{money(num(changes.delta_from_quote), currency)}</Row>}
      </Rows>;
    })}
    {showPayments ? <>
      <Rows title="Payments (shown to the people on this job)" count={payments.length}>
        {payments.map((p, i) => <Row key={i} label={str(p.witness_side) === 'payee' ? 'Confirmed received' : 'Reported paid'} role="measure">
          {[money(num(p.amount), str(p.currency)), day(str(p.paid_at)), str(p.method) ? sentence(str(p.method)!).toLowerCase() : null].filter(Boolean).join(' · ')}
        </Row>)}
      </Rows>
      {rec && <Rows title="Reconciliation">
        <Row label="State">{sentence(str(rec.state) ?? 'not established')}</Row>
        {num(rec.balance_due) !== null && <Row label="Balance due" role="measure">{money(num(rec.balance_due), str(rec.currency))}</Row>}
      </Rows>}
      {release && <Rows title="Payment release">
        <Row label="Conditions met">{release.met === true ? 'Yes' : 'Not yet'}</Row>
      </Rows>}
    </> : <Text role="caption" as="p">Payments and balances are shown to the people on this job.</Text>}
    <Text role="caption" as="p">No money moves through these records; payment witnesses are statements by the payer and payee.</Text>
    <SignActions actions={viewer?.actions ?? []} onSigned={onSigned} />
  </Section>;
}

// MARK: - Page

export default function JobPage() {
  const { workOrderId = '' } = useParams<{ workOrderId: string }>();
  const [path, setPath] = useState<Load>({ status: 'loading' });
  const [reads, setReads] = useState<Partial<Record<ReaderKey, Load>>>({});
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce(n => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setPath({ status: 'loading' });
    setReads({});
    const args = { p_work_order_id: workOrderId };
    readJob('work_order_job_path_read', args).then(l => { if (!cancelled) setPath(l); });
    for (const key of READER_KEYS) {
      readJob(READERS[key].rpc, args).then(l => { if (!cancelled) setReads(r => ({ ...r, [key]: l })); });
    }
    return () => { cancelled = true; };
  }, [workOrderId, nonce]);

  const p = loaded(path);
  const title = str(p?.display_title) ?? vehicleText(p?.vehicle_label) ?? 'Job';
  usePageTitle(title);

  if (path.status === 'loading') {
    return <article className="job-page" aria-busy="true" aria-label="Job"><Masthead><Text role="entity" as="h1">Loading the job…</Text></Masthead></article>;
  }
  if (path.status === 'failed') {
    return <article className="job-page" aria-label="Job unavailable">
      <Masthead><Text role="entity" as="h1">Job unavailable</Text></Masthead>
      <section className="k-section job-block">
        <Text role="body" as="p">{path.reason}</Text>
        <button type="button" className="job-button" onClick={reload}><Text role="label">Try again</Text></button>
      </section>
    </article>;
  }

  const data = path.data;
  const viewer: Viewer | null = parseViewer(data.viewer);
  const stages = parseStages(data);
  const recorded = stages.filter(s => s.state === 'recorded').length;
  const vehicle = vehicleText(data.vehicle_label);
  const vehicleId = str(data.vehicle_id);
  const failures = READER_KEYS.filter(k => reads[k]?.status === 'failed');
  const pending = READER_KEYS.filter(k => !reads[k] || reads[k]?.status === 'loading');
  const r = (k: ReaderKey) => loaded(reads[k]);

  return <article className="job-page" aria-label={title}>
    <Masthead result={<Text role="caption">{str(data.request_source_label) ?? ''}</Text>}>
      <div className="job-masthead">
        <Text role="entity" as="h1">{title}</Text>
        {vehicle && (vehicleId
          ? <PrefetchLink className="job-link" to={`/vehicle/${vehicleId}`}><Text role="body">{vehicle}</Text></PrefetchLink>
          : <Text role="body">{vehicle}</Text>)}
      </div>
    </Masthead>

    <Section title="Job path" coverage={cov(recorded, STAGES.length, 'stages recorded', data.as_of)}>
      <JobStageRail states={Object.fromEntries(stages.map(s => [s.key, s.state]))}
        conflicts={Object.fromEntries(stages.map(s => [s.key, s.inconsistencies.length > 0]))} />
      <Text role="caption" as="p">Viewing as {viewingAs(viewer)}. Stages show what's on record, not yet verified; "proven" is kept for signatures made through Nuke.</Text>
      <JobStageRailLegend />
      {viewer && viewer.actions.length > 0 && <SignActions actions={viewer.actions} onSigned={reload} />}
    </Section>

    <Section title="Stages" coverage={cov(stages.filter(s => s.state !== null).length, STAGES.length, 'stages reported', data.as_of)}>
      <div className="job-stages">{stages.map(s => <StageBlock key={s.key} stage={s} />)}</div>
    </Section>

    {r('operations') && <OperationsSection d={r('operations')!} />}
    {r('resources') && <ResourcesSection d={r('resources')!} />}
    {r('offers') && <OffersSection d={r('offers')!} onSigned={reload} />}
    {viewer && (viewer.slots.includes('customer') || viewer.slots.includes('org_owner')) && <React.Suspense fallback={null}><BestMatches workOrderId={workOrderId} /></React.Suspense>}
    {r('quotes') && <QuoteSection d={r('quotes')!} onSigned={reload} />}
    {r('bookings') && <BookingsSection d={r('bookings')!} onSigned={reload} />}
    {r('inspection') && <InspectionSection d={r('inspection')!} onSigned={reload} />}
    {r('evidence') && <EvidenceSection d={r('evidence')!} onSigned={reload} />}
    {r('invoices') && <InvoicesSection d={r('invoices')!} onSigned={reload} />}

    {(failures.length > 0 || pending.length > 0) && <section className="k-section job-block" aria-label="Not loaded">
      <Text role="label" as="h2">Not loaded</Text>
      {failures.map(k => <Text key={k} role="body" as="p">{READERS[k].title}: {(reads[k] as { reason: string }).reason}</Text>)}
      {pending.length > 0 && <Text role="caption" as="p">Still loading: {pending.map(k => READERS[k].title).join(', ')}</Text>}
      {failures.length > 0 && <button type="button" className="job-button" onClick={reload}><Text role="label">Try again</Text></button>}
    </section>}

    <section className="k-section job-block" aria-label="Statement">
      <Text role="body" as="p">
        <PrefetchLink className="job-link" to={`/work-orders/statement?work_order_id=${encodeURIComponent(workOrderId)}`}>Statement</PrefetchLink>
        {' '}— parts and labor for every work order on this vehicle; payments only for the people on each job.
      </Text>
    </section>
  </article>;
}

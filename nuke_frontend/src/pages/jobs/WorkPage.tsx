/**
 * WorkPage — /work, the signed-in work console: what is waiting for your signature
 * (my_signature_queue) and the jobs you are on (my_work_orders). Each item links to its job page and
 * repeats the server's own words for what signing binds and does not bind; the Signs themselves run
 * on the job page. A payment amount appears only on the payee's own confirmation item.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Section, Text } from '../../kit';
import { PrefetchLink } from '../../components/PrefetchLink';
import { usePageTitle } from '../../hooks/usePageTitle';
import {
  JobReaders, STAGES, binds, day, gapWord, jobHref, paymentLine, quoteTotals, signKindTitle, slotWords, stageWord, stateWord, vehicleText,
  type MyWorkOrdersRead, type SignQueueItem, type SignQueueRead, type WorkOrderRow,
} from './jobsReaders';
import { ConfirmBookingSheet } from './PeopleSheets';
import type { JsonObject } from './jobRead';
import './jobs.css';

function firstClock(item: SignQueueItem): string | null {
  const c = item.clock ?? {};
  for (const k of ['issued_at', 'offered_at', 'attested_at', 'paid_at', 'created_at', 'inspector_accepted_at', 'session_date']) {
    const d = day(c[k] ?? null);
    if (d) return d;
  }
  return null;
}

function counterpart(item: SignQueueItem): React.ReactNode {
  const p = (item.summary?.provider ?? item.summary?.from) as { handle?: string; label?: string } | undefined;
  if (!p) return null;
  if (p.handle) return <>From <PrefetchLink to={`/providers/${encodeURIComponent(p.handle)}`}>@{p.handle}</PrefetchLink></>;
  return p.label ? <>From {p.label}</> : null;
}

function QueueItem({ item, onSigned }: { item: SignQueueItem; onSigned: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const title = item.display_title || vehicleText(item.vehicle_label) || 'Untitled';
  const detail = [vehicleText(item.vehicle_label) !== title ? vehicleText(item.vehicle_label) : null, firstClock(item)].filter(Boolean).join(' · ');
  const amount = paymentLine(item);
  const totals = quoteTotals(item);
  const who = counterpart(item);
  const b = binds(item);
  const nb = item.sign?.does_not_bind ?? [];
  return <li className="jb-row" aria-label={signKindTitle(item.kind)}>
    <div className="jb-row__head">
      <Text role="label">{signKindTitle(item.kind)}</Text>
      {detail && <Text role="caption">{detail}</Text>}
    </div>
    {item.work_order_id
      ? <PrefetchLink to={jobHref(item.work_order_id)}><Text role="entity" dense>{title}</Text></PrefetchLink>
      : <Text role="entity" dense>{title}</Text>}
    {who && <Text role="body">{who}</Text>}
    {totals && <Text role="measure" dense>{totals}</Text>}
    {amount && <Text role="measure" dense>{amount}</Text>}
    {b.length > 0 && <div className="jb-says"><Text role="label">Signing says</Text><ul>{b.map(s => <li key={s}><Text role="body">{s}</Text></li>)}</ul></div>}
    {nb.length > 0 && <div className="jb-says"><Text role="label">It does not say</Text><ul>{nb.map(s => <li key={s}><Text role="body">{s}</Text></li>)}</ul></div>}
    {item.kind === 'facility_reservation_to_confirm'
      ? <div className="jb-actions"><button type="button" className="btn-base btn-sm btn-primary" onClick={() => setConfirming(true)}><Text role="label">Confirm booking</Text></button></div>
      : item.work_order_id && <Text role="caption">Sign on the job page.</Text>}
    {confirming && <ConfirmBookingSheet item={item as unknown as JsonObject} onClose={() => setConfirming(false)} onDone={onSigned} />}
  </li>;
}

function JobRow({ row }: { row: WorkOrderRow }) {
  const title = row.display_title || row.title || 'Untitled job';
  const stages = STAGES.filter(s => row.stage_states?.[s]).map(s => `${stageWord(s)}: ${stateWord(row.stage_states?.[s])}`).join(' · ');
  return <li className="jb-row" aria-label={title}>
    <div className="jb-row__head">
      <PrefetchLink to={jobHref(row.work_order_id)}><Text role="entity" dense>{title}</Text></PrefetchLink>
      <Text role="caption">{(row.slots ?? []).map(slotWords).join(' · ')}</Text>
    </div>
    {vehicleText(row.vehicle_label) && <Text role="body">{vehicleText(row.vehicle_label)}</Text>}
    {stages && <Text role="caption">{stages}</Text>}
    {row.first_gap?.gap && <Text role="caption">Next: {stageWord(row.first_gap.stage)} — {gapWord(row.first_gap.gap)}</Text>}
  </li>;
}

const WorkPage: React.FC = () => {
  usePageTitle('Work');
  const [queue, setQueue] = useState<SignQueueRead | null>(null);
  const [jobs, setJobs] = useState<MyWorkOrdersRead | null>(null);
  const [jobRows, setJobRows] = useState<WorkOrderRow[]>([]);
  const [refusal, setRefusal] = useState<string | null>(null);

  const loadJobs = useCallback(async (after: string | null) => {
    const r = await JobReaders.myWorkOrders(after);
    if (r.refusal) { setRefusal(r.refusal.message); return; }
    setJobs(r.data);
    setJobRows(prev => (after ? [...prev, ...r.data.rows] : r.data.rows));
  }, []);

  const loadQueue = useCallback(() => {
    void JobReaders.signatureQueue().then(r => { if (r.refusal) setRefusal(r.refusal.message); else setQueue(r.data); });
  }, []);

  useEffect(() => {
    loadQueue();
    void loadJobs(null);
  }, [loadJobs, loadQueue]);

  return <main className="jb-page jb-scope">
    <div className="jb-intro">
      <Text role="entity" as="h1">Work</Text>
      <Text role="body">What is waiting for your signature, and the jobs you are on. <PrefetchLink to="/jobs">Jobs looking for someone</PrefetchLink></Text>
    </div>
    {refusal && <Text role="body" className="jb-warn">{refusal}</Text>}
    {queue && <Section title="Waiting for your signature" coverage={{ n: queue.coverage.returned, of: queue.coverage.total, grain: 'items', as_of: queue.as_of }}>
      {queue.items.length === 0
        ? <Text role="body">Nothing is waiting for your signature.</Text>
        : <ul className="jb-list">{queue.items.map(i => <QueueItem key={`${i.kind}:${i.ref_id}`} item={i} onSigned={loadQueue} />)}</ul>}
    </Section>}
    {jobs && <Section title="Your jobs" coverage={{ n: jobRows.length, of: jobs.coverage.total_for_viewer, grain: 'jobs', as_of: jobs.as_of }}>
      {jobRows.length === 0
        ? <Text role="body">You are not on any jobs yet.</Text>
        : <ul className="jb-list">{jobRows.map(r => <JobRow key={r.work_order_id} row={r} />)}</ul>}
      {jobs.next_after && <div className="jb-more"><button type="button" className="btn-base btn-sm btn-secondary" onClick={() => void loadJobs(jobs.next_after)}>
        <Text role="label">More jobs</Text></button></div>}
    </Section>}
  </main>;
};

export default WorkPage;

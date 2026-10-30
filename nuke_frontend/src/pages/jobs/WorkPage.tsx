/**
 * WorkPage — /work, the signed-in work console: what is waiting for your signature
 * (my_signature_queue) and the jobs you are on (my_work_orders). Each item links to its job page and
 * repeats the server's own words for what signing binds and does not bind. Work-day and booking
 * confirmations have review sheets here; job Signs run on the job page. A payment amount appears only on the payee's own confirmation item.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Section, Text } from '../../kit';
import { PrefetchLink } from '../../components/PrefetchLink';
import { usePageTitle } from '../../hooks/usePageTitle';
import { useAuthContext } from '../../contexts/AuthContext';
import {
  JobReaders, STAGES, binds, day, gapWord, jobHref, paymentLine, quoteTotals, signKindTitle, slotWords, stageWord, stateWord, vehicleText,
  type MyWorkOrdersRead, type SignQueueItem, type SignQueueRead, type WorkOrderRow,
} from './jobsReaders';
import { ConfirmBookingSheet, ConfirmWorkDaySheet } from './PeopleSheets';
import { confirmWorkDayArgs } from './signDrafts';
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
  const workDay = item.kind === 'work_session' ? confirmWorkDayArgs(item as unknown as JsonObject) : null;
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
    {workDay
      ? <div className="jb-actions"><button type="button" className="btn-base btn-sm btn-primary" disabled={!workDay.ok} onClick={() => setConfirming(true)}><Text role="label">Review work day</Text></button>
        {!workDay.ok && <Text role="caption">{workDay.error}</Text>}</div>
      : item.kind === 'facility_reservation_to_confirm'
      ? <div className="jb-actions"><button type="button" className="btn-base btn-sm btn-primary" onClick={() => setConfirming(true)}><Text role="label">Confirm booking</Text></button></div>
      : item.work_order_id && <Text role="caption">Sign on the job page.</Text>}
    {confirming && (workDay
      ? <ConfirmWorkDaySheet item={item as unknown as JsonObject} onClose={() => setConfirming(false)} onDone={onSigned} />
      : <ConfirmBookingSheet item={item as unknown as JsonObject} onClose={() => setConfirming(false)} onDone={onSigned} />)}
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
    {row.retained_work?.visibility === 'included' && <>
      {(row.retained_work.responsibility_reports ?? []).map(report => <div key={report.binding_id}>
        <Text role="body">{report.provider_label} → {report.client_label}: delivery of the completed vehicle reported owed</Text>
        <Text role="caption">{report.payment_state === 'paid_in_full' ? 'Payment reported settled · ' : ''}Reported {new Date(report.reported_at).toLocaleDateString('en-US', { timeZone: 'UTC' })}. Physical completion is separate.</Text>
      </div>)}
      {!!row.retained_work.coverage?.total_source_entries && <PrefetchLink to={`${jobHref(row.work_order_id)}#retained-work`}>
        <Text role="body">{row.retained_work.coverage.total_source_entries} source-linked build entries →</Text>
      </PrefetchLink>}
    </>}
    {stages && <Text role="caption">{stages}</Text>}
    {row.first_gap?.gap && <Text role="caption">Next: {stageWord(row.first_gap.stage)} — {gapWord(row.first_gap.gap)}</Text>}
  </li>;
}

const WorkPage: React.FC = () => {
  usePageTitle('Work');
  const { session } = useAuthContext();
  const viewerId = session?.user?.id ?? null;
  // Queues, jobs and open confirmation drafts belong to this viewer. A new
  // account must never inherit a prior account's Sign or private read state.
  return viewerId ? <ViewerWorkPage key={viewerId} /> : null;
};

const ViewerWorkPage: React.FC = () => {
  const [queue, setQueue] = useState<SignQueueRead | null>(null);
  const [jobs, setJobs] = useState<MyWorkOrdersRead | null>(null);
  const [jobRows, setJobRows] = useState<WorkOrderRow[]>([]);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [cohort, setCohort] = useState<'responsible' | 'accessible'>('responsible');
  const generation = useRef(0);
  const paging = useRef(false);

  const loadJobs = useCallback(async (after: string | null) => {
    if (after && paging.current) return;
    paging.current = true;
    const scope = generation.current;
    const r = await JobReaders.myWorkOrders(after, cohort);
    if (scope !== generation.current) return;
    paging.current = false;
    if (r.refusal) { setRefusal(r.refusal.message); return; }
    setJobs(r.data);
    setJobRows(prev => (after ? [...prev, ...r.data.rows] : r.data.rows));
  }, [cohort]);

  const loadQueue = useCallback(() => {
    const scope = generation.current;
    void JobReaders.signatureQueue().then(r => {
      if (scope !== generation.current) return;
      if (r.refusal) setRefusal(r.refusal.message); else setQueue(r.data);
    });
  }, []);

  useEffect(() => {
    generation.current++;
    paging.current = false;
    setRefusal(null);
    loadQueue();
    void loadJobs(null);
    return () => { generation.current++; };
  }, [loadJobs, loadQueue]);

  return <article className="jb-page jb-scope">
    <div className="jb-intro">
      <Text role="entity" as="h1">Work</Text>
      <Text role="body">Your work responsibilities and records waiting for your signature. <PrefetchLink to="/jobs">Jobs looking for someone</PrefetchLink> · <PrefetchLink to="/work/market">The job market</PrefetchLink></Text>
      <Text role="body"><PrefetchLink to="/work/setup">Set up your provider page</PrefetchLink> so jobs that fit can find you.</Text>
    </div>
    <div role="alert" className="jb-live">{refusal && <Text role="body" className="jb-warn">{refusal}</Text>}</div>
    {queue && <Section title="Waiting for your signature" coverage={{ n: queue.coverage.returned, of: queue.coverage.total, grain: 'items', as_of: queue.as_of }}>
      {queue.items.length === 0
        ? <Text role="body">Nothing is waiting for your signature.</Text>
        : <ul className="jb-list">{queue.items.map(i => <QueueItem key={`${i.kind}:${i.ref_id}`} item={i} onSigned={loadQueue} />)}</ul>}
    </Section>}
    <div role="group" aria-label="Work scope">
      <button type="button" className="btn-base btn-sm btn-secondary" aria-pressed={cohort === 'responsible'} onClick={() => { if (cohort !== 'responsible') { setJobs(null); setJobRows([]); setCohort('responsible'); } }}>Your commitments</button>
      <button type="button" className="btn-base btn-sm btn-secondary" aria-pressed={cohort === 'accessible'} onClick={() => { if (cohort !== 'accessible') { setJobs(null); setJobRows([]); setCohort('accessible'); } }}>All accessible work</button>
    </div>
    {jobs && <Section title={cohort === 'responsible' ? 'Your commitments' : 'Accessible work'} coverage={{ n: jobRows.length, of: jobs.coverage.total_for_viewer, grain: 'jobs', as_of: jobs.as_of }}>
      {jobRows.length === 0
        ? <Text role="body">{cohort === 'responsible' ? 'No supported work responsibilities were returned. Unlinked source records may still contain work history.' : 'No accessible work orders were returned.'}</Text>
        : <ul className="jb-list">{jobRows.map(r => <JobRow key={r.work_order_id} row={r} />)}</ul>}
      {jobs.next_after && <div className="jb-more"><button type="button" className="btn-base btn-sm btn-secondary" onClick={() => void loadJobs(jobs.next_after)}>
        <Text role="label">More jobs</Text></button></div>}
    </Section>}
  </article>;
};

export default WorkPage;

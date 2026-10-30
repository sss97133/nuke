/**
 * WorkPage — /work starts with the viewer's jobs. Source-record reviews are secondary,
 * opened deliberately and rendered in batches. Work-day and booking confirmations retain
 * their review sheets; job Signs run on the job page. Payment amounts stay payee-only.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Section, Text } from '../../kit';
import { PrefetchLink } from '../../components/PrefetchLink';
import { usePageTitle } from '../../hooks/usePageTitle';
import { useAuthContext } from '../../contexts/AuthContext';
import {
  JobReaders, binds, day, jobHref, paymentLine, quoteTotals, signKindTitle, vehicleText,
  type MyWorkOrdersRead, type SignQueueItem, type SignQueueRead, type WorkOrderRow,
} from './jobsReaders';
import { ConfirmBookingSheet, ConfirmWorkDaySheet } from './PeopleSheets';
import { confirmWorkDayArgs } from './signDrafts';
import type { JsonObject } from './jobRead';
import './jobs.css';
import './job-page.css';
import { WorkPlanPreview } from './RetainedWorkPlan';

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
    {!workDay && (b.length > 0 || nb.length > 0) && <details>
      <summary>About this confirmation</summary>
      {b.length > 0 && <div className="jb-says"><Text role="label">Signing says</Text><ul>{b.map(s => <li key={s}><Text role="body">{s}</Text></li>)}</ul></div>}
      {nb.length > 0 && <div className="jb-says"><Text role="label">It does not say</Text><ul>{nb.map(s => <li key={s}><Text role="body">{s}</Text></li>)}</ul></div>}
    </details>}
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
  const heading = row.retained_work?.visibility === 'included' && row.retained_work.responsibility_reports?.length
    ? vehicleText(row.vehicle_label) || title : title;
  return <li className="jb-row" aria-label={title}>
    <div className="jb-row__head">
      <PrefetchLink to={jobHref(row.work_order_id)}><Text role="entity" dense>{heading}</Text></PrefetchLink>
    </div>
    {vehicleText(row.vehicle_label) && vehicleText(row.vehicle_label) !== heading && <Text role="body">{vehicleText(row.vehicle_label)}</Text>}
    {row.retained_work?.visibility === 'included' && <>
      {(row.retained_work.responsibility_reports ?? []).map(report => <div className="jb-work-responsibility" key={report.binding_id}>
        <Text role="body">{report.provider_label} owes delivery to {report.client_label}.</Text>
        <Text role="caption">Owner report · {day(report.reported_at)}{report.payment_state === 'paid_in_full' ? ' · Paid in full' : ''}</Text>
      </div>)}
      {row.vehicle_id && !!row.retained_work.responsibility_reports?.length
        ? <WorkPlanPreview vehicleId={row.vehicle_id} reports={row.retained_work.responsibility_reports} href={`${jobHref(row.work_order_id)}#work-plan`} />
        : !!row.retained_work.coverage?.total_source_entries && <PrefetchLink to={`${jobHref(row.work_order_id)}#retained-work`}>Open build records →</PrefetchLink>}
    </>}
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
  const [reviewsOpen, setReviewsOpen] = useState(false);
  const [reviewLimit, setReviewLimit] = useState(10);
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
    </div>
    <div role="alert" className="jb-live">{refusal && <Text role="body" className="jb-warn">{refusal}</Text>}</div>
    <div className="jb-actions" role="group" aria-label="Work scope">
      <button type="button" className={`btn-base btn-sm ${cohort === 'responsible' ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={cohort === 'responsible'} onClick={() => { if (cohort !== 'responsible') { setJobs(null); setJobRows([]); setCohort('responsible'); } }}>Your commitments</button>
      <button type="button" className={`btn-base btn-sm ${cohort === 'accessible' ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={cohort === 'accessible'} onClick={() => { if (cohort !== 'accessible') { setJobs(null); setJobRows([]); setCohort('accessible'); } }}>All accessible work</button>
    </div>
    {jobs && <Section title="Jobs" coverage={{ n: jobRows.length, of: jobs.coverage.total_for_viewer, grain: 'jobs', as_of: jobs.as_of }}>
      {jobRows.length === 0
        ? <Text role="body">{cohort === 'responsible' ? 'No jobs linked to your commitments yet.' : 'No jobs available in this view.'}</Text>
        : <ul className="jb-list">{jobRows.map(r => <JobRow key={r.work_order_id} row={r} />)}</ul>}
      {jobs.next_after && <div className="jb-more"><button type="button" className="btn-base btn-sm btn-secondary" onClick={() => void loadJobs(jobs.next_after)}>
        <Text role="label">More jobs</Text></button></div>}
    </Section>}
    {!jobs && !refusal && <Text role="caption" as="p" aria-live="polite">Loading jobs…</Text>}
    {queue && <section className="jb-work-reviews" aria-label="Record reviews">
      <button type="button" className="btn-base btn-sm btn-secondary" aria-expanded={reviewsOpen} aria-controls="work-record-reviews" onClick={() => setReviewsOpen(open => !open)}>
        Review records
      </button>
      {queue.coverage.total === 0 && <Text role="caption" as="p">Nothing waiting for review.</Text>}
      <div id="work-record-reviews" hidden={!reviewsOpen}>{reviewsOpen && <Section title="Records to review" coverage={{ n: Math.min(reviewLimit, queue.items.length), of: queue.coverage.total, grain: 'records', as_of: queue.as_of }}>
        <ul className="jb-list">{queue.items.slice(0, reviewLimit).map(i => <QueueItem key={`${i.kind}:${i.ref_id}`} item={i} onSigned={loadQueue} />)}</ul>
        {reviewLimit < queue.items.length && <button type="button" className="btn-base btn-sm btn-secondary" onClick={() => setReviewLimit(limit => limit + 10)}>More records</button>}
        {queue.coverage.total > queue.items.length && <Text role="caption" as="p">{queue.items.length} of {queue.coverage.total} records loaded.</Text>}
      </Section>}</div>
    </section>}
    <details className="jb-work-tools"><summary>Work tools</summary><nav aria-label="Work tools">
      <PrefetchLink to="/jobs">Find jobs</PrefetchLink>
      <PrefetchLink to="/work/market">Job market</PrefetchLink>
      <PrefetchLink to="/work/setup">Provider page</PrefetchLink>
    </nav></details>
  </article>;
};

export default WorkPage;

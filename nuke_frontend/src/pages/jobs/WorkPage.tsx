/**
 * WorkPage — /work starts with the viewer's jobs. Source-record reviews are secondary,
 * opened deliberately and rendered in batches. Work-day and booking confirmations retain
 * their review sheets; job Signs run on the job page. Payment amounts stay payee-only.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { fetchVehicleCardImages, type VehicleCardImage } from '../../services/vehicleCardImages';
import { VehicleIdentity } from '../../components/common/MakeIdentity';

type WorkView = 'current' | 'waiting' | 'history' | 'all';
type WorkSort = 'updated' | 'scheduled' | 'estimate' | 'hours';
const reportsFor = (row: WorkOrderRow) => row.retained_work?.visibility === 'included' ? row.retained_work.responsibility_reports ?? [] : [];
const clientFor = (row: WorkOrderRow) => row.workload?.client || reportsFor(row)[0]?.client_label || null;
const providerFor = (row: WorkOrderRow) => reportsFor(row)[0]?.provider_label || row.workload?.provider?.handle || row.workload?.provider?.label || null;
const waiting = (row: WorkOrderRow) => ['waiting', 'waiting_parts', 'on_hold'].includes(row.workload?.recorded_status ?? '');
const inHistory = (row: WorkOrderRow) => row.workload?.disposition === 'history';
function moneyText(value: number | null | undefined, currency: string | null | undefined): string {
  if (value == null) return 'Not linked';
  if (!currency || !/^[A-Z]{3}$/.test(currency)) return `${Number(value).toLocaleString()} · currency unstated`;
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(value); }
  catch { return `${Number(value).toLocaleString()} ${currency}`; }
}
const moneyFor = (row: WorkOrderRow, field: 'estimate' | 'received') => row.workload?.money.visibility === 'withheld'
  ? 'Private' : moneyText(row.workload?.money[field], row.workload?.money.currency);
const hoursText = (hours: number | null | undefined) => hours == null ? 'Not recorded' : `${Number(hours).toLocaleString()} h`;
const PART_LABELS: Record<string, string> = { quoted: 'quoted · availability unknown', on_hand: 'on hand', received: 'received',
  ordered: 'on order', backordered: 'backordered', ready_to_order: 'ready to order', installed: 'recorded installed',
  pending: 'requested', not_used: 'not used', cancelled: 'cancelled' };

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

function JobRow({ row, image }: { row: WorkOrderRow; image?: VehicleCardImage }) {
  const title = row.display_title || row.title || 'Untitled job';
  const heading = vehicleText(row.vehicle_label) || title;
  const repeatsVehicle = /^\d{4}\b/.test(title) && !!row.vehicle_label?.model && title.toLocaleLowerCase().includes(row.vehicle_label.model.toLocaleLowerCase());
  const work = row.workload;
  const client = clientFor(row), provider = providerFor(row);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = image?.medium_url || image?.thumbnail_url || image?.image_url;
  const paidReport = reportsFor(row).find(r => r.payment_state === 'paid_in_full');
  return <li className="jb-work-card" aria-label={title}>
    <PrefetchLink className="jb-work-card__photo" to={row.vehicle_id ? `/vehicle/${row.vehicle_id}` : jobHref(row.work_order_id)} aria-label={`Open ${heading}`}>
      {src && src !== failedSrc ? <img src={src} alt={heading} width={320} height={220} loading="lazy" onError={() => setFailedSrc(src)} />
        : <span>Vehicle photo unavailable</span>}
      <span className="jb-work-card__id">{row.vehicle_id ? `Vehicle ${row.vehicle_id.slice(0, 8)}` : 'Vehicle not linked'}</span>
    </PrefetchLink>
    <div className="jb-work-card__body">
    <div className="jb-row__head">
      <PrefetchLink to={jobHref(row.work_order_id)}><Text role="entity" dense>{row.vehicle_label?.make && row.vehicle_label.model
        ? <VehicleIdentity make={row.vehicle_label.make} model={row.vehicle_label.model} year={row.vehicle_label.year} compact variants={row.vehicle_label.trim ? [{ kind: 'trim', value: row.vehicle_label.trim }] : []} />
        : heading}</Text></PrefetchLink>
      <span className="jb-work-card__status">{reportsFor(row).length ? 'Delivery outstanding' : work?.recorded_status?.replaceAll('_', ' ') || 'Status not linked'}</span>
    </div>
    {title !== heading && !repeatsVehicle && <Text role="body" as="p">{title}</Text>}
    <div className="jb-work-card__people">
      <span>Client <strong>{client || 'Not linked'}</strong></span>
      {work?.organization?.name && <span>Shop <strong>{work.organization.name}</strong></span>}
      <span>Responsible <strong>{provider || 'Not linked'}</strong></span>
    </div>
    <dl className="jb-work-card__metrics">
      <div><dt>Job estimate</dt><dd>{moneyFor(row,'estimate')}</dd></div>
      <div><dt>Received</dt><dd>{paidReport && work?.money.received == null ? 'Paid in full' : moneyFor(row,'received')}</dd></div>
      <div><dt>Estimated time</dt><dd>{hoursText(work?.time.estimated_hours)}</dd></div>
      <div><dt>Recorded time</dt><dd>{hoursText(work?.time.recorded_hours)}</dd></div>
    </dl>
    <div className="jb-work-card__parts"><PrefetchLink to={`${jobHref(row.work_order_id)}/parts`}>Parts</PrefetchLink>
      {work?.parts.records ? Object.entries(work.parts.states).map(([state, count]) => <span key={state}>{count} {PART_LABELS[state] || state.replaceAll('_', ' ')}</span>)
        : <span>Availability not linked</span>}</div>
    {row.retained_work?.visibility === 'included' && <>
      {(row.retained_work.responsibility_reports ?? []).map(report => <div className="jb-work-responsibility" key={report.binding_id}>
        <Text role="body">{report.provider_label} owes delivery to {report.client_label}.</Text>
        <Text role="caption">Owner report · {day(report.reported_at)}{report.payment_state === 'paid_in_full' ? ' · Paid in full' : ''}</Text>
      </div>)}
      {row.vehicle_id && !!row.retained_work.responsibility_reports?.length
        ? <WorkPlanPreview vehicleId={row.vehicle_id} reports={row.retained_work.responsibility_reports} href={`${jobHref(row.work_order_id)}#work-plan`} />
        : !!row.retained_work.coverage?.total_source_entries && <PrefetchLink to={`${jobHref(row.work_order_id)}#retained-work`}>Open build records →</PrefetchLink>}
    </>}
    <div className="jb-work-card__foot"><PrefetchLink to={jobHref(row.work_order_id)}>Open work →</PrefetchLink>
      {work?.updated_at && <span>Record updated {day(work.updated_at)}</span>}
      {inHistory(row) && work?.completed_at && <span>Completed {day(work.completed_at)}</span>}
    </div>
    <details className="jb-work-card__basis"><summary>Sources</summary>
      <Text role="caption" as="p">{work ? `Work order ${row.work_order_id}. ${work.time.basis}. ${work.parts.basis}.` : 'Workload fields have not reached this reader.'}</Text>
      {work?.money.visibility === 'party' && <Text role="caption" as="p">{work.money.estimate_basis}. {work.money.payment_basis}. Remaining time and balance are not calculated from incomplete records.</Text>}
    </details>
    </div>
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
  const [view, setView] = useState<WorkView>('current');
  const [query, setQuery] = useState('');
  const [partyFilter, setPartyFilter] = useState('');
  const [sort, setSort] = useState<WorkSort>('updated');
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [images, setImages] = useState<Record<string, VehicleCardImage>>({});
  const [reviewsOpen, setReviewsOpen] = useState(false);
  const [reviewLimit, setReviewLimit] = useState(10);
  const generation = useRef(0);
  const loadJobs = useCallback(async () => {
    const scope = generation.current;
    setLoadingJobs(true);
    const rows: WorkOrderRow[] = [], seen = new Set<string>();
    let after: string | null = null;
    try {
      // Resolve the whole authorized cohort before enabling search/filter/sort.
      // A result on page two must not disappear behind a local 25-row filter.
      do {
        const r = await JobReaders.myWorkOrders(after, cohort);
        if (scope !== generation.current) return;
        if (r.refusal) throw new Error(r.refusal.message);
        for (const row of r.data.rows) if (!rows.some(existing => existing.work_order_id === row.work_order_id)) rows.push(row);
        setJobs(r.data); setJobRows([...rows]);
        after = r.data.next_after;
        if (after && seen.has(after)) throw new Error('Work stopped loading before the full list was available.');
        if (after) seen.add(after);
      } while (after);
      if (scope !== generation.current) return;
      setLoadingJobs(false);
      const ids = [...new Set(rows.flatMap(row => row.vehicle_id ? [row.vehicle_id] : []))];
      const batches = [];
      for (let start=0;start<ids.length;start+=1000) batches.push(ids.slice(start,start+1000));
      const results = await Promise.all(batches.map(fetchVehicleCardImages));
      if (scope !== generation.current) return;
      if (results.some(result => result.error)) setRefusal('Some vehicle photos could not be loaded.');
      setImages(Object.fromEntries(results.flatMap(result => result.data ?? []).map(image => [image.vehicle_id, image])));
    } catch (error) {
      if (scope === generation.current) { setRefusal(error instanceof Error ? error.message : 'Work could not be loaded.'); setLoadingJobs(false); }
    }
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
    setRefusal(null);
    setImages({});
    loadQueue();
    void loadJobs();
    return () => { generation.current++; };
  }, [loadJobs, loadQueue]);

  const complete = !!jobs && !loadingJobs && jobRows.length === jobs.coverage.total_for_viewer;
  const parties = useMemo(() => [...new Set(jobRows.flatMap(row => [clientFor(row), providerFor(row), row.workload?.organization?.name].filter((v): v is string => !!v)))].sort(), [jobRows]);
  const visibleRows = useMemo(() => {
    const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return jobRows.filter(row => {
      if (view === 'history' ? !inHistory(row) : view !== 'all' && inHistory(row)) return false;
      if (view === 'waiting' && !waiting(row)) return false;
      const people = [clientFor(row), providerFor(row), row.workload?.organization?.name];
      if (partyFilter && !people.includes(partyFilter)) return false;
      const haystack = [row.display_title, row.title, vehicleText(row.vehicle_label), row.vehicle_id, row.work_order_id, ...people].filter(Boolean).join(' ').toLocaleLowerCase();
      return words.every(word => haystack.includes(word));
    }).sort((a,b) => {
      const value = (row: WorkOrderRow): number | null => {
        if (sort === 'estimate') return row.workload?.money.estimate ?? null;
        if (sort === 'hours') return row.workload?.time.estimated_hours ?? null;
        const raw = sort === 'scheduled' ? row.workload?.schedule.start : row.workload?.updated_at;
        return raw && Number.isFinite(Date.parse(raw)) ? Date.parse(raw) : null;
      };
      const av = value(a), bv = value(b);
      if (av == null || bv == null) return av == null && bv == null ? a.work_order_id.localeCompare(b.work_order_id) : av == null ? 1 : -1;
      if (sort === 'estimate' && a.workload?.money.currency !== b.workload?.money.currency)
        return (a.workload?.money.currency || '\uffff').localeCompare(b.workload?.money.currency || '\uffff');
      return (sort === 'scheduled' ? av-bv : bv-av) || a.work_order_id.localeCompare(b.work_order_id);
    });
  }, [jobRows, view, query, partyFilter, sort]);

  return <article className="jb-page jb-scope jb-work-page">
    <div className="jb-intro">
      <Text role="entity" as="h1">Work</Text>
    </div>
    <div role="alert" className="jb-live">{refusal && <Text role="body" className="jb-warn">{refusal}</Text>}</div>
    <div className="jb-actions" role="group" aria-label="Work scope">
      <button type="button" className={`btn-base btn-sm ${cohort === 'responsible' ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={cohort === 'responsible'} onClick={() => { if (cohort !== 'responsible') { setJobs(null); setJobRows([]); setCohort('responsible'); } }}>Your commitments</button>
      <button type="button" className={`btn-base btn-sm ${cohort === 'accessible' ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={cohort === 'accessible'} onClick={() => { if (cohort !== 'accessible') { setJobs(null); setJobRows([]); setCohort('accessible'); } }}>All accessible work</button>
    </div>
    <div className="jb-work-controls">
      <label className="jb-field">Search work<input className="jb-input" type="search" value={query} placeholder="Vehicle, client, shop or job" disabled={!complete} onChange={e => setQuery(e.target.value)} /></label>
      <label className="jb-field">People & shops<select className="jb-input" value={partyFilter} disabled={!complete} onChange={e => setPartyFilter(e.target.value)}><option value="">Everyone</option>{parties.map(party => <option key={party}>{party}</option>)}</select></label>
      <label className="jb-field">Sort<select className="jb-input" value={sort} disabled={!complete} onChange={e => setSort(e.target.value as WorkSort)}>
        <option value="updated">Recently updated</option><option value="scheduled">Scheduled first</option><option value="estimate">Estimate by currency</option><option value="hours">Largest time commitment</option>
      </select></label>
    </div>
    <div className="jb-actions jb-work-views" role="group" aria-label="Work state">{(['current','waiting','history','all'] as const).map(state => <button key={state} type="button" className={`btn-base btn-sm ${view === state ? 'btn-primary' : 'btn-secondary'}`} disabled={!complete} aria-pressed={view === state} onClick={() => setView(state)}>{state === 'all' ? 'All records' : state[0].toUpperCase()+state.slice(1)}</button>)}</div>
    {jobs && <section className="jb-work-results" aria-label="Jobs">
      {!complete && <Text role="caption" as="p" aria-live="polite">{loadingJobs ? 'Loading the full work list…' : 'The work list is incomplete. Search and filters are unavailable.'}</Text>}
      {complete && <Text role="caption" as="p" aria-live="polite">{visibleRows.length} shown · {jobs.coverage.total_for_viewer} total · {view === 'history' ? 'History' : view === 'all' ? 'All records' : view === 'waiting' ? 'Recorded waiting' : 'Current work'}</Text>}
      {jobRows.length === 0
        ? <Text role="body">{cohort === 'responsible' ? 'No jobs linked to your commitments yet.' : 'No jobs available in this view.'}</Text>
        : <ul className="jb-list jb-work-list">{visibleRows.map(r => <JobRow key={r.work_order_id} row={r} image={r.vehicle_id ? images[r.vehicle_id] : undefined} />)}</ul>}
      {complete && jobRows.length>0 && visibleRows.length===0 && <Text role="body" as="p">No work matches these filters.</Text>}
    </section>}
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

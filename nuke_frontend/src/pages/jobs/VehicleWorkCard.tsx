/**
 * VehicleWorkCard — the vehicle page's Work section (vehicle_work_orders_read): jobs on this vehicle
 * with links to their job pages, "Plan the work" (listing_work_plan_read, read on request) and
 * "Post a job" when the reader's viewer.vehicle_access allows it and offers the action.
 */
import React, { useEffect, useState } from 'react';
import { Section, Text } from '../../kit';
import { PrefetchLink } from '../../components/PrefetchLink';
import { JobReaders, jobHref, slotWords, vehicleText, type VehicleWorkOrdersRead } from './jobsReaders';
import './jobs.css';

const WorkPlanPanel = React.lazy(() => import('./WorkPlanPanel'));
const PostJobSheet = React.lazy(() => import('./PostJobSheet'));

export default function VehicleWorkCard({ vehicleId, vehicleTitle, signedIn }: { vehicleId: string; vehicleTitle: string; signedIn: boolean }) {
  const [read, setRead] = useState<VehicleWorkOrdersRead | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRead(null);
    void JobReaders.vehicleWorkOrders(vehicleId).then(r => { if (!cancelled && r.data) setRead(r.data); });
    return () => { cancelled = true; };
  }, [vehicleId, signedIn]);

  if (!read) return null;
  const access = read.viewer.vehicle_access;
  const postAction = access?.can_post_work_request ? (read.viewer.actions ?? []).find(a => a.action === 'post_work_request') ?? null : null;

  return <Section title="Work" coverage={{ n: read.rows.length, of: read.coverage.total_for_vehicle, grain: 'jobs on this vehicle', as_of: read.as_of }} ariaLabel="Work on this vehicle">
    {read.rows.length > 0 && <ul className="jb-list">{read.rows.map(r => <li key={r.work_order_id} className="jb-row">
      <PrefetchLink to={jobHref(r.work_order_id)}><Text role="entity" dense>{r.display_title || r.title || 'Untitled job'}</Text></PrefetchLink>
      {(r.slots ?? []).length > 0 && <Text role="caption">{(r.slots ?? []).map(slotWords).join(' · ')}</Text>}
    </li>)}</ul>}
    <div className="jb-actions">
      <button type="button" className="btn-base btn-sm btn-secondary" aria-expanded={planOpen} onClick={() => setPlanOpen(v => !v)}>
        <Text role="label">{planOpen ? 'Hide the plan' : 'Plan the work'}</Text></button>
      {postAction && <button type="button" className="btn-base btn-sm btn-primary" onClick={() => setPosting(true)}><Text role="label">Post a job</Text></button>}
      <PrefetchLink to="/jobs"><Text role="caption">Jobs looking for someone</Text></PrefetchLink>
    </div>
    {planOpen && <React.Suspense fallback={null}><WorkPlanPanel vehicleId={vehicleId} signedIn={signedIn} /></React.Suspense>}
    {posting && postAction && <React.Suspense fallback={null}>
      <PostJobSheet action={postAction} vehicleTitle={vehicleText(read.vehicle_label) ?? vehicleTitle} onClose={() => setPosting(false)} />
    </React.Suspense>}
  </Section>;
}

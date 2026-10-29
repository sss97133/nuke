/**
 * VehicleWorkCard — the vehicle page's Work section (vehicle_work_orders_read): jobs on this vehicle
 * with links to their job pages, "Plan the work" (listing_work_plan_read, read on request) and
 * "Post a job" when the reader's viewer.vehicle_access allows it and offers the action.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { Section, Text } from '../../kit';
import { VehicleIdentity } from '../../components/common/MakeIdentity';
import { PrefetchLink } from '../../components/PrefetchLink';
import { JobReaders, jobHref, slotWords, vehicleText, type VehicleWorkOrdersRead } from './jobsReaders';
import { PublicationRow } from './Publication';
import { useVehiclePublication } from './useVehiclePublication';
import './jobs.css';

const WorkPlanPanel = React.lazy(() => import('./WorkPlanPanel'));
const PostJobSheet = React.lazy(() => import('./PostJobSheet'));

type Props = { vehicleId: string; vehicleTitle: string; signedIn: boolean; showVehicleTitle?: boolean };

export default function VehicleWorkCard(props: Props) {
  const { user, loading } = useAuth();
  if (loading) return <p role="status">Checking the viewer for vehicle work…</p>;
  return <ViewerVehicleWorkCard key={`${user?.id ?? 'anonymous'}:${props.vehicleId}`} {...props} />;
}

function ViewerVehicleWorkCard({ vehicleId, vehicleTitle, signedIn, showVehicleTitle = false }: Props) {
  const [read, setRead] = useState<VehicleWorkOrdersRead | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [posting, setPosting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<string | null>(null);
  const generation = useRef(0);
  const pending = useRef(false);
  const publication = useVehiclePublication(vehicleId, signedIn);

  const load = useCallback(async (after: string | null) => {
    if (pending.current) return;
    pending.current = true;
    const request = ++generation.current;
    setLoading(true); setError(null); setRetryAfter(after);
    try {
      const response = await JobReaders.vehicleWorkOrders(vehicleId, after);
      if (generation.current !== request) return;
      if (response.refusal) { setError(response.refusal.message); return; }
      const next = response.data;
      if (!next || !Array.isArray(next.rows) || !next.viewer || !next.coverage) {
        setError('The work-order response was incomplete. Try again.'); return;
      }
      setRead(previous => !after || !previous ? next : {
        ...next, rows: [...new Map([...previous.rows, ...next.rows].map(row => [row.work_order_id, row])).values()],
      });
    } catch {
      if (generation.current === request) setError('The work orders could not be loaded. Try again.');
    } finally {
      if (generation.current === request) { pending.current = false; setLoading(false); }
    }
  }, [vehicleId]);

  useEffect(() => {
    void load(null);
    return () => { generation.current++; pending.current = false; };
  }, [load]);

  if (!read) return <div className="jb-scope jb-vehicle-work"><section className="k-section" aria-label="Work on this vehicle"><Text role="label" as="h2">Work</Text>
    {loading ? <p role="status">Reading the work orders…</p> : <div role="alert"><Text role="body">{error || 'Work orders are unavailable.'}</Text>
      <button type="button" className="btn-base btn-sm btn-secondary" onClick={() => void load(null)}>Retry work orders</button></div>}
  </section></div>;
  const access = read.viewer.vehicle_access;
  const postAction = access?.can_post_work_request ? (read.viewer.actions ?? []).find(a => a.action === 'post_work_request') ?? null : null;

  return <div className="jb-scope jb-vehicle-work">
    {showVehicleTitle && <div className="jb-vehicle-context"><Text role="caption">Recorded vehicle</Text>
      <h2>{read.vehicle_label?.make && read.vehicle_label?.model
        ? <VehicleIdentity year={read.vehicle_label.year} make={read.vehicle_label.make} model={read.vehicle_label.model}
          variants={read.vehicle_label.trim ? [{ kind: 'trim', value: read.vehicle_label.trim }] : []} />
        : <Text role="entity">{vehicleText(read.vehicle_label) || 'Vehicle identity unavailable'}</Text>}</h2>
    </div>}
    <Section title="Work" coverage={{ n: read.rows.length, of: read.coverage.total_for_vehicle, grain: 'jobs on this vehicle', as_of: read.as_of }} ariaLabel="Work on this vehicle">
    {error && <div role="alert"><Text role="body">{error}</Text><button type="button" className="btn-base btn-sm btn-secondary" disabled={loading} onClick={() => void load(retryAfter)}>Retry work orders</button></div>}
    {loading && <p role="status">Reading more work orders…</p>}
    {publication.error && <div role="alert"><Text role="body">Publication status could not be loaded. {publication.error}</Text><button type="button" className="btn-base btn-sm btn-secondary" onClick={publication.reload}>Retry publication status</button></div>}
    {publication.loading && <p role="status">Reading publication status…</p>}
    {read.rows.length === 0 && <Text role="body">No work orders were returned for this vehicle.</Text>}
    {read.rows.length > 0 && <ul className="jb-list">{read.rows.map(r => <li key={r.work_order_id} className="jb-row">
      <PrefetchLink to={jobHref(r.work_order_id)}><Text role="entity" dense>{r.display_title || r.title || 'Untitled job'}</Text></PrefetchLink>
      {(r.slots ?? []).length > 0 && <Text role="caption">{(r.slots ?? []).map(slotWords).join(' · ')}</Text>}
      <PublicationRow state={publication.get(r.work_order_id)} onChanged={publication.reload} />
    </li>)}</ul>}
    {read.next_after && <div className="jb-more"><button type="button" className="btn-base btn-sm btn-secondary" disabled={loading} onClick={() => void load(read.next_after!)}>More jobs</button></div>}
    <div className="jb-actions">
      <button type="button" className="btn-base btn-sm btn-secondary" aria-expanded={planOpen} onClick={() => setPlanOpen(v => !v)}>
        <Text role="label">{planOpen ? 'Hide the plan' : 'Plan the work'}</Text></button>
      {postAction && <button type="button" className="btn-base btn-sm btn-primary" onClick={() => setPosting(true)}><Text role="label">Post a job</Text></button>}
      <PrefetchLink to="/jobs"><Text role="caption">Jobs looking for someone</Text></PrefetchLink>
    </div>
    {planOpen && <React.Suspense fallback={<p role="status">Opening the work plan…</p>}><WorkPlanPanel vehicleId={vehicleId} signedIn={signedIn} /></React.Suspense>}
    {posting && postAction && <React.Suspense fallback={<p role="status">Opening the request…</p>}>
      <PostJobSheet action={postAction} vehicleTitle={vehicleText(read.vehicle_label) ?? vehicleTitle} onClose={() => setPosting(false)} />
    </React.Suspense>}
  </Section></div>;
}

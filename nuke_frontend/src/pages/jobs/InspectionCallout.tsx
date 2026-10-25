/**
 * InspectionCallout — on a public vehicle page, when the listing plan (listing_work_plan_read) has checklist
 * items: "Get this car inspected before you buy", opening Plan the work with its Order an inspection Sign.
 * The plan is read once the slot scrolls into view and kept in this mounted callout. Nothing is recorded
 * about the visit.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { Text } from '../../kit';
import { JobReaders, type WorkPlan } from './jobsReaders';
import { WorkPlanView } from './WorkPlanPanel';
import './jobs.css';

type Props = { vehicleId: string; signedIn: boolean };

export default function InspectionCallout(props: Props) {
  const { user, loading } = useAuth();
  if (loading) return null;
  return <ViewerInspectionCallout key={`${user?.id ?? 'anonymous'}:${props.vehicleId}`} {...props} />;
}

function ViewerInspectionCallout({ vehicleId, signedIn }: Props) {
  const slot = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [plan, setPlan] = useState<WorkPlan | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setPlan(null); setOpen(false); setVisible(false);
    const el = slot.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const io = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { setVisible(true); io.disconnect(); } }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [vehicleId]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void JobReaders.plan(vehicleId).then(r => { if (!cancelled && r.data) setPlan(r.data); })
      .catch(() => { if (!cancelled) setPlan(null); });
    return () => { cancelled = true; };
  }, [visible, vehicleId]);

  const items = plan?.ppi_checklist.length ?? 0;
  return <div ref={slot} className="jb-scope">
    {plan && items > 0 && <section className="k-section jb-cta" aria-label="Get this car inspected before you buy">
      <Text role="entity" dense as="h2">Get this car inspected before you buy</Text>
      <Text role="body">{`A pre-purchase inspection answers ${items} question${items === 1 ? '' : 's'} from this listing: what the seller claims, whether the identity details agree, and the likely work.`}</Text>
      <div className="jb-actions">
        <button type="button" className="btn-base btn-md btn-primary" aria-expanded={open} onClick={() => setOpen(v => !v)}>
          <Text role="label">{open ? 'Hide the inspection plan' : 'See what an inspection checks'}</Text></button>
      </div>
      {!signedIn && <Text role="caption">Sign in to order one. Inspectors offer; you choose, and nothing is booked until you accept.</Text>}
      {open && <WorkPlanView vehicleId={vehicleId} plan={plan} signedIn={signedIn} />}
    </section>}
  </div>;
}

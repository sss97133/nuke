import { useEffect, useState } from 'react';
import { JobReaders } from './jobsReaders';

/**
 * The jobs whose backup suppliers this viewer may invite: my_work_orders rows where the server gives the viewer the customer
 * or vehicle-access slot (create_supplier_invite's rule, work_order_publication_party). Empty when signed out.
 */
export function useInviterJobs(signedIn: boolean): Set<string> {
  const [jobs, setJobs] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!signedIn) { setJobs(new Set()); return; }
    let cancelled = false;
    void JobReaders.myWorkOrders(null).then(r => {
      if (cancelled || !r.data) return;
      setJobs(new Set((r.data.rows ?? []).filter(w => (w.slots ?? []).some(s => s === 'customer' || s === 'vehicle_access')).map(w => w.work_order_id)));
    });
    return () => { cancelled = true; };
  }, [signedIn]);
  return jobs;
}

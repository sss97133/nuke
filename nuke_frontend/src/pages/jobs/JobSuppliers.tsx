/**
 * JobSuppliers — on a job page, for its customer or vehicle owner: the backup suppliers Nuke lists on this job's open
 * requests (open_requirements_read rows for this work order; requirement_plan_b_suppliers), with the invite or contact step
 * each one allows. Renders nothing when the job has no listed request with a backup supplier.
 */
import React, { useEffect, useState } from 'react';
import { Section, Text } from '../../kit';
import { JobReaders, requirementKind, type OpenRequirement } from './jobsReaders';
import { PlanBList } from './MatchList';
import './jobs.css';

const MAX_PAGES = 5;

export default function JobSuppliers({ workOrderId }: { workOrderId: string }) {
  const [rows, setRows] = useState<OpenRequirement[] | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const found: OpenRequirement[] = [];
      let after: string | null = null;
      for (let i = 0; i < MAX_PAGES; i++) {
        const r = await JobReaders.openRequirements(after);
        if (!r.data) break;
        if (i === 0) setAsOf(r.data.as_of);
        found.push(...(r.data.rows ?? []).filter(x => x.work_order_id === workOrderId && (x.plan_b_suppliers ?? []).length > 0));
        after = r.data.next_after ?? null;
        if (!after) break;
      }
      if (!cancelled) setRows(found);
    })();
    return () => { cancelled = true; };
  }, [workOrderId]);
  if (!rows || rows.length === 0) return null;
  return <div className="jb-scope">
    <Section title="Backup suppliers" coverage={{ n: rows.length, of: rows.length, grain: 'listed requests with a backup supplier', as_of: asOf }} ariaLabel="Backup suppliers for your requests">
      <Text role="body">Businesses that were paid for this kind of supply before on Nuke. Invite one that isn't on Nuke yet with a link you share; Nuke sends nothing.</Text>
      <ul className="jb-list">{rows.map(r => <li key={r.requirement_id} className="jb-row" aria-label={`${requirementKind(r.requirement_kind)} request`}>
        <Text role="label">{requirementKind(r.requirement_kind)}</Text>
        <Text role="body">{r.description || 'No description'}</Text>
        <PlanBList suppliers={r.plan_b_suppliers ?? []} requirementId={r.requirement_id} inviter />
      </li>)}</ul>
    </Section>
  </div>;
}

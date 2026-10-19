/**
 * VehicleWorkOrdersCard — the vehicle's jobs, from vehicle_work_orders_read (open; people and party money withheld at
 * the source). Each row opens its job page and carries the seven-stage rail and its first gap. Renders null with no jobs.
 */
import React, { useEffect, useState } from 'react';
import { PrefetchLink } from '../../components/PrefetchLink';
import { Section, Text } from '../../kit';
import { JobStageRail } from '../jobs/JobStageRail';
import { readJob } from '../jobs/readJob';
import { arr, gapText, num, obj, str, type JsonObject, type StageKey } from '../jobs/jobRead';
import '../jobs/jobs.css';

const VehicleWorkOrdersCard: React.FC<{ vehicleId: string }> = ({ vehicleId }) => {
  const [page, setPage] = useState<JsonObject | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    readJob('vehicle_work_orders_read', { p_vehicle_id: vehicleId, p_after: null, p_limit: 10 })
      .then(l => { if (!cancelled) setPage(l.status === 'loaded' ? l.data : null); });
    return () => { cancelled = true; };
  }, [vehicleId]);

  const rows = arr(page?.rows).map(obj).filter((o): o is JsonObject => !!o && !!str(o.work_order_id));
  if (!page || rows.length === 0) return null;
  const c = obj(page.coverage);
  const next = str(page.next_after);

  const more = async () => {
    if (!next) return;
    setLoadingMore(true);
    const l = await readJob('vehicle_work_orders_read', { p_vehicle_id: vehicleId, p_after: next, p_limit: 10 });
    setLoadingMore(false);
    if (l.status === 'loaded') setPage({ ...l.data, rows: [...rows, ...arr(l.data.rows)] });
  };

  return <Section title="Work" coverage={{ n: rows.length, of: Math.max(num(c?.total_for_vehicle) ?? rows.length, rows.length), grain: 'work orders', as_of: str(page.as_of) }}>
    {rows.map(r => {
      const gap = obj(r.first_gap);
      const conflicts = num(r.inconsistencies) ?? 0;
      return <div key={str(r.work_order_id)!} className="job-row">
        <div className="job-row__main">
          <PrefetchLink className="job-link" to={`/jobs/${str(r.work_order_id)}`}>
            <Text role="entity" dense>{str(r.display_title) ?? str(r.title) ?? 'Untitled job'}</Text>
          </PrefetchLink>
          <Text role="caption">{[gap && str(gap.gap) ? `Next missing: ${gapText(str(gap.gap)!)}` : null,
            conflicts > 0 ? `${conflicts} record${conflicts === 1 ? '' : 's'} disagree` : null].filter(Boolean).join(' · ')}</Text>
        </div>
        <JobStageRail compact states={(obj(r.stage_states) ?? {}) as Partial<Record<StageKey, string | null>>} />
      </div>;
    })}
    {next && <button type="button" className="job-button" disabled={loadingMore} onClick={more}><Text role="label">{loadingMore ? 'Loading…' : 'More work orders'}</Text></button>}
    <Text role="caption" as="p">Stages show what's on record, not yet verified. Payments are shown only to the people on each job.</Text>
  </Section>;
};

export default VehicleWorkOrdersCard;

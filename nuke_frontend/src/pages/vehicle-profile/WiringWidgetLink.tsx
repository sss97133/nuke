/**
 * WiringWidgetLink.tsx
 *
 * Sidebar widget on the vehicle profile for visitors: the vehicle's wire count and a link to the MAP tab of
 * /vehicle/:id/wiring (the harness results: tree, plan, 3D, connector faces, schematics, wire and pin lists).
 * The owner gets the harness builder in the owner tools instead. Returns null when the vehicle has no wiring rows
 * (design-book "No Empty Shells" rule).
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CollapsibleWidget } from '../../components/ui/CollapsibleWidget';
import { supabase } from '../../lib/supabase';

interface Props {
  vehicleId: string;
}

const WiringWidgetLink: React.FC<Props> = ({ vehicleId }) => {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!vehicleId) return;
    let cancelled = false;

    (async () => {
      const { data: overlays, error } = await supabase.from('vehicle_wiring_overlays').select('id').eq('vehicle_id', vehicleId);
      const ids = (overlays ?? []).map(o => (o as { id: string }).id);
      if (cancelled || error) return;
      if (!ids.length) { setCount(0); return; }
      const { count: c, error: e2 } = await supabase
        .from('vehicle_custom_circuits')
        .select('id', { count: 'exact', head: true })
        .in('overlay_id', ids)
        .eq('is_superseded', false);
      if (!cancelled && !e2) setCount(c ?? 0);
    })();

    return () => {
      cancelled = true;
    };
  }, [vehicleId]);

  if (count === null || count === 0) return null;

  return (
    <CollapsibleWidget
      variant="profile"
      title="Wiring Harness"
      defaultCollapsed={false}
      badge={<span className="widget__count">{count}</span>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 9, color: 'var(--vp-pencil)', fontFamily: 'Arial, sans-serif' }}>
          {count} wire{count === 1 ? '' : 's'} on the harness map.
        </div>
        <Link
          to={`/vehicle/${vehicleId}/wiring?tab=map`}
          className="button-win95"
          style={{
            display: 'inline-block',
            textAlign: 'center',
            fontWeight: 700,
            textDecoration: 'none',
            color: 'inherit',
          }}
        >
          OPEN THE WIRING MAP →
        </Link>
      </div>
    </CollapsibleWidget>
  );
};

export default WiringWidgetLink;

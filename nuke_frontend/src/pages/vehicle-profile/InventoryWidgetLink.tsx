/**
 * InventoryWidgetLink.tsx
 *
 * Sidebar widget on the vehicle profile that surfaces the "parts owned but
 * not yet installed" count and links to /vehicle/:id/inventory. Returns null
 * when there's nothing to show (per design-book "No Empty Shells" rule).
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CollapsibleWidget } from '../../components/ui/CollapsibleWidget';
import { supabase } from '../../lib/supabase';

interface Props {
  vehicleId: string;
}

const InventoryWidgetLink: React.FC<Props> = ({ vehicleId }) => {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!vehicleId) return;
    let cancelled = false;

    (async () => {
      const { count: c, error } = await supabase
        .from('vehicle_observations')
        .select('id', { count: 'exact', head: true })
        .eq('vehicle_id', vehicleId)
        .eq('kind', 'specification')
        .eq('is_superseded', false)
        .filter('structured_data->>lifecycle_status', 'eq', 'purchased');
      if (cancelled) return;
      if (!error) setCount(c ?? 0);
    })();

    return () => {
      cancelled = true;
    };
  }, [vehicleId]);

  if (count === null || count === 0) return null;

  return (
    <CollapsibleWidget
      variant="profile"
      title="Inventory"
      defaultCollapsed={false}
      badge={<span className="widget__count">{count}</span>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 9, color: 'var(--vp-pencil)', fontFamily: 'Arial, sans-serif' }}>
          {count} part{count === 1 ? '' : 's'} purchased, install evidence pending.
        </div>
        <Link
          to={`/vehicle/${vehicleId}/inventory`}
          className="button-win95"
          style={{
            display: 'inline-block',
            textAlign: 'center',
            fontWeight: 700,
            textDecoration: 'none',
            color: 'inherit',
          }}
        >
          OPEN PARTS INVENTORY →
        </Link>
        <Link
          to={`/vehicle/${vehicleId}/vendors`}
          className="button-win95"
          style={{
            display: 'inline-block',
            textAlign: 'center',
            fontWeight: 700,
            textDecoration: 'none',
            color: 'inherit',
          }}
        >
          VENDOR DIRECTORY →
        </Link>
        <Link
          to={`/vehicle/${vehicleId}/lifecycle`}
          className="button-win95"
          style={{
            display: 'inline-block',
            textAlign: 'center',
            fontWeight: 700,
            textDecoration: 'none',
            color: 'inherit',
          }}
        >
          LIFECYCLE DASHBOARD →
        </Link>
        <Link
          to={`/vehicle/${vehicleId}/table`}
          className="button-win95"
          style={{
            display: 'inline-block',
            textAlign: 'center',
            fontWeight: 700,
            textDecoration: 'none',
            color: 'inherit',
          }}
        >
          SPREADSHEET TABLE →
        </Link>
        <Link
          to={`/vehicle/${vehicleId}/analysis-stream`}
          className="button-win95"
          style={{
            display: 'inline-block',
            textAlign: 'center',
            fontWeight: 700,
            textDecoration: 'none',
            color: 'inherit',
          }}
        >
          LIVE ANALYSIS STREAM →
        </Link>
      </div>
    </CollapsibleWidget>
  );
};

export default InventoryWidgetLink;

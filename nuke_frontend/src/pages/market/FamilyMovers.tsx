import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Text } from '../../kit';
import './FamilyMovers.css';

// The families whose Bring a Trailer market moved most in the last 12 months against the 12 before, both ways, with
// BaT's own move beside them (treemap_family_movers, 20261015173000). Owner, 2026-10-15, on the brand map: "increase
// over 12 months is interesting, but needs expansion and clarity". A tile's color says one brand's move; this says
// which families moved most across every brand, and a pick drills the map to that family.
export type Mover = {
  direction: 'up' | 'down'; brand: string; family_key: string; family: string;
  sold_12m: number; sold_prior_12m: number; usd_12m: number; usd_prior_12m: number;
  bat_sold_12m: number; bat_sold_prior_12m: number; bat_usd_12m: number; bat_usd_prior_12m: number;
  eligible: number; families: number;
};

// One read per page lifetime; a failed read is forgotten so the next mount retries, and the strip stays away.
let moversRead: Promise<Mover[] | null> | null = null;
export function readFamilyMovers(): Promise<Mover[] | null> {
  if (typeof (supabase as { rpc?: unknown })?.rpc !== 'function') return Promise.resolve(null);
  if (!moversRead) {
    moversRead = Promise.resolve(supabase.rpc('treemap_family_movers', { p_limit: 8 })).then(
      ({ data, error }) => { if (error || !Array.isArray(data)) { moversRead = null; return null; } return data as Mover[]; },
      () => { moversRead = null; return null; },
    );
  }
  return moversRead;
}

export function move(now: number, before: number): string {
  if (!before) return '';
  const m = now / before - 1;
  return `${m >= 0 ? '▲' : '▼'}${Math.abs(Math.round(m * 100))}%`;
}

export default function FamilyMovers({ onPick }: { onPick: (m: Mover) => void }) {
  const [rows, setRows] = useState<Mover[] | null>(null);
  useEffect(() => {
    let live = true;
    readFamilyMovers().then((r) => { if (live) setRows(r); });
    return () => { live = false; };
  }, []);
  if (!rows?.length) return null;
  const bat = rows[0];
  return <div className="map-movers" role="group" aria-label="Moving on Bring a Trailer, last 12 months">
    <Text role="label" className="map-movers__title">Moving on BaT · 12 mo</Text>
    <div className="map-movers__list">
      {rows.map((m) => <button key={`${m.direction}-${m.brand}-${m.family_key}`} type="button"
        className={`map-movers__item map-movers__item--${m.direction}`} onClick={() => onPick(m)}
        title={`${m.brand} ${m.family} on Bring a Trailer: ${m.sold_prior_12m} sold in the 12 months before, ${m.sold_12m} in the last 12; dollars ${move(m.usd_12m, m.usd_prior_12m)}`}>
        <Text role="label">{m.brand} {m.family}</Text>
        <Text role="measure" dense>{move(m.usd_12m, m.usd_prior_12m)}</Text>
        <Text role="caption">{m.sold_prior_12m}→{m.sold_12m} sold</Text>
      </button>)}
    </div>
    <Text role="caption" className="map-movers__base">
      dollars on BaT; BaT overall: sales {move(bat.bat_sold_12m, bat.bat_sold_prior_12m)}, $ {move(bat.bat_usd_12m, bat.bat_usd_prior_12m)} · {bat.eligible.toLocaleString('en-US')} of {bat.families.toLocaleString('en-US')} families with 30+ BaT sales each year
    </Text>
  </div>;
}

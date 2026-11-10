import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { PrefetchLink } from '../PrefetchLink';
import { VehicleIdentity } from '../common/MakeIdentity';
import { Text } from '../../kit';
import { houseLink, updatedAgo } from '../../pages/market/useAuctionCalendar';
import './OrganizationSourceInventory.css';

type Sale = { sale_key: string; name: string; starts_on: string; ends_on: string; location: string; source_url: string; lots_listed: number | null };
type Row = { native_id: string; source_url: string; inventory_kind: 'auction' | 'showroom'; sale_key: string | null;
  lot_number: string; year: number | null; make: string; model: string; source_status: string; run_on: string | null;
  asking_amount: number | null; currency: null; vehicle_id: string | null };
export type SourceInventory = { source: 'mccormicks'; checked_at: string | null; refresh_failed: boolean; stale: boolean; sales: Sale[]; inventory: Row[] };
const date = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
export function currentSourceRows(data: SourceInventory, filter: string, search: string) {
  const query = search.trim().toLowerCase();
  return data.inventory.filter(r => r.source_status !== 'sold'
    && (r.inventory_kind === 'showroom' || data.sales.some(s => s.sale_key === r.sale_key))
    && (filter === 'all' || filter === r.inventory_kind || filter === r.sale_key)
    && `${r.year ?? ''} ${r.make} ${r.model} ${r.lot_number}`.toLowerCase().includes(query));
}
export default function OrganizationSourceInventory({ organizationId, fallback = null, initialFilter = 'all', children }: { organizationId: string; fallback?: ReactNode; initialFilter?: 'all' | 'auction'; children?: ReactNode }) {
  const [filter, setFilter] = useState<string>(initialFilter), [search, setSearch] = useState(''), [limit, setLimit] = useState(50);
  const query = useQuery({ queryKey: ['organization-source-inventory', organizationId], queryFn: async () => {
    const { data, error } = await supabase.rpc('organization_source_inventory_read', { p_organization_id: organizationId });
    if (error) throw error;
    if (data === null) return null;
    if (data?.source !== 'mccormicks' || !Array.isArray(data.sales) || !Array.isArray(data.inventory)) throw Error('Invalid source reading');
    return data as SourceInventory;
  }, staleTime: 30_000, refetchInterval: 60_000 });
  const data = query.data;
  const scrolledTo = useRef<string | null>(null);
  useEffect(() => {
    if (data && scrolledTo.current !== organizationId && window.location.hash === "#source-inventory") {
      document.getElementById("source-inventory")?.scrollIntoView?.();
      scrolledTo.current = organizationId;
    }
  }, [data, organizationId]);
  if (!data) return <>{query.isError && <p role="status">Schedule and inventory unavailable.</p>}{fallback}</>;
  if (!data.checked_at) return <><section id="source-inventory" className="organization-source-inventory" aria-label="Upcoming sales and current inventory">
    <Text as="h2" role="entity">Upcoming sales and current inventory</Text>
    <p role="status">The first complete source reading is pending.</p>
  </section>{children}</>;
  const rows = currentSourceRows(data, filter, search);
  const stale = data.stale || Date.now() - Date.parse(data.checked_at) > 3_600_000;
  return <><section id="source-inventory" className="organization-source-inventory" aria-label="Upcoming sales and current inventory">
    <Text as="h2" role="entity">Upcoming sales</Text>
    <Text as="p" role="caption">McCormick’s published schedule and inventory · <span title={data.checked_at}>{updatedAgo(data.checked_at, Date.now()).replace('updated', 'checked')}</span></Text>
    {(stale || data.refresh_failed || query.isError) && <p role="status">Refresh delayed. Showing the last complete source reading; confirm availability with McCormick’s.</p>}
    <ul className="organization-source-inventory__sales">{data.sales.map(sale => {
      const url = houseLink(data.source, sale.source_url);
      return <li key={sale.sale_key}>
        <Text as="h3" role="entity">{url ? <a href={url} target="_blank" rel="noopener noreferrer">{sale.name}</a> : sale.name}</Text>
        <p>{date(sale.starts_on)} – {date(sale.ends_on)}</p>
        <Text as="p" role="caption">{sale.location}</Text>
        {sale.lots_listed === null ? <p>Catalog not published</p> : <button type="button" onClick={() => { setFilter(sale.sale_key); setLimit(50); }}>
          View {sale.lots_listed.toLocaleString()} entered cars</button>}
      </li>;
    })}</ul>
    <Text as="h2" role="entity">Current inventory</Text>
    <div className="organization-source-inventory__controls">
      <label>Show <select value={filter} onChange={e => { setFilter(e.target.value); setLimit(50); }}>
        <option value="all">All current inventory</option><option value="auction">Auction entries</option><option value="showroom">Available showroom stock</option>
        {data.sales.filter(s => s.lots_listed !== null).map(s => <option key={s.sale_key} value={s.sale_key}>{s.name}</option>)}
      </select></label>
      <label>Find a car <input type="search" value={search} onChange={e => { setSearch(e.target.value); setLimit(50); }} placeholder="Year, make, model or lot" /></label>
      <span>{rows.length.toLocaleString()} {rows.length === 1 ? 'car' : 'cars'}</span>
    </div>
    <Text as="p" role="caption">Auction entries are scheduled consignments. Showroom stock is advertised as available by McCormick’s. Availability can change.</Text>
    <div className="organization-source-inventory__scroll"><table>
      <thead><tr><th scope="col">Lot / stock</th><th scope="col">Vehicle</th><th scope="col">Sale / availability</th><th scope="col">Source</th></tr></thead>
      <tbody>{rows.slice(0, limit).map(row => {
        const source = houseLink(data.source, row.source_url);
        const identity = <VehicleIdentity year={row.year} make={row.make} model={row.model} compact scale="text" />;
        return <tr key={`${row.inventory_kind}:${row.native_id}`}>
          <td>{row.lot_number}</td>
          <td>{row.vehicle_id ? <PrefetchLink to={`/vehicle/${row.vehicle_id}`}>{identity}</PrefetchLink> : identity}</td>
          <td>{row.inventory_kind === 'showroom' ? 'Showroom · advertised available' : row.run_on ? date(row.run_on) : 'Auction entry · run day unconfirmed'}</td>
          <td>{source && <a href={source} target="_blank" rel="noopener noreferrer">McCormick’s listing</a>}</td>
        </tr>;
      })}</tbody>
    </table></div>
    {!rows.length && <p>No advertised cars match this view.</p>}
    {limit < rows.length && <button type="button" onClick={() => setLimit(n => n + 50)}>Show more cars</button>}
  </section>{children}</>;
}

import { useSearchParams } from 'react-router-dom';
import { PrefetchLink } from '../../components/PrefetchLink';
import { MakeIdentity, VehicleIdentity } from '../../components/common/MakeIdentity';
import { LISTING_SOURCES, sourceLink, sourceName, useCapturedListings } from './useCapturedListings';

function clock(value: string | null) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Unrecorded';
}
function vehicleImage(value?: string | null) {
  try { const url = new URL(value ?? ''); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}

export default function CapturedListings() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('source') ?? 'classifieds';
  const source = requested === 'classifieds' || requested === '' || LISTING_SOURCES.includes(requested as typeof LISTING_SOURCES[number]) ? requested : 'classifieds';
  const query = useCapturedListings(source);
  const rows = query.data?.pages.flatMap(page => page.items) ?? [];
  return <section aria-label="Captured listings" style={{ padding: '0 12px' }}>
    <h2>Listings</h2>
    <p>Captured listings; availability and source-wide coverage are unverified. Private capture histories are not included here.</p>
    <label>Source <select value={source} onChange={event => {
      const next = new URLSearchParams(params); next.set('collection', 'listings');
      next.set('source', event.target.value); setParams(next);
    }}><option value="classifieds">Classified listings</option><option value="">All supported sources</option>{LISTING_SOURCES.map(value => <option key={value} value={value}>{sourceName(value)}</option>)}</select></label>
    <p>{rows.length} loaded listings · newest retained first</p>
    {query.isPending && <p role="status">Reading retained listings…</p>}
    {query.isError && <p role="status">Listings could not be refreshed. {rows.length ? 'Showing the last fetched records.' : ''} <button onClick={() => void query.refetch()}>Retry</button></p>}
    {!query.isPending && !query.isError && !rows.length && <p role="status">No readable retained listings in this page.</p>}
    <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
      <thead><tr><th scope="col">Listing / vehicle</th><th scope="col">Recorded amount</th><th scope="col">Evidence</th></tr></thead>
      <tbody>{rows.map(row => {
        const href = sourceLink(row.source_platform, row.source_url);
        const identity = row.vehicle && [row.vehicle.year, row.vehicle.make, row.vehicle.model].filter(Boolean).join(' ');
        const image = vehicleImage(row.vehicle?.primary_image_url);
        return <tr key={row.id} style={{ borderTop: '2px solid var(--border)' }}>
          <td style={{ padding: '8px 0' }}>{image && <img src={image} width="80" height="60" loading="lazy" alt="Vehicle record image" style={{ objectFit: 'cover', float: 'left', marginRight: 8 }} onError={event => { event.currentTarget.style.visibility = 'hidden'; }} />}
            {row.vehicle ? <PrefetchLink to={`/vehicle/${row.vehicle.id}`} aria-label={identity || 'Vehicle identity unrecorded'}>
            {row.vehicle.make && row.vehicle.model ? <>{row.vehicle.year ?? ''} <VehicleIdentity year={row.vehicle.year} make={row.vehicle.make} model={row.vehicle.model} /></>
              : row.vehicle.make ? <>{row.vehicle.year ?? ''} <MakeIdentity make={row.vehicle.make} /></> : identity || 'Vehicle identity unrecorded'}
          </PrefetchLink> : <span>Vehicle unresolved</span>}
            <div>{href ? <a href={href} target="_blank" rel="noopener noreferrer">{sourceName(row.source_platform)} · original listing</a> : <span>{sourceName(row.source_platform)} · source link unrecorded</span>}</div></td>
          <td>{row.current_price == null || !Number.isFinite(Number(row.current_price)) ? 'Unrecorded' : `${Number(row.current_price).toLocaleString()} · currency unrecorded`}</td>
          <td><details><summary>{row.event_status ? `Recorded ${row.event_status}` : 'Listing evidence'}</summary>
            <div>Source ID {row.source_listing_id || 'unrecorded'}</div><div>Retained {clock(row.created_at)}</div><div>Record updated {clock(row.updated_at)}</div><div>Source observation time unrecorded</div>
          </details></td>
        </tr>;
      })}</tbody>
    </table></div>
    {query.hasNextPage && <button disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>{query.isFetchingNextPage ? 'Reading more…' : 'Load more listings'}</button>}
  </section>;
}

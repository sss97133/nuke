import { type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PrefetchLink } from '../../components/PrefetchLink';
import { MakeIdentity, VehicleIdentity } from '../../components/common/MakeIdentity';
import { Masthead, Text } from '../../kit';
import PrivateCaptureHistory from './PrivateCaptureHistory';
import { LISTING_SOURCES, sourceLink, sourceName, useCapturedListings } from './useCapturedListings';
// The market page's frame, strip and controls live in these two sheets; the auction board imports them through its
// own components, and this collection renders without the board, so it imports them itself.
import './RecordedSalesComparison.css';
import './AuctionEvidence.css';

function clock(value: string | null) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Unrecorded';
}
function vehicleImage(value?: string | null) {
  try { const url = new URL(value ?? ''); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}

export default function CapturedListings({ collection }: { collection?: ReactNode }) {
  const [params, setParams] = useSearchParams();
  const requested = params.get('source') ?? 'classifieds';
  const source = requested === 'classifieds' || requested === '' || LISTING_SOURCES.includes(requested as typeof LISTING_SOURCES[number]) ? requested : 'classifieds';
  const query = useCapturedListings(source);
  const rows = query.data?.pages.flatMap(page => page.items) ?? [];
  return <section aria-label="Captured listings" className="market-explorer">
    <Masthead result={<>
      <Text role="measure" as="div">{query.isPending ? '…' : rows.length.toLocaleString('en-US')}</Text>
      <Text role="caption" as="div">loaded · newest retained first</Text>
    </>}>
      <Text role="entity" as="h1">Captured listings</Text>
    </Masthead>
    <div className="k-section k-strip market-scope" role="group" aria-label="Listings scope">
      <div role="group" aria-label="Market view" className="market-scope__views">{collection}</div>
      <label className="market-scope__cohort"><Text role="label">Source</Text><select className="market-control k-body" value={source} onChange={event => {
        const next = new URLSearchParams(params); next.set('collection', 'listings');
        next.set('source', event.target.value); setParams(next);
      }}><option value="classifieds">Classified listings</option><option value="">All supported sources</option>{LISTING_SOURCES.map(value => <option key={value} value={value}>{sourceName(value)}</option>)}</select></label>
      <Text role="caption" className="market-scope__note">Captured listings; availability and source-wide coverage are unverified. Private capture history appears separately when permitted.</Text>
    </div>
    {query.isPending && <p role="status" className="k-body">Reading retained listings…</p>}
    {query.isError && <p role="status" className="k-body">Listings could not be refreshed. {rows.length ? 'Showing the last fetched records.' : ''} <button type="button" className="market-control" onClick={() => void query.refetch()}><Text role="label">Retry</Text></button></p>}
    {!query.isPending && !query.isError && !rows.length && <p role="status" className="k-body">No readable retained listings in this page.</p>}
    <div className="market-listings__scroll"><table className="market-listings">
      <thead><tr><th scope="col"><Text role="label">Listing / vehicle</Text></th><th scope="col"><Text role="label">Recorded amount</Text></th><th scope="col"><Text role="label">Evidence</Text></th></tr></thead>
      <tbody>{rows.map(row => {
        const href = sourceLink(row.source_platform, row.source_url);
        const identity = row.vehicle && [row.vehicle.year, row.vehicle.make, row.vehicle.model].filter(Boolean).join(' ');
        const image = vehicleImage(row.vehicle?.primary_image_url);
        return <tr key={row.id}>
          <td>{image && <img className="market-listing__image" src={image} width="80" height="60" loading="lazy" alt="Vehicle record image" onError={event => { event.currentTarget.hidden = true; }} />}
            <Text role="entity" dense as="div">{row.vehicle ? <PrefetchLink to={`/vehicle/${row.vehicle.id}`} aria-label={identity || 'Vehicle identity unrecorded'}>
            {row.vehicle.make && row.vehicle.model ? <VehicleIdentity year={row.vehicle.year} make={row.vehicle.make} model={row.vehicle.model} />
              : row.vehicle.make ? <>{row.vehicle.year ?? ''} <MakeIdentity make={row.vehicle.make} /></> : identity || 'Vehicle identity unrecorded'}
          </PrefetchLink> : <span>Vehicle unresolved</span>}</Text>
            <Text role="caption" as="div">{href ? <a href={href} target="_blank" rel="noopener noreferrer">{sourceName(row.source_platform)} · original listing</a> : <span>{sourceName(row.source_platform)} · {row.source_url ? 'source link unavailable here' : 'source link unrecorded'}</span>}</Text></td>
          <td>{row.current_price == null || !Number.isFinite(Number(row.current_price)) ? <Text role="caption">Unrecorded</Text>
            : <><Text role="measure" dense>{Number(row.current_price).toLocaleString()}</Text> <Text role="caption">· currency unrecorded</Text></>}</td>
          <td><details className="market-notes"><summary><Text role="label">{row.event_status && row.event_status !== 'unknown' ? `Recorded ${row.event_status}` : 'Status unrecorded · evidence'}</Text></summary>
            <Text role="caption" as="div">Source ID {row.source_listing_id || 'unrecorded'}</Text><Text role="caption" as="div">Retained {clock(row.created_at)}</Text><Text role="caption" as="div">Record updated {clock(row.updated_at)}</Text><Text role="caption" as="div">Source observation time {row.source_observed_at ? clock(row.source_observed_at) : 'unrecorded'}</Text>
          </details></td>
        </tr>;
      })}</tbody>
    </table></div>
    {query.hasNextPage && <button type="button" className="market-control" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}><Text role="label">{query.isFetchingNextPage ? 'Reading more…' : 'Load more listings'}</Text></button>}
    <PrivateCaptureHistory source={source} />
  </section>;
}

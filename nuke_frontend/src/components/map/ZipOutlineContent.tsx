import { lazy, Suspense, useMemo } from 'react';
import { zipAreaRequest, type ZipMapReading } from './zipAreaGeometry';
import { ZipAreaActivity } from './ZipAreaActivity';
import './zip-outline-content.css';

const OneMap = lazy(() => import('./OneMap'));

/** Exact ZCTA outline within the caller's existing disclosure surface. */
export function ZipOutlineContent({ location }: { location: ZipMapReading }) {
  const area = zipAreaRequest(location);
  const focus = useMemo(() => area ? {
    countyFips: area.countyFips,
    geojsonPath: area.path,
    selectedZip: area.zip,
    label: `ZIP ${area.zip}`,
  } : null, [area?.countyFips, area?.path, area?.zip]);

  return <div className="zip-outline-content">
      {focus ? <Suspense fallback={<div className="zip-outline-content__loading">Opening ZIP area…</div>}>
        <OneMap focus={focus} />
      </Suspense> : <p>The location reader has no supported ZIP boundary for this record.</p>}
      {area && <p className="zip-outline-content__note">Census ZIP Code Tabulation Area outline.</p>}
      {area && <ZipAreaActivity zip={area.zip} />}
  </div>;
}

export type { ZipMapReading } from './zipAreaGeometry';

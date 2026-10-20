import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { useCountyData } from './hooks/useCountyData';
import { useStateData } from './hooks/useStateData';
import { COLORWAYS, ensureCountyNames, type ColorwayId } from './shared';
import { MAP_FONT } from './constants';
import type { ListingMeasure } from './mapService';

const ChoroplethMap = lazy(() => import('./ChoroplethMap'));

/** The map: new listings per county over the last 24 hours, 7 or 30 days (vehicle_map_county_listings). */
export default function CountyListingMap() {
  const urlDays = Number(new URLSearchParams(window.location.search).get('days'));
  const [days, setDays] = useState<number>([1, 7, 30].includes(urlDays) ? urlDays : 30);
  const [colorwayId, setColorwayId] = useState<ColorwayId>('amber');
  const listing = useMemo<ListingMeasure>(() => ({ eventType: 'listing', days }), [days]);

  const county = useCountyData(true, undefined, undefined, listing);
  const state = useStateData(true, undefined, undefined, listing);
  useEffect(() => { ensureCountyNames(); }, []);

  const onDaysChange = (d: number) => {
    setDays(d);
    const url = new URL(window.location.href);
    url.searchParams.set('days', String(d));
    window.history.replaceState(null, '', url);
  };

  const status = (text: string, color = 'rgba(245, 158, 11, 0.8)') => (
    <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 1010,
      background: 'rgba(0,0,0,0.7)', padding: '4px 10px', fontSize: 8, fontFamily: MAP_FONT, color, textTransform: 'uppercase' }}>
      {text}
    </div>
  );

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#111' }}>
      {county.stats && (
        <Suspense fallback={null}>
          <ChoroplethMap
            countyLayerData={county.layerData}
            stateLayerData={state.layerData}
            stats={county.stats}
            colorway={COLORWAYS[colorwayId]}
            colorwayId={colorwayId}
            onColorwayChange={setColorwayId}
            listings={{ days, onDaysChange }}
          />
        </Suspense>
      )}
      {(county.loading || state.loading) && status('LOADING...')}
      {county.error && status(county.error, 'white')}
    </div>
  );
}

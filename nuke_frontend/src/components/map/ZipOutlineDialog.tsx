import { lazy, Suspense, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { zipAreaRequest, type ZipMapReading } from './zipAreaGeometry';
import './zip-outline-dialog.css';

const OneMap = lazy(() => import('./OneMap'));

/** Opens the exact ZCTA boundary named by the vehicle location reader. */
export function ZipOutlineDialog({ location, onClose }: { location: ZipMapReading; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const area = zipAreaRequest(location);
  const focus = useMemo(() => area ? {
    countyFips: area.countyFips,
    geojsonPath: area.path,
    selectedZip: area.zip,
    label: `ZIP ${area.zip}`,
  } : null, [area?.countyFips, area?.path, area?.zip]);

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) {
      if (typeof element.showModal === 'function') element.showModal();
      else element.setAttribute('open', '');
    }
    return () => {
      if (element?.open && typeof element.close === 'function') element.close();
      if (trigger.current?.isConnected) trigger.current.focus();
    };
  }, []);

  return createPortal(<dialog ref={dialog} className="zip-outline-dialog" role="dialog" aria-modal="true"
    aria-label={area ? `ZIP ${area.zip} area map` : 'ZIP area map'}
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <header className="zip-outline-heading">
        <h2>{area ? `ZIP ${area.zip} area` : 'ZIP area unavailable'}</h2>
        <button type="button" autoFocus onClick={onClose} aria-label="Close ZIP map">×</button>
      </header>
      {focus ? <Suspense fallback={<div className="zip-outline-loading">Opening ZIP area…</div>}>
        <OneMap focus={focus} />
      </Suspense> : <p className="zip-outline-missing">The location reader has no supported ZIP boundary for this record.</p>}
      {area && <p className="zip-outline-footnote">Census ZIP Code Tabulation Area outline.</p>}
  </dialog>, document.body);
}

export type { ZipMapReading } from './zipAreaGeometry';

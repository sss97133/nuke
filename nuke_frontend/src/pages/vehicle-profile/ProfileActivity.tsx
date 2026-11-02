import React, { useEffect, useMemo, useRef, useState } from 'react';
import { HeaderPopover } from '../../components/vehicle/HeaderPopover';
import type { AuctionPulse } from './types';
import type { TimelineReadState } from './loadVehicleData';
import { isAuctionPresentation, hasFreshAuctionFeed, AUCTION_FEED_FRESH_MS } from './buildAuctionPulse';

type ActivityEvent = { id?: string; vehicle_id?: string; event_date?: string; event_type?: string; title?: string; is_superseded?: boolean; metadata?: { status?: string } };
const MEANINGFUL = /^(work|maintenance|repair|restoration|photo|image|sale|auction|bid|comment|purchase|ownership|transfer|inspection|mileage|service|communication)/;

export function elapsedActivity(iso: string, now: number): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const today = Date.parse(new Date(now).toISOString().slice(0, 10));
    const days = Math.max(0, Math.round((today - Date.parse(iso)) / 86400000));
    return days === 0 ? 'today' : `${days}d ago`;
  }
  const minutes = Math.max(0, Math.floor((now - Date.parse(iso)) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}

export function selectProfileActivity(vehicleId: string, events: ActivityEvent[], pulse: AuctionPulse | null, now: number) {
  const sourceAt = pulse?.source_observed_at;
  const sourceTime = sourceAt ? Date.parse(sourceAt) : NaN;
  const live = !!pulse && isAuctionPresentation(pulse) && hasFreshAuctionFeed(pulse.listing_status, pulse.end_date, sourceAt, now);
  const auctionEvents: ActivityEvent[] = pulse ? [
    { event_date: pulse.last_bid_at ?? undefined, event_type: 'bid', title: 'Recorded auction bid' },
    { event_date: pulse.last_comment_at ?? undefined, event_type: 'comment', title: 'Recorded auction comment' },
  ] : [];
  const latest = [...events, ...auctionEvents].filter(event => (!event.vehicle_id || event.vehicle_id === vehicleId) && !event.is_superseded
    && MEANINGFUL.test(event.event_type ?? '') && !['planned', 'cancelled', 'failed'].includes(event.metadata?.status ?? '')
    && event.event_date && Number.isFinite(Date.parse(event.event_date)) && Date.parse(event.event_date) <= now)
    .sort((a, b) => Date.parse(b.event_date!) - Date.parse(a.event_date!))[0];
  return { live, latest, sourceAt: Number.isFinite(sourceTime) ? sourceAt : null };
}

export default function ProfileActivity({ vehicleId, events, pulse, readState, open, onToggle, onClose, boundaryRef }: {
  vehicleId: string; events: ActivityEvent[]; pulse: AuctionPulse | null; readState?: TimelineReadState;
  open: boolean; onToggle: () => void; onClose: () => void; boundaryRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [now, setNow] = useState(Date.now);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    let timer: number;
    const tick = () => {
      const current = Date.now();
      const boundaries = [pulse?.end_date ? Date.parse(pulse.end_date) : NaN,
        pulse?.source_observed_at ? Date.parse(pulse.source_observed_at) + AUCTION_FEED_FRESH_MS + 1 : NaN];
      const next = Math.min(60_000, ...boundaries.filter(value => value > current).map(value => value - current));
      timer = window.setTimeout(() => { update(); tick(); }, next);
    };
    tick();
    document.addEventListener('visibilitychange', update);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', update); };
  }, [pulse?.end_date, pulse?.source_observed_at]);
  const activity = useMemo(() => selectProfileActivity(vehicleId, events, pulse, now), [vehicleId, events, pulse, now]);
  const at = activity.latest?.event_date;
  const incomplete = readState && Object.values(readState).some(state => state !== 'ready');
  const label = activity.live ? 'Live' : at ? `Active ${elapsedActivity(at, now)}` : incomplete ? 'Activity unavailable' : 'Activity undated';
  const age = at ? Math.max(0, now - Date.parse(at)) : 0;
  const tone = activity.live ? 'live' : age >= 30 * 86400000 ? 'older' : 'recorded';
  return <>
    <button ref={trigger} type="button" className="vp-profile-activity" data-tone={tone} aria-label={`Explore activity: ${label}`} aria-haspopup="dialog" aria-expanded={open} onClick={onToggle}>
      <span aria-hidden="true">●</span> {label}
    </button>
    {open && <HeaderPopover open title="Activity" align="right" width={440} onClose={() => { onClose(); trigger.current?.focus(); }} dismissBoundaryRef={boundaryRef}>
      <div className="vp-financial-panel">
        {activity.live ? <><h3>Live auction · {pulse?.platform}</h3><p>Source feed received {elapsedActivity(activity.sourceAt!, now)}. Live status expires when the recorded close passes or the source feed becomes stale.</p>
          <p>Recorded close: <time dateTime={pulse?.end_date ?? undefined}>{pulse?.end_date}</time></p></>
        : activity.latest ? <><h3>{activity.latest.title || activity.latest.event_type?.replace(/_/g, ' ') || 'Recorded activity'}</h3>
          <p><time dateTime={at}>{at}</time> · {activity.latest.event_type?.replace(/_/g, ' ')}</p>
          <p>Activity is dated by this record’s event date. Uploading or importing an older record does not make the underlying activity more recent.</p>
          {activity.latest.id && <details><summary>Record reference</summary><p>{activity.latest.id}</p></details>}
        </> : <p>No dated activity is available in the visible records.</p>}
        {incomplete && !activity.live && <p>Some activity reads are pending or unavailable. The visible record may not be the latest activity.</p>}
      </div>
    </HeaderPopover>}
  </>;
}

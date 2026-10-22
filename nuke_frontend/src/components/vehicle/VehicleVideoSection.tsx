import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { PriceBreakdownPopup, LotStatsPopup } from './VideoMomentPopups';
import { useVehicleVideos, type VideoMoment } from '../../hooks/useVehicleVideos';
import './vehicle-auction-replay.css';

interface VehicleVideoSectionProps {
  vehicleId: string;
  defaultCollapsed?: boolean;
}

function formatTimestamp(seconds: number): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return 'Unknown';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatDuration(start: number, end: number | null): string {
  if (typeof start !== 'number' || !Number.isFinite(start) || start < 0
    || typeof end !== 'number' || !Number.isFinite(end) || end < start) return 'Unknown';
  const seconds = end - start;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

function getVideoId(videoUrl: string): string {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/live\/([a-zA-Z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = videoUrl.match(pattern);
    if (match) return match[1];
  }
  return '';
}

function getThumbnailUrl(videoUrl: string): string {
  const videoId = getVideoId(videoUrl);
  if (!videoId) return '';
  // Use mqdefault for medium quality thumbnail
  return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
}

function getYouTubeEmbedUrl(videoUrl: string, startTime: number): string {
  const videoId = getVideoId(videoUrl);
  if (!videoId) return '';
  const seek = typeof startTime === 'number' && Number.isFinite(startTime) && startTime >= 0
    ? `start=${Math.floor(startTime)}&` : '';
  return `https://www.youtube.com/embed/${videoId}?${seek}autoplay=1&enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}`;
}

type ReplayPlayer = { getCurrentTime(): number; seekTo(time: number, ahead: boolean): void; pauseVideo?(): void; destroy(): void };
type YouTubeApi = { Player: new (frame: HTMLIFrameElement, options: { events: {
  onReady(event: { target: ReplayPlayer }): void; onError(): void;
} }) => ReplayPlayer };
let playerApi: Promise<YouTubeApi> | null = null;
function loadPlayerApi(): Promise<YouTubeApi> {
  const host = window as Window & { YT?: YouTubeApi; onYouTubeIframeAPIReady?: () => void };
  if (host.YT?.Player) return Promise.resolve(host.YT);
  if (!playerApi) playerApi = new Promise<YouTubeApi>((resolve, reject) => {
    const prior = host.onYouTubeIframeAPIReady;
    const timer = window.setTimeout(() => reject(new Error('Player connection unavailable')), 12000);
    host.onYouTubeIframeAPIReady = () => {
      prior?.(); window.clearTimeout(timer);
      if (host.YT?.Player) resolve(host.YT);
      else reject(new Error('Player API unavailable'));
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => { window.clearTimeout(timer); reject(new Error('Player connection unavailable')); };
    document.head.appendChild(script);
  }).catch(error => { playerApi = null; throw error; });
  return playerApi;
}

// Video Modal Component
const VideoModal: React.FC<{
  video: VideoMoment;
  vehicleId?: string;
  onClose: () => void;
}> = ({ video, vehicleId, onClose }) => {
  const [showPricePopup, setShowPricePopup] = useState(false);
  const [showLotPopup, setShowLotPopup] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const player = useRef<ReplayPlayer | null>(null);
  const [cursor, setCursor] = useState(video.broadcast_timestamp_start);
  const [connected, setConnected] = useState(false);
  const [connectionFailed, setConnectionFailed] = useState(false);
  const [comparisonScale, setComparisonScale] = useState<'amount' | 'gain'>('amount');
  const [comparisonId, setComparisonId] = useState<string | null>(null);
  const recordedAmount = typeof video.winning_bid === 'number' && Number.isFinite(video.winning_bid)
    && video.winning_bid > 0 && video.outcome === 'sold' ? video.winning_bid : null;
  const span = formatDuration(video.broadcast_timestamp_start, video.broadcast_timestamp_end);

  useEffect(() => {
    let cancelled = false;
    let clock: ReturnType<typeof setInterval> | undefined;
    loadPlayerApi().then(api => {
      if (cancelled || !frame.current) return;
      player.current = new api.Player(frame.current, { events: {
        onReady: ({ target }) => {
          if (cancelled) return;
          target.seekTo(video.broadcast_timestamp_start, true);
          setConnected(true);
          clock = setInterval(() => {
            const time = target.getCurrentTime();
            if (!Number.isFinite(time)) return;
            const end = video.broadcast_timestamp_end;
            if (end != null && Number.isFinite(end) && time >= end) {
              target.pauseVideo?.(); setCursor(end);
            } else setCursor(Math.max(video.broadcast_timestamp_start, time));
          }, 250);
        },
        onError: () => { if (!cancelled) { setConnected(false); setConnectionFailed(true); } },
      } });
    }).catch(() => { if (!cancelled) setConnectionFailed(true); });
    return () => { cancelled = true; clearInterval(clock); player.current?.destroy(); player.current = null; };
  }, [video.broadcast_video_url, video.broadcast_timestamp_start, video.broadcast_timestamp_end]);

  const bids = video.displayed_bids ?? [];
  const asks = video.displayed_asks ?? [];
  const start = video.broadcast_timestamp_start;
  const end = video.broadcast_timestamp_end;
  const hasReplay = (bids.length > 0 || asks.length > 0) && end != null && end > start;
  const availableComparisons = (video.comparison_presentations ?? []).filter(reference =>
    reference.id !== video.id && Number.isFinite(reference.start_seconds)
    && Number.isFinite(reference.end_seconds) && reference.end_seconds > reference.start_seconds
    && reference.displayed_bids.length > 0 && reference.displayed_bids.every(step =>
      Number.isFinite(step.t) && Number.isFinite(step.amount) && step.amount > 0
      && step.t >= reference.start_seconds && step.t <= reference.end_seconds));
  const comparisons = availableComparisons.filter(reference => reference.id === comparisonId);
  const elapsed = Math.max(0, cursor - start);
  const latest = (steps: typeof bids) => steps.filter(step => step.t <= cursor).at(-1);
  const bid = latest(bids), ask = latest(asks);
  const status = video.screen_status_changes?.filter(step => step.t <= cursor).at(-1);
  const terminalStatus = video.screen_status_changes?.filter(step => step.t <= cursor
    && ['sold', 'bid_goes_on', 'no_sale'].includes(step.status)).at(-1)?.status;
  const outcomeLabel = terminalStatus === 'bid_goes_on' ? 'Bid goes on · unsold on block'
    : terminalStatus === 'no_sale' ? 'No sale on block' : terminalStatus === 'sold' ? 'Sold shown on broadcast' : null;
  const duration = end != null ? Math.max(0, end - start) : 0;
  const referenceSteps = (reference: (typeof comparisons)[number]) => reference.displayed_bids.filter(step => step.t - reference.start_seconds <= duration);
  const gain = (amount: number, first?: number) => first && first > 0 ? 100 * (amount / first - 1) : 0;
  const scale = (amount: number, first?: number) => comparisonScale === 'gain' ? gain(amount, first) : amount;
  const subjectFirst = bids[0]?.amount;
  const chartValues = [...bids.map(step => scale(step.amount, subjectFirst)),
    ...asks.map(step => scale(step.amount, subjectFirst)), ...comparisons.flatMap(reference =>
      referenceSteps(reference).map(step => scale(step.amount, reference.displayed_bids[0]?.amount)))];
  const tick = comparisonScale === 'gain' ? 10 : 25000;
  const minimum = chartValues.length ? Math.floor(Math.min(comparisonScale === 'gain' ? 0 : Infinity, ...chartValues) / tick) * tick : 0;
  const maximum = Math.max(minimum + tick, Math.ceil(Math.max(1, ...chartValues) / tick) * tick);
  const x = (t: number) => 46 + (duration > 0 ? (t - start) / duration * 574 : 0);
  const y = (amount: number) => 126 - (amount - minimum) / (maximum - minimum) * 104;
  const axisLabel = (amount: number) => comparisonScale === 'gain' ? `${Math.round(amount)}%` : `${Math.round(amount / 1000)}k`;
  const path = (steps: typeof bids, first = subjectFirst, shift = 0, finish = end!) => steps.length ? steps.map((step, index) =>
    index ? `H${x(step.t + shift)}V${y(scale(step.amount, first))}` : `M${x(step.t + shift)},${y(scale(step.amount, first))}`).join(' ') + `H${x(finish)}` : '';
  const seek = (time: number) => { if (connected) { player.current?.seekTo(time, true); setCursor(time); } };
  const peer = comparisons[0];
  const peerNow = peer?.displayed_bids.filter(step => step.t - peer.start_seconds <= elapsed).at(-1);
  const difference = bid && peerNow ? 100 * (bid.amount / peerNow.amount - 1) : null;

  // Close on escape key
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !showPricePopup && !showLotPopup) onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose, showPricePopup, showLotPopup]);

  return ReactDOM.createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.9)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px'
      }}
    >
      <div
        className="vehicle-video-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '900px',
          background: 'var(--surface)'
        }}
      >
        {hasReplay && <header className="auction-replay__topbar">
          <span>{video.source.replace(/-/g, ' ')} · {video.auction_name} · Lot {video.lot_number}</span>
          <button type="button" onClick={onClose} aria-label="Close auction replay">×</button>
        </header>}
        {/* Video */}
        <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0 }}>
          <iframe
            ref={frame}
            src={getYouTubeEmbedUrl(video.broadcast_video_url, video.broadcast_timestamp_start)}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              border: 'none'
            }}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            title="Auction moment"
          />
        </div>

        {hasReplay && end != null && (
          <section className="auction-replay" aria-label="Auction data replay">
            <div className="auction-replay__readout">
              <div><strong>{bid ? `$${bid.amount.toLocaleString('en-US')}` : 'Bidding begins shortly'}</strong>
                {outcomeLabel && <span role="status" className="auction-replay__outcome">{outcomeLabel}</span>}
                {difference != null && peer && <span>{Math.abs(difference).toFixed(0)}% {difference < 0 ? 'below' : 'above'} {peer.lot} at +{Math.floor(elapsed)}s</span>}
              </div>
              {comparisons.length > 0 &&
              <div role="group" aria-label="Comparison scale">
                <button type="button" aria-pressed={comparisonScale === 'amount'} onClick={() => setComparisonScale('amount')}>USD</button>
                <button type="button" aria-pressed={comparisonScale === 'gain'} onClick={() => setComparisonScale('gain')}>% gain</button>
              </div>}
            </div>
            <svg viewBox="0 0 700 160" role="img" aria-label="Screen-bid comparison, aligned by elapsed lot time">
              {[minimum, maximum].map(amount => <g key={amount}>
                <text x="2" y={y(amount) + 4}>{axisLabel(amount)}</text>
                <line x1="46" y1={y(amount)} x2="620" y2={y(amount)} className="auction-replay__axis" />
              </g>)}
              {comparisons.map(reference => <path key={reference.id}
                d={path(referenceSteps(reference), reference.displayed_bids[0].amount, start - reference.start_seconds, start + Math.min(duration, reference.end_seconds - reference.start_seconds))}
                className="auction-replay__comparison" />)}
              <defs><clipPath id={`replay-${video.id}`}><rect x="46" y="0" width={Math.max(0, x(Math.min(cursor, end)) - 46)} height="140" /></clipPath></defs>
              <g clipPath={`url(#replay-${video.id})`}>
                <path d={path(bids)} className="auction-replay__bid" />
                <path d={path(asks)} className="auction-replay__ask" />
              </g>
              <line x1={x(Math.min(cursor, end))} x2={x(Math.min(cursor, end))} y1="16" y2="126" className="auction-replay__cursor" />
              {bid && <circle cx={x(Math.min(cursor, end))} cy={y(scale(bid.amount, subjectFirst))} r="3" className="auction-replay__bid-dot" />}
              {ask && <g><circle cx={x(Math.min(cursor, end))} cy={y(scale(ask.amount, subjectFirst))} r="4" className="auction-replay__ask-dot" />
                <text x={x(Math.min(cursor, end)) + 8} y={y(scale(ask.amount, subjectFirst)) - 7}>${Math.round(ask.amount / 1000)}k ask</text></g>}
              <text x="46" y="151">0s</text><text x="595" y="151">{Math.round(duration)}s</text>
              {peer && referenceSteps(peer).length > 0 && <text x="634" y={y(scale(referenceSteps(peer).at(-1)!.amount, peer.displayed_bids[0].amount)) + 4}>{peer.lot}</text>}
            </svg>
            <div className="auction-replay__scrubber">
              <input aria-label="Scrub auction replay" type="range" min={start} max={end} step="1" value={Math.min(end, Math.max(start, cursor))}
                disabled={!connected} onChange={event => seek(Number(event.target.value))} />
            </div>
            <div className="auction-replay__caption"><span className="auction-replay__subject-key">Lot {video.lot_number}</span>
              {peer && <span className="auction-replay__reference-key">{peer.title.replace(/ CHEVROLET CORVETTE /, ' Corvette ')} · {peer.lot}</span>}
              {status?.status === 'reserve_off' && <span>Reserve off</span>}
            </div>
            <details className="auction-replay__sources"><summary>Reference &amp; sources</summary>
              {availableComparisons.length > 0 && <label>Individual auction overlay
                <select aria-label="Individual auction overlay" value={comparisonId ?? ''} onChange={event => {
                  setComparisonId(event.target.value || null); setComparisonScale('amount');
                }}>
                  <option value="">None</option>
                  {availableComparisons.map(reference => <option key={reference.id} value={reference.id}>Lot {reference.lot} · {reference.title}</option>)}
                </select>
              </label>}
              {availableComparisons.map(reference => {
                return <article key={reference.id}>
                  <a href={reference.source_url} target="_blank" rel="noreferrer">Lot {reference.lot} · {reference.title} ↗</a>
                  <p>{reference.matching_basis}. {reference.differences}.</p>
                </article>;
              })}
              <p>Screen amounts are timed to the source video. Individual overlays align each lot's first visible overlay over this clip's duration; they do not establish a market benchmark. Configuration and fee basis are unmatched.</p>
              {outcomeLabel && <p>The displayed bid is not a sale price. A later negotiated sale is a separate event.</p>}
              <a href={`${video.broadcast_video_url}&t=${start}s`} target="_blank" rel="noreferrer">Original broadcast ↗</a>
            </details>
            {connectionFailed && <a href={`${video.broadcast_video_url}&t=${Math.floor(cursor)}s`} target="_blank" rel="noreferrer">Open this moment on YouTube ↗</a>}
          </section>
        )}

        {/* Info bar */}
        {!hasReplay && <div style={{ padding: '12px 16px', background: 'var(--surface-raised)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontWeight: 700, fontSize: '13px' }}>
                {video.source?.toUpperCase()}
              </span>
              {video.lot_number && (
                <button
                  onClick={() => setShowLotPopup(true)}
                  style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)', padding: '4px 8px',
                    cursor: 'pointer',
                    fontSize: '11px',
                    fontWeight: 600,
                    color: 'var(--accent)'
                  }}
                  title="View lot statistics"
                >
                  Lot {video.lot_number}
                </button>
              )}
              {video.auction_name && (
                <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                  {video.auction_name}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: '11px', fontFamily: "'Courier New', monospace", color: 'var(--text-muted)' }}>
                Video offset {formatTimestamp(video.broadcast_timestamp_start)} · recorded video span {span}
                {video.displayed_bid_changes ? ` · screen showed ${video.displayed_bid_changes} bid changes` : ''}
              </span>
              {recordedAmount !== null && (
                <button
                  onClick={() => setShowPricePopup(true)}
                  style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)', padding: '4px 10px',
                    cursor: 'pointer',
                    fontWeight: 700,
                    color: 'var(--text)',
                    fontSize: '13px'
                  }}
                  title="Inspect recorded auction amount"
                >
                  Recorded amount {recordedAmount.toLocaleString()}
                </button>
              )}
              <button
                onClick={onClose}
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)', padding: '4px 12px',
                  cursor: 'pointer',
                  fontSize: '11px'
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>}
      </div>

      {/* Price Breakdown Popup */}
      {showPricePopup && recordedAmount !== null && (
        <PriceBreakdownPopup
          recordedAmount={recordedAmount}
          estimateLow={video.estimate_low}
          estimateHigh={video.estimate_high}
          source={video.source}
          sourceUrl={video.source_url}
          lotNumber={video.lot_number}
          vehicleId={vehicleId}
          onClose={() => setShowPricePopup(false)}
        />
      )}

      {/* Lot Stats Popup */}
      {showLotPopup && video.lot_number && (
        <LotStatsPopup
          lotNumber={video.lot_number}
          source={video.source}
          videoOffset={formatTimestamp(video.broadcast_timestamp_start)}
          videoSpan={span}
          auctionName={video.auction_name}
          onClose={() => setShowLotPopup(false)}
        />
      )}
    </div>,
    document.body
  );
};

export const VehicleVideoSection: React.FC<VehicleVideoSectionProps> = ({
  vehicleId,
  defaultCollapsed = true
}) => {
  const { data: videos = [], isLoading: loading, isError, refetch } = useVehicleVideos(vehicleId);
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const [activeModal, setActiveModal] = useState<VideoMoment | null>(null);
  useEffect(() => { setActiveModal(null); }, [vehicleId]);

  if (loading) return null;
  if (isError) return <p role="alert">Could not load auction evidence. <button type="button" onClick={() => void refetch()}>Retry</button></p>;
  if (videos.length === 0) return null;

  return (
    <>
      {videos.some(video => video.timed_evidence_read_failed) && <p role="status">Some timed auction evidence could not be loaded. <button type="button" onClick={() => void refetch()}>Retry</button></p>}
      <div className={`card ${isCollapsed ? 'is-collapsed' : ''}`}>
        <div
          className="card-header"
          onClick={() => setIsCollapsed(!isCollapsed)}
          style={{
            cursor: 'pointer',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <span>VIDEO MOMENTS ({videos.length})</span>
          <span style={{
            fontSize: '10px',
            color: 'var(--text-muted)',
            transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s'
          }}>
            ▼
          </span>
        </div>

        {!isCollapsed && (
          <div className="card-body" style={{ padding: '8px' }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
              gap: '8px'
            }}>
              {videos.map((video) => {
                const span = formatDuration(video.broadcast_timestamp_start, video.broadcast_timestamp_end);
                const recordedAmount = typeof video.winning_bid === 'number' && Number.isFinite(video.winning_bid)
                  && video.winning_bid > 0 && video.outcome === 'sold' ? video.winning_bid : null;

                return (
                  <div
                    key={video.id}
                    onClick={() => setActiveModal(video)}
                    style={{
                      cursor: 'pointer', overflow: 'hidden',
                      background: 'var(--surface-raised)',
                      border: '1px solid var(--border)',
                      transition: 'transform 0.15s'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'scale(1.02)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'scale(1)';
                    }}
                  >
                    {/* Thumbnail with play overlay */}
                    <div style={{ position: 'relative', paddingBottom: '56.25%' }}>
                      <img
                        src={getThumbnailUrl(video.broadcast_video_url)}
                        alt="Video thumbnail"
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover'
                        }}
                      />
                      {/* Play button overlay */}
                      <div style={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        width: '36px',
                        height: '36px',
                        background: 'rgba(0,0,0,0.7)', display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}>
                        <div style={{
                          width: 0,
                          height: 0,
                          borderTop: '8px solid transparent',
                          borderBottom: '8px solid transparent',
                          borderLeft: '12px solid var(--bg)',
                          marginLeft: '3px'
                        }} />
                      </div>
                      {/* Recorded video offset badge */}
                      <div style={{
                        position: 'absolute',
                        bottom: '4px',
                        right: '4px',
                        background: 'rgba(0,0,0,0.8)',
                        color: 'var(--bg)',
                        padding: '2px 5px', fontSize: '9px',
                        fontFamily: "'Courier New', monospace"
                      }} title="Offset into recorded video">
                        {formatTimestamp(video.broadcast_timestamp_start)}
                      </div>
                    </div>

                    {/* Info */}
                    <div style={{ padding: '6px 8px' }}>
                      <div style={{
                        fontSize: '10px',
                        fontWeight: 600,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}>
                        <span>{video.lot_number || video.source?.toUpperCase()}</span>
                        {recordedAmount !== null && (
                          <span title="Recorded auction amount; currency and fee basis unknown">
                            {recordedAmount.toLocaleString()}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '2px' }}>
                        Recorded video span: {span}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Modal */}
      {activeModal && activeModal.vehicle_id === vehicleId && (
        <VideoModal
          video={activeModal}
          vehicleId={activeModal.vehicle_id || vehicleId}
          onClose={() => setActiveModal(null)}
        />
      )}
    </>
  );
};

export default VehicleVideoSection;

import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { supabase } from '../../lib/supabase';
import { PriceBreakdownPopup, LotStatsPopup } from './VideoMomentPopups';

interface VideoMoment {
  id: string;
  lot_number: string;
  source: string;
  auction_name: string | null;
  auction_start_date: string | null;
  winning_bid: number | null;
  outcome: string | null;
  broadcast_video_url: string;
  broadcast_timestamp_start: number;
  broadcast_timestamp_end: number | null;
  estimate_low: number | null;
  estimate_high: number | null;
  vehicle_id: string | null;
}

interface VehicleVideoSectionProps {
  vehicleId: string;
  defaultCollapsed?: boolean;
}

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatDuration(seconds: number): string {
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
  return `https://www.youtube.com/embed/${videoId}?start=${Math.floor(startTime)}&autoplay=1`;
}

// Video Modal Component
const VideoModal: React.FC<{
  video: VideoMoment;
  vehicleId?: string;
  onClose: () => void;
}> = ({ video, vehicleId, onClose }) => {
  const [showPricePopup, setShowPricePopup] = useState(false);
  const [showLotPopup, setShowLotPopup] = useState(false);
  const duration = (video.broadcast_timestamp_end || video.broadcast_timestamp_start + 60) - video.broadcast_timestamp_start;

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
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '900px',
          background: 'var(--surface)',
          borderRadius: '8px',
          overflow: 'hidden'
        }}
      >
        {/* Video */}
        <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0 }}>
          <iframe
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

        {/* Info bar */}
        <div style={{ padding: '12px 16px', background: 'var(--surface-raised)' }}>
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
                    border: '1px solid var(--border)',
                    borderRadius: '4px',
                    padding: '4px 8px',
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
              <span style={{ fontSize: '11px', fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                {formatTimestamp(video.broadcast_timestamp_start)} ({formatDuration(duration)})
              </span>
              {video.winning_bid && video.outcome === 'sold' && (
                <button
                  onClick={() => setShowPricePopup(true)}
                  style={{
                    background: 'var(--success-dim)',
                    border: '1px solid var(--success)',
                    borderRadius: '4px',
                    padding: '4px 10px',
                    cursor: 'pointer',
                    fontWeight: 700,
                    color: 'var(--success)',
                    fontSize: '13px'
                  }}
                  title="View price breakdown"
                >
                  ${video.winning_bid.toLocaleString()}
                </button>
              )}
              <button
                onClick={onClose}
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: '4px',
                  padding: '4px 12px',
                  cursor: 'pointer',
                  fontSize: '11px'
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Price Breakdown Popup */}
      {showPricePopup && video.winning_bid && (
        <PriceBreakdownPopup
          hammerPrice={video.winning_bid}
          estimateLow={video.estimate_low}
          estimateHigh={video.estimate_high}
          source={video.source}
          vehicleId={vehicleId}
          onClose={() => setShowPricePopup(false)}
        />
      )}

      {/* Lot Stats Popup */}
      {showLotPopup && video.lot_number && (
        <LotStatsPopup
          lotNumber={video.lot_number}
          source={video.source}
          broadcastStart={video.broadcast_timestamp_start}
          broadcastEnd={video.broadcast_timestamp_end}
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
  const [videos, setVideos] = useState<VideoMoment[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const [activeModal, setActiveModal] = useState<VideoMoment | null>(null);

  useEffect(() => {
    const fetchVideos = async () => {
      const { data, error } = await supabase
        .from('auction_events')
        .select(`
          id, lot_number, source, auction_name, auction_start_date,
          winning_bid, outcome, estimate_low, estimate_high, vehicle_id,
          broadcast_video_url, broadcast_timestamp_start, broadcast_timestamp_end
        `)
        .eq('vehicle_id', vehicleId)
        .not('broadcast_video_url', 'is', null)
        .not('broadcast_timestamp_start', 'is', null)
        .order('auction_start_date', { ascending: false });

      if (!error && data) {
        setVideos(data as VideoMoment[]);
      }
      setLoading(false);
    };

    fetchVideos();
  }, [vehicleId]);

  if (loading) {
    return (
      <div className="card">
        <div className="card-header" style={{ cursor: 'pointer' }}>
          VIDEO MOMENTS
        </div>
        <div className="card-body">
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '11px' }}>
            Loading...
          </div>
        </div>
      </div>
    );
  }

  if (videos.length === 0) {
    return null; // Don't show section if no videos
  }

  return (
    <>
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
                const duration = (video.broadcast_timestamp_end || video.broadcast_timestamp_start + 60) - video.broadcast_timestamp_start;

                return (
                  <div
                    key={video.id}
                    onClick={() => setActiveModal(video)}
                    style={{
                      cursor: 'pointer',
                      borderRadius: '6px',
                      overflow: 'hidden',
                      background: 'var(--surface-raised)',
                      border: '1px solid var(--border)',
                      transition: 'transform 0.15s, box-shadow 0.15s'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'scale(1.02)';
                      e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'scale(1)';
                      e.currentTarget.style.boxShadow = 'none';
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
                        background: 'rgba(0,0,0,0.7)',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}>
                        <div style={{
                          width: 0,
                          height: 0,
                          borderTop: '8px solid transparent',
                          borderBottom: '8px solid transparent',
                          borderLeft: '12px solid white',
                          marginLeft: '3px'
                        }} />
                      </div>
                      {/* Timestamp badge */}
                      <div style={{
                        position: 'absolute',
                        bottom: '4px',
                        right: '4px',
                        background: 'rgba(0,0,0,0.8)',
                        color: 'white',
                        padding: '2px 5px',
                        borderRadius: '3px',
                        fontSize: '9px',
                        fontFamily: 'monospace'
                      }}>
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
                        {video.winning_bid && video.outcome === 'sold' && (
                          <span style={{ color: 'var(--success)' }}>
                            ${(video.winning_bid / 1000).toFixed(0)}K
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '2px' }}>
                        {formatDuration(duration)} on block
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
      {activeModal && (
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

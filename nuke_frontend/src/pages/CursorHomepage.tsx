import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import VehicleCardDense from '../components/vehicles/VehicleCardDense';

interface HypeVehicle {
  id: string;
  year?: number;
  make?: string;
  model?: string;
  current_value?: number;
  purchase_price?: number;
  roi_pct?: number;
  image_count?: number;
  event_count?: number;
  activity_7d?: number;
  view_count?: number;
  primary_image_url?: string;
  hype_score?: number;
  hype_reason?: string;
  created_at?: string;
}

const CursorHomepage: React.FC = () => {
  const [hypeVehicles, setHypeVehicles] = useState<HypeVehicle[]>([]);
  const [feedVehicles, setFeedVehicles] = useState<HypeVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentHypeIndex, setCurrentHypeIndex] = useState(0);
  const [stats, setStats] = useState({
    totalBuilds: 0,
    totalValue: 0,
    soldThisMonth: 0,
    activeToday: 0
  });
  const navigate = useNavigate();
  const timerRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    loadHypeFeed();
  }, []);

  // Auto-rotate hype banner every 5 seconds
  useEffect(() => {
    if (hypeVehicles.length > 1) {
      timerRef.current = setInterval(() => {
        setCurrentHypeIndex((prev) => (prev + 1) % Math.min(hypeVehicles.length, 3));
      }, 5000);
      return () => clearInterval(timerRef.current);
    }
  }, [hypeVehicles.length]);

  const loadHypeFeed = async () => {
    try {
      setLoading(true);

      // Get vehicles with activity metrics
      const { data: vehicles, error } = await supabase
        .from('vehicles')
        .select(`
          id, year, make, model, current_value, purchase_price, view_count, created_at
        `)
        .eq('is_public', true)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      // Enrich with image/event counts and calculate hype scores
      const enriched = await Promise.all(
        (vehicles || []).map(async (v) => {
          const [imageCount, eventCount, recentActivity] = await Promise.all([
            supabase
              .from('vehicle_images')
              .select('id, image_url, thumbnail_url', { count: 'exact', head: false })
              .eq('vehicle_id', v.id)
              .eq('is_primary', true)
              .limit(1),
            supabase
              .from('timeline_events')
              .select('id', { count: 'exact', head: true })
              .eq('vehicle_id', v.id),
            supabase
              .from('timeline_events')
              .select('id', { count: 'exact', head: true })
              .eq('vehicle_id', v.id)
              .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
          ]);

          const roi = v.current_value && v.purchase_price
            ? ((v.current_value - v.purchase_price) / v.purchase_price) * 100
            : 0;

          // Calculate hype score
          const activity7d = recentActivity.count || 0;
          const totalImages = imageCount.count || 0;
          const age_hours = (Date.now() - new Date(v.created_at).getTime()) / (1000 * 60 * 60);
          const is_new = age_hours < 24;
          
          let hypeScore = 0;
          let hypeReason = '';

          // New and hot
          if (is_new && totalImages > 10) {
            hypeScore += 50;
            hypeReason = '🔥 JUST POSTED';
          }

          // High activity
          if (activity7d >= 5) {
            hypeScore += 30;
            hypeReason = hypeReason || '📈 ACTIVE BUILD';
          }

          // Big ROI
          if (roi > 100) {
            hypeScore += 40;
            hypeReason = hypeReason || `💰 ${roi.toFixed(0)}% GAIN`;
          }

          // Well documented
          if (totalImages > 100) {
            hypeScore += 20;
          }

          // High views
          if ((v.view_count || 0) > 20) {
            hypeScore += 15;
            hypeReason = hypeReason || '👁️ TRENDING';
          }

          return {
            ...v,
            image_count: totalImages,
            event_count: eventCount.count || 0,
            activity_7d: activity7d,
            roi_pct: roi,
            primary_image_url: imageCount.data?.[0]?.thumbnail_url || imageCount.data?.[0]?.image_url || null,
            hype_score: hypeScore,
            hype_reason: hypeReason || '📋 DOCUMENTED'
          };
        })
      );

      // Sort by hype score
      const sorted = enriched.sort((a, b) => (b.hype_score || 0) - (a.hype_score || 0));

      // Top 3 for hype banner
      setHypeVehicles(sorted.slice(0, 3));
      
      // Rest for feed
      setFeedVehicles(sorted.slice(3));

      // Calculate stats
      const totalValue = enriched.reduce((sum, v) => sum + (v.current_value || 0), 0);
      const activeCount = enriched.filter(v => (v.activity_7d || 0) > 0).length;

      setStats({
        totalBuilds: enriched.filter(v => (v.event_count || 0) > 0).length,
        totalValue: totalValue,
        soldThisMonth: 0,
        activeToday: activeCount
      });

    } catch (error) {
      console.error('Error loading hype feed:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (value: number) => {
    if (value >= 1000000) {
      return `$${(value / 1000000).toFixed(1)}M`;
    }
    if (value >= 1000) {
      return `$${(value / 1000).toFixed(0)}k`;
    }
    return `$${value.toLocaleString()}`;
  };

  const formatNumber = (value: number) => {
    if (value >= 1000) {
      return `${(value / 1000).toFixed(1)}k`;
    }
    return value.toString();
  };

  const currentHypeVehicle = hypeVehicles[currentHypeIndex];

  if (loading) {
    return (
      <div style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
        <div className="text">Loading the hype...</div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* Hype Banner - Top 3 Rotating */}
      {currentHypeVehicle && (
        <div
          onClick={() => navigate(`/vehicle/${currentHypeVehicle.id}`)}
          style={{
            position: 'relative',
            height: '400px',
            background: currentHypeVehicle.primary_image_url
              ? `linear-gradient(rgba(0,0,0,0.3), rgba(0,0,0,0.7)), url(${currentHypeVehicle.primary_image_url})`
              : 'linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            padding: 'var(--space-4)',
            borderBottom: '3px solid var(--border)',
            transition: 'transform 0.2s'
          }}
          onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.01)'}
          onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
        >
          {/* Hype Badge */}
          <div style={{
            position: 'absolute',
            top: '16px',
            left: '16px',
            background: '#ff0000',
            color: '#ffffff',
            padding: '8px 16px',
            fontSize: '12pt',
            fontWeight: 'bold',
            border: '2px solid #ffffff',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)'
          }}>
            {currentHypeVehicle.hype_reason}
          </div>

          {/* Pagination Dots */}
          {hypeVehicles.length > 1 && (
            <div style={{
              position: 'absolute',
              top: '16px',
              right: '16px',
              display: 'flex',
              gap: '8px'
            }}>
              {hypeVehicles.slice(0, 3).map((_, idx) => (
                <div
                  key={idx}
                  onClick={(e) => {
                    e.stopPropagation();
                    setCurrentHypeIndex(idx);
                    if (timerRef.current) clearInterval(timerRef.current);
                  }}
                  style={{
                    width: '12px',
                    height: '12px',
                    borderRadius: '50%',
                    background: idx === currentHypeIndex ? '#ffffff' : 'rgba(255,255,255,0.4)',
                    cursor: 'pointer',
                    border: '1px solid #ffffff'
                  }}
                />
              ))}
            </div>
          )}

          {/* Vehicle Info */}
          <div style={{ maxWidth: '800px' }}>
            <div style={{
              fontSize: '32pt',
              fontWeight: 'bold',
              color: '#ffffff',
              textShadow: '2px 2px 4px rgba(0,0,0,0.8)',
              marginBottom: '8px'
            }}>
              {currentHypeVehicle.year} {currentHypeVehicle.make} {currentHypeVehicle.model}
            </div>

            <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{
                fontSize: '24pt',
                fontWeight: 'bold',
                color: '#ffffff',
                textShadow: '2px 2px 4px rgba(0,0,0,0.8)'
              }}>
                {formatCurrency(currentHypeVehicle.current_value || 0)}
              </div>

              {currentHypeVehicle.roi_pct !== undefined && currentHypeVehicle.roi_pct !== 0 && (
                <div style={{
                  fontSize: '18pt',
                  fontWeight: 'bold',
                  color: currentHypeVehicle.roi_pct >= 0 ? '#00ff00' : '#ff0000',
                  textShadow: '2px 2px 4px rgba(0,0,0,0.8)'
                }}>
                  {currentHypeVehicle.roi_pct >= 0 ? '↑' : '↓'} {Math.abs(currentHypeVehicle.roi_pct).toFixed(0)}%
                </div>
              )}
            </div>

            <div style={{
              display: 'flex',
              gap: '24px',
              fontSize: '10pt',
              color: '#ffffff',
              textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
              marginBottom: '16px'
            }}>
              <span>{currentHypeVehicle.image_count} photos</span>
              <span>{currentHypeVehicle.event_count} events</span>
              <span>{currentHypeVehicle.view_count || 0} views</span>
              {currentHypeVehicle.activity_7d! > 0 && (
                <span>{currentHypeVehicle.activity_7d} updates this week</span>
              )}
            </div>

            {/* Quick Invest Buttons */}
            <div style={{ display: 'flex', gap: '12px' }}>
              {[10, 50, 100].map(amount => (
                <button
                  key={amount}
                  onClick={(e) => {
                    e.stopPropagation();
                    // TODO: Implement quick invest
                    alert(`Invest $${amount} - Coming soon!`);
                  }}
                  style={{
                    background: '#008000',
                    color: '#ffffff',
                    border: '2px outset #ffffff',
                    padding: '8px 16px',
                    fontSize: '10pt',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    fontFamily: '"MS Sans Serif", sans-serif'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#006400';
                    e.stopPropagation();
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = '#008000';
                  }}
                >
                  INVEST ${amount}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Stats Bar */}
      {stats.totalBuilds > 0 && (
        <div style={{
          background: 'var(--white)',
          borderBottom: '2px solid var(--border)',
          padding: '12px var(--space-4)',
          display: 'flex',
          gap: '32px',
          justifyContent: 'center',
          fontSize: '9pt',
          color: 'var(--text-muted)'
        }}>
          <span><strong>{stats.totalBuilds}</strong> active builds</span>
          <span><strong>{formatCurrency(stats.totalValue)}</strong> in play</span>
          {stats.activeToday > 0 && <span><strong>{stats.activeToday}</strong> updated today</span>}
        </div>
      )}

      {/* Feed Section */}
      <div style={{
        maxWidth: '1400px',
        margin: '0 auto',
        padding: 'var(--space-4)'
      }}>
        {/* Feed Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 'var(--space-3)'
        }}>
          <h2 style={{ fontSize: '12pt', fontWeight: 'bold', margin: 0 }}>
            What's Popping
          </h2>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
            {feedVehicles.length} vehicles · Updated just now
          </div>
        </div>

        {/* Feed Grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: 'var(--space-3)'
        }}>
          {feedVehicles.map((vehicle) => (
            <div
              key={vehicle.id}
              onClick={() => navigate(`/vehicle/${vehicle.id}`)}
              style={{
                background: 'var(--white)',
                border: '2px solid var(--border)',
                cursor: 'pointer',
                transition: 'all 0.2s',
                overflow: 'hidden'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--text)';
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '4px 4px 0 rgba(0,0,0,0.1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border)';
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              {/* Image */}
              {vehicle.primary_image_url ? (
                <div style={{
                  height: '200px',
                  backgroundImage: `url(${vehicle.primary_image_url})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  position: 'relative'
                }}>
                  {/* Hype Badge */}
                  {vehicle.hype_score! > 40 && (
                    <div style={{
                      position: 'absolute',
                      top: '8px',
                      left: '8px',
                      background: '#ff0000',
                      color: '#ffffff',
                      padding: '4px 8px',
                      fontSize: '8pt',
                      fontWeight: 'bold',
                      border: '1px solid #ffffff'
                    }}>
                      {vehicle.hype_reason}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{
                  height: '200px',
                  background: 'var(--grey-200)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-muted)',
                  fontSize: '8pt'
                }}>
                  No image
                </div>
              )}

              {/* Content */}
              <div style={{ padding: 'var(--space-2)' }}>
                <div style={{
                  fontSize: '10pt',
                  fontWeight: 'bold',
                  marginBottom: '8px'
                }}>
                  {vehicle.year} {vehicle.make} {vehicle.model}
                </div>

                {/* Price & ROI */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '8px'
                }}>
                  <div style={{ fontSize: '12pt', fontWeight: 'bold' }}>
                    {formatCurrency(vehicle.current_value || 0)}
                  </div>
                  {vehicle.roi_pct !== undefined && vehicle.roi_pct !== 0 && (
                    <div style={{
                      fontSize: '9pt',
                      fontWeight: 'bold',
                      color: vehicle.roi_pct >= 0 ? '#008000' : '#800000'
                    }}>
                      {vehicle.roi_pct >= 0 ? '↑' : '↓'} {Math.abs(vehicle.roi_pct).toFixed(0)}%
                    </div>
                  )}
                </div>

                {/* Stats */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr 1fr',
                  gap: '8px',
                  fontSize: '8pt',
                  color: 'var(--text-muted)',
                  marginBottom: '12px'
                }}>
                  <div>{vehicle.image_count} photos</div>
                  <div>{vehicle.event_count} events</div>
                  <div>{vehicle.view_count || 0} views</div>
                </div>

                {/* Quick Invest */}
                <div style={{ display: 'flex', gap: '8px' }}>
                  {[3, 10, 25].map(amount => (
                    <button
                      key={amount}
                      onClick={(e) => {
                        e.stopPropagation();
                        alert(`Invest $${amount} - Coming soon!`);
                      }}
                      style={{
                        flex: 1,
                        background: 'var(--grey-100)',
                        border: '1px outset var(--border)',
                        padding: '4px',
                        fontSize: '8pt',
                        cursor: 'pointer',
                        fontFamily: '"MS Sans Serif", sans-serif'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = '#008000';
                        e.currentTarget.style.color = '#ffffff';
                        e.stopPropagation();
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'var(--grey-100)';
                        e.currentTarget.style.color = 'var(--text)';
                      }}
                    >
                      ${amount}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>

        {feedVehicles.length === 0 && !loading && (
          <div style={{
            background: 'var(--white)',
            border: '2px solid var(--border)',
            padding: 'var(--space-8)',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '10pt', fontWeight: 'bold', marginBottom: '8px' }}>
              No vehicles yet
            </div>
            <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginBottom: '16px' }}>
              Be the first to add a build and start the hype train!
            </div>
            <button
              onClick={() => navigate('/add-vehicle')}
              style={{
                background: 'var(--text)',
                color: 'var(--white)',
                border: '2px outset var(--border)',
                padding: '8px 16px',
                fontSize: '9pt',
                cursor: 'pointer',
                fontFamily: '"MS Sans Serif", sans-serif'
              }}
            >
              Add Your First Vehicle
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default CursorHomepage;

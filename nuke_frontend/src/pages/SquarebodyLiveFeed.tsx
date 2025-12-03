import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import '../design-system.css';

interface SquarebodyVehicle {
  id: string;
  year: number;
  make: string;
  model: string;
  series?: string;
  asking_price?: number;
  location?: string;
  image_url?: string;
  created_at: string;
  discovery_source: string;
  discovery_url?: string;
}

const SquarebodyLiveFeed: React.FC = () => {
  const [vehicles, setVehicles] = useState<SquarebodyVehicle[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [stats, setStats] = useState({ today: 0, week: 0, month: 0 });
  const [loading, setLoading] = useState(true);
  const [showBanner, setShowBanner] = useState(false);
  const navigate = useNavigate();
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    loadSquarebodies();
    loadStats();
    
    // Subscribe to real-time updates for new squarebodies
    const channel = supabase
      .channel('squarebody_feed')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'vehicles',
          filter: 'make=in.(Chevrolet,GMC),year=gte.1973,year=lte.1991'
        },
        (payload) => {
          const newVehicle = payload.new as any;
          
          // Only add if it's a squarebody (C/K series truck)
          if (isSquarebody(newVehicle)) {
            handleNewSquarebody(newVehicle);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const isSquarebody = (vehicle: any): boolean => {
    const make = vehicle.make?.toLowerCase() || '';
    const model = vehicle.model?.toLowerCase() || '';
    const year = vehicle.year;
    
    // Must be Chevy or GMC
    if (!make.includes('chev') && !make.includes('gmc')) return false;
    
    // Must be 1973-1991
    if (year < 1973 || year > 1991) return false;
    
    // Must be a truck (not Suburban, Blazer, etc. - though K5 Blazer is borderline)
    const isSquarebodyModel = 
      model.includes('truck') ||
      model.includes('pickup') ||
      model.includes('c10') || model.includes('c20') || model.includes('c30') ||
      model.includes('k10') || model.includes('k20') || model.includes('k30') ||
      model.includes('c/k') ||
      model.includes('silverado') ||
      model.includes('cheyenne') ||
      model.includes('scottsdale') ||
      model.includes('custom deluxe') ||
      vehicle.series?.match(/[CK]\d{2,4}/i);
    
    return isSquarebodyModel;
  };

  const handleNewSquarebody = async (newVehicle: any) => {
    // Play notification sound
    playNotificationSound();
    
    // Increment pending count
    setPendingCount(prev => prev + 1);
    setShowBanner(true);
    
    // Update stats
    setStats(prev => ({ ...prev, today: prev.today + 1 }));
    
    // Auto-hide banner after 5 seconds
    setTimeout(() => {
      setShowBanner(false);
    }, 5000);
  };

  const loadPendingSquarebodies = async () => {
    // Reload vehicles and reset pending count
    await loadSquarebodies();
    setPendingCount(0);
    setShowBanner(false);
  };

  const playNotificationSound = () => {
    // Optional: play a subtle sound
    // audioRef.current?.play();
  };

  const loadSquarebodies = async () => {
    try {
      setLoading(true);
      
      // Query for squarebodies (1973-1991 Chevy/GMC trucks)
      const { data, error } = await supabase
        .from('vehicles')
        .select(`
          id,
          year,
          make,
          model,
          series,
          asking_price,
          location,
          created_at,
          discovery_source,
          discovery_url,
          vehicle_images!inner(
            image_url,
            is_primary
          )
        `)
        .in('make', ['Chevrolet', 'GMC', 'Chevy'])
        .gte('year', 1973)
        .lte('year', 1991)
        .neq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      // Filter to only trucks (no Suburbans, Blazers unless explicitly wanted)
      const squarebodies = (data || [])
        .filter((v: any) => isSquarebody(v))
        .map((v: any) => ({
          ...v,
          image_url: v.vehicle_images?.find((img: any) => img.is_primary)?.image_url || 
                     v.vehicle_images?.[0]?.image_url
        }));

      setVehicles(squarebodies);
    } catch (error) {
      console.error('Error loading squarebodies:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

      const { data, error } = await supabase
        .from('vehicles')
        .select('created_at')
        .in('make', ['Chevrolet', 'GMC', 'Chevy'])
        .gte('year', 1973)
        .lte('year', 1991);

      if (error) throw error;

      const statsData = {
        today: data.filter(v => new Date(v.created_at) >= today).length,
        week: data.filter(v => new Date(v.created_at) >= weekAgo).length,
        month: data.filter(v => new Date(v.created_at) >= monthAgo).length
      };

      setStats(statsData);
    } catch (error) {
      console.error('Error loading stats:', error);
    }
  };

  const formatTimeAgo = (timestamp: string) => {
    const now = new Date();
    const time = new Date(timestamp);
    const diffInMinutes = Math.floor((now.getTime() - time.getTime()) / (1000 * 60));

    if (diffInMinutes < 1) return 'Just now';
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours}h ago`;
    
    const diffInDays = Math.floor(diffInHours / 24);
    return `${diffInDays}d ago`;
  };

  if (loading) {
    return (
      <div style={{ background: 'var(--grey-100)', minHeight: '100vh', padding: 'var(--space-4)' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', paddingTop: 'var(--space-12)' }}>
            <p style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: 'var(--grey-100)', minHeight: '100vh', padding: 'var(--space-3)' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        
        {/* Header */}
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <div style={{ width: '6px', height: '6px', background: '#dc2626', animation: 'pulse 2s infinite' }} />
              <h1 style={{ fontSize: '8pt', fontWeight: 'bold', color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                LIVE: SQUAREBODY MARKET
              </h1>
            </div>
            <button
              onClick={() => navigate('/squarebody-market')}
              style={{ 
                padding: '4px 8px',
                background: 'var(--white)',
                border: '1px solid var(--border-medium)',
                fontSize: '8pt',
                cursor: 'pointer'
              }}
            >
              ANALYTICS
            </button>
          </div>
          
          {/* Stats Bar */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
            <div style={{ background: 'var(--white)', padding: 'var(--space-2)', border: '1px solid var(--border-light)' }}>
              <div style={{ fontSize: '8pt', fontWeight: 'bold', color: 'var(--text)' }}>{stats.today}</div>
              <div style={{ fontSize: '7pt', color: 'var(--text-muted)', textTransform: 'uppercase' }}>TODAY</div>
            </div>
            <div style={{ background: 'var(--white)', padding: 'var(--space-2)', border: '1px solid var(--border-light)' }}>
              <div style={{ fontSize: '8pt', fontWeight: 'bold', color: 'var(--text)' }}>{stats.week}</div>
              <div style={{ fontSize: '7pt', color: 'var(--text-muted)', textTransform: 'uppercase' }}>WEEK</div>
            </div>
            <div style={{ background: 'var(--white)', padding: 'var(--space-2)', border: '1px solid var(--border-light)' }}>
              <div style={{ fontSize: '8pt', fontWeight: 'bold', color: 'var(--text)' }}>{stats.month}</div>
              <div style={{ fontSize: '7pt', color: 'var(--text-muted)', textTransform: 'uppercase' }}>MONTH</div>
            </div>
          </div>

          {/* New Arrivals Banner */}
          {showBanner && pendingCount > 0 && (
            <div 
              onClick={loadPendingSquarebodies}
              style={{
                marginBottom: 'var(--space-3)',
                background: 'var(--text)',
                color: 'var(--white)',
                padding: 'var(--space-2)',
                cursor: 'pointer',
                border: '2px solid var(--text)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '8pt', fontWeight: 'bold', textTransform: 'uppercase' }}>
                  {pendingCount} NEW SQUAREBODY{pendingCount > 1 ? 'S' : ''} - CLICK TO VIEW
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Feed Grid */}
        {vehicles.length === 0 ? (
          <div style={{ textAlign: 'center', paddingTop: 'var(--space-12)' }}>
            <p style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>No squarebodies yet...</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 'var(--space-3)' }}>
            {vehicles.map((vehicle) => (
              <div
                key={vehicle.id}
                onClick={() => navigate(`/vehicles/${vehicle.id}`)}
                style={{
                  background: 'var(--white)',
                  border: '1px solid var(--border-light)',
                  cursor: 'pointer'
                }}
                className="hover-lift"
              >
                {/* Image */}
                {vehicle.image_url ? (
                  <div style={{ aspectRatio: '16/9', background: 'var(--grey-200)', overflow: 'hidden' }}>
                    <img
                      src={vehicle.image_url}
                      alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  </div>
                ) : (
                  <div style={{ aspectRatio: '16/9', background: 'var(--grey-200)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontSize: '24pt' }}>🚚</span>
                  </div>
                )}

                {/* Content */}
                <div style={{ padding: 'var(--space-2)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-1)', minHeight: '20px' }}>
                    <h3 style={{ fontSize: '8pt', fontWeight: 'bold', color: 'var(--text)', textTransform: 'uppercase', margin: 0, lineHeight: 1.2 }}>
                      {vehicle.year} {vehicle.make} {vehicle.model}
                    </h3>
                    {vehicle.series && (
                      <span style={{ 
                        padding: '2px 4px',
                        background: 'var(--grey-200)',
                        fontSize: '7pt',
                        fontWeight: 'bold',
                        color: 'var(--text)'
                      }}>
                        {vehicle.series}
                      </span>
                    )}
                  </div>

                  {vehicle.asking_price && (
                    <div style={{ fontSize: '8pt', fontWeight: 'bold', color: 'var(--text)', marginBottom: 'var(--space-1)' }}>
                      ${vehicle.asking_price.toLocaleString()}
                    </div>
                  )}

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '7pt', color: 'var(--text-muted)' }}>
                    <span>{vehicle.location || 'Location unknown'}</span>
                    <span>{formatTimeAgo(vehicle.created_at)}</span>
                  </div>

                  {vehicle.discovery_source === 'craigslist_scrape' && (
                    <div style={{ marginTop: 'var(--space-1)', paddingTop: 'var(--space-1)', borderTop: '1px solid var(--border-light)' }}>
                      <span style={{ fontSize: '6pt', color: 'var(--text-muted)', textTransform: 'uppercase' }}>CRAIGSLIST</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Optional: Notification sound (silent by default) */}
      <audio ref={audioRef} src="/notification.mp3" preload="auto" />
    </div>
  );
};

export default SquarebodyLiveFeed;


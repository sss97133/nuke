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
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-4 md:p-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-center py-20">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            <p className="mt-4 text-gray-600">Loading squarebodies...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="h-3 w-3 rounded-full bg-red-500 animate-pulse" />
              <h1 className="text-3xl font-bold text-gray-900">
                LIVE: Squarebody Market
              </h1>
            </div>
            <button
              onClick={() => navigate('/squarebody-market')}
              className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded-lg transition"
            >
              Analytics →
            </button>
          </div>
          
          {/* Stats Bar */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-white rounded-lg p-4 border-2 border-gray-200">
              <div className="text-2xl font-bold text-blue-600">{stats.today}</div>
              <div className="text-sm text-gray-600">Today</div>
            </div>
            <div className="bg-white rounded-lg p-4 border-2 border-gray-200">
              <div className="text-2xl font-bold text-blue-600">{stats.week}</div>
              <div className="text-sm text-gray-600">This Week</div>
            </div>
            <div className="bg-white rounded-lg p-4 border-2 border-gray-200">
              <div className="text-2xl font-bold text-blue-600">{stats.month}</div>
              <div className="text-sm text-gray-600">This Month</div>
            </div>
          </div>

          {/* New Arrivals Banner */}
          {showBanner && pendingCount > 0 && (
            <div 
              onClick={loadPendingSquarebodies}
              className="mb-4 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg p-4 cursor-pointer hover:from-blue-600 hover:to-blue-700 transition-all shadow-lg animate-slide-down"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-2 w-2 rounded-full bg-white animate-pulse" />
                  <span className="font-bold">
                    {pendingCount} new squarebody{pendingCount > 1 ? 's' : ''} just dropped!
                  </span>
                </div>
                <span className="text-sm opacity-90">Click to view →</span>
              </div>
            </div>
          )}
        </div>

        {/* Feed Grid */}
        {vehicles.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-2xl text-gray-400">No squarebodies yet...</p>
            <p className="text-gray-500 mt-2">Waiting for new trucks to arrive</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {vehicles.map((vehicle) => (
              <div
                key={vehicle.id}
                onClick={() => navigate(`/vehicles/${vehicle.id}`)}
                className="bg-white rounded-xl overflow-hidden border-2 border-gray-200 hover:border-blue-400 hover:shadow-xl transition-all cursor-pointer group"
              >
                {/* Image */}
                {vehicle.image_url ? (
                  <div className="aspect-video bg-gray-200 overflow-hidden">
                    <img
                      src={vehicle.image_url}
                      alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  </div>
                ) : (
                  <div className="aspect-video bg-gradient-to-br from-gray-200 to-gray-300 flex items-center justify-center">
                    <span className="text-6xl">🚚</span>
                  </div>
                )}

                {/* Content */}
                <div className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="font-bold text-lg text-gray-900 group-hover:text-blue-600 transition">
                      {vehicle.year} {vehicle.make} {vehicle.model}
                    </h3>
                    {vehicle.series && (
                      <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs font-bold rounded">
                        {vehicle.series}
                      </span>
                    )}
                  </div>

                  {vehicle.asking_price && (
                    <div className="text-2xl font-bold text-green-600 mb-2">
                      ${vehicle.asking_price.toLocaleString()}
                    </div>
                  )}

                  <div className="flex items-center justify-between text-sm text-gray-600">
                    <span>{vehicle.location || 'Location unknown'}</span>
                    <span className="font-medium">{formatTimeAgo(vehicle.created_at)}</span>
                  </div>

                  {vehicle.discovery_source === 'craigslist_scrape' && (
                    <div className="mt-2 pt-2 border-t border-gray-200">
                      <span className="text-xs text-gray-500">From Craigslist</span>
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


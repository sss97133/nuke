import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import SearchFilters from './feed/SearchFilters';
import ContentCard from './feed/ContentCard';
import '../design-system.css';

export interface FeedItem {
  id: string;
  type: 'vehicle' | 'timeline_event' | 'shop' | 'auction' | 'image' | 'user_activity';
  title: string;
  description: string;
  image_url?: string;
  images?: string[];
  user_id: string;
  user_name?: string;
  user_avatar?: string;
  location?: {
    lat: number;
    lng: number;
    address?: string;
  };
  metadata?: any;
  created_at: string;
  engagement?: {
    likes: number;
    comments: number;
    views: number;
  };
}

interface DiscoveryFeedProps {
  viewMode?: 'gallery' | 'compact' | 'technical';
  denseMode?: boolean;
  initialLocation?: { lat: number; lng: number };
}

const DiscoveryFeed = ({ viewMode: propViewMode = 'gallery', denseMode = false, initialLocation }: DiscoveryFeedProps) => {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState({
    contentTypes: ['all'] as string[],
    location: initialLocation,
    radius: 50, // miles
    dateRange: 'all' as 'today' | 'week' | 'month' | 'all',
    sortBy: 'recent' as 'recent' | 'popular' | 'nearby'
  });

  const observerRef = useRef<IntersectionObserver | null>(null);
  const lastItemRef = useCallback((node: HTMLDivElement | null) => {
    if (loading) return;
    if (observerRef.current) observerRef.current.disconnect();

    observerRef.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore) {
        setPage(prev => prev + 1);
      }
    });

    if (node) observerRef.current.observe(node);
  }, [loading, hasMore]);

  const fetchContent = useCallback(async (pageNum: number, reset: boolean = false) => {
    try {
      setLoading(true);

      const limit = 20;
      const offset = pageNum * limit;

      // Build the content query based on filters
      let feedItems: FeedItem[] = [];

      // Fetch timeline events (user actions)
      if (filters.contentTypes.includes('all') || filters.contentTypes.includes('timeline_event')) {
        const { data: timelineEvents, error: timelineError } = await supabase
          .from('vehicle_timeline_events')
          .select(`
            id,
            title,
            description,
            event_type,
            image_urls,
            user_id,
            vehicle_id,
            created_at,
            metadata,
            vehicles(
              id,
              year,
              make,
              model,
              color
            ),
            profiles(
              id,
              username,
              full_name,
              avatar_url
            )
          `)
          .order('created_at', { ascending: false })
          .range(Math.floor(offset/3), Math.floor(offset/3) + Math.floor(limit/3) - 1);

        if (!timelineError && timelineEvents) {
          const timelineItems: FeedItem[] = timelineEvents.map(event => ({
            id: event.id,
            type: 'timeline_event',
            title: event.title || `${event.event_type} Event`,
            description: event.description || '',
            images: event.image_urls || [],
            image_url: event.image_urls?.[0],
            user_id: event.user_id,
            user_name: (event.profiles as any)?.full_name || (event.profiles as any)?.username,
            user_avatar: (event.profiles as any)?.avatar_url,
            created_at: event.created_at,
            metadata: {
              ...event.metadata,
              event_type: event.event_type,
              vehicle: event.vehicles
            }
          }));
          feedItems.push(...timelineItems);
        }
      }

      // Fetch recent vehicles
      if (filters.contentTypes.includes('all') || filters.contentTypes.includes('vehicle')) {
        const { data: vehicles, error: vehiclesError } = await supabase
          .from('vehicles')
          .select(`
            id,
            year,
            make,
            model,
            color,
            description,
            created_at,
            uploaded_by,
            profiles(
              id,
              username,
              full_name,
              avatar_url
            ),
            vehicle_images(
              image_url,
              is_primary
            )
          `)
          .order('created_at', { ascending: false })
          .range(Math.floor(offset/3), Math.floor(offset/3) + Math.floor(limit/3) - 1);

        if (!vehiclesError && vehicles) {
          const vehicleItems: FeedItem[] = vehicles.map(vehicle => {
            // Get primary image or first available
            const images = (vehicle.vehicle_images as any) || [];
            const primaryImage = images.find((img: any) => img.is_primary)?.image_url || images[0]?.image_url;

            return {
              id: vehicle.id,
              type: 'vehicle',
              title: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
              description: vehicle.description || `${vehicle.color} ${vehicle.make} ${vehicle.model}`,
              image_url: primaryImage,
              user_id: vehicle.uploaded_by || '',
              user_name: (vehicle.profiles as any)?.full_name || (vehicle.profiles as any)?.username,
              user_avatar: (vehicle.profiles as any)?.avatar_url,
              created_at: vehicle.created_at,
              metadata: {
                year: vehicle.year,
                make: vehicle.make,
                model: vehicle.model,
                color: vehicle.color
              }
            };
          });

          // Batch fetch price signals for all vehicles via MV first, RPC fallback for misses
          if (vehicleItems.length > 0) {
            const vehicleIds = vehicleItems.map(v => v.id);
            try {
              // 1) Read from cached view
              const { data: cached, error: mvErr } = await supabase
                .from('vehicle_price_signal_view')
                .select('*')
                .in('vehicle_id', vehicleIds);

              const haveMap: Record<string, any> = {};
              if (!mvErr && Array.isArray(cached)) {
                (cached as any[]).forEach((s) => { if (s?.vehicle_id) haveMap[s.vehicle_id] = s; });
              }

              // 2) Determine misses and compute via RPC
              const missing = vehicleIds.filter(id => !haveMap[id]);
              if (missing.length > 0) {
                const { data: fresh, error: rpcErr } = await supabase.rpc('vehicle_price_signal', { vehicle_ids: missing });
                if (!rpcErr && Array.isArray(fresh)) {
                  (fresh as any[]).forEach((s) => { if (s?.vehicle_id) haveMap[s.vehicle_id] = s; });
                }
              }

              // 3) Attach to items
              vehicleItems.forEach(item => {
                const s = haveMap[item.id];
                if (s) item.metadata.priceSignal = s; // camelCase for UI
              });
            } catch (e) {
              console.debug('price signal enrichment skipped:', e);
            }
          }

          feedItems.push(...vehicleItems);
        }
      }

      // Fetch recent images with engagement
      if (filters.contentTypes.includes('all') || filters.contentTypes.includes('image')) {
        const { data: images, error: imagesError } = await supabase
          .from('vehicle_images')
          .select(`
            id,
            image_url,
            description,
            uploaded_by,
            created_at,
            gps_latitude,
            gps_longitude,
            profiles(
              id,
              username,
              full_name,
              avatar_url
            )
          `)
          .order('created_at', { ascending: false })
          .range(Math.floor(offset/3), Math.floor(offset/3) + Math.floor(limit/3) - 1);

        if (!imagesError && images) {
          const imageItems: FeedItem[] = images.map(image => ({
            id: image.id,
            type: 'image',
            title: 'Vehicle Image',
            description: image.description || 'New vehicle image shared',
            image_url: image.image_url,
            user_id: image.uploaded_by || '',
            user_name: (image.profiles as any)?.full_name || (image.profiles as any)?.username,
            user_avatar: (image.profiles as any)?.avatar_url,
            location: image.gps_latitude && image.gps_longitude ? {
              lat: image.gps_latitude,
              lng: image.gps_longitude
            } : undefined,
            created_at: image.created_at,
            engagement: {
              likes: 0, // Will be populated when implemented
              comments: 0,
              views: 0
            }
          }));
          feedItems.push(...imageItems);
        }
      }

      // Fetch shops
      if (filters.contentTypes.includes('all') || filters.contentTypes.includes('shop')) {
        const { data: shops, error: shopsError } = await supabase
          .from('shops')
          .select(`
            id,
            name,
            description,
            category,
            logo_url,
            created_at,
            created_by,
            city,
            state,
            profiles(
              id,
              username,
              full_name,
              avatar_url
            )
          `)
          .order('created_at', { ascending: false })
          .range(Math.floor(offset/4), Math.floor(offset/4) + Math.floor(limit/4) - 1);

        if (!shopsError && shops) {
          const shopItems: FeedItem[] = shops.map(shop => ({
            id: shop.id,
            type: 'shop',
            title: shop.name,
            description: shop.description || `${shop.category} business in ${shop.city}, ${shop.state}`,
            image_url: shop.logo_url,
            user_id: shop.created_by || '',
            user_name: (shop.profiles as any)?.full_name || (shop.profiles as any)?.username,
            user_avatar: (shop.profiles as any)?.avatar_url,
            created_at: shop.created_at,
            metadata: {
              category: shop.category,
              location: `${shop.city}, ${shop.state}`
            }
          }));
          feedItems.push(...shopItems);
        }
      }

      // Sort all items by created_at
      feedItems.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      if (reset) {
        setItems(feedItems);
      } else {
        setItems(prev => [...prev, ...feedItems]);
      }

      setHasMore(feedItems.length === limit);

    } catch (error) {
      console.error('Error fetching content:', error);
    } finally {
      setLoading(false);
    }
  }, [filters, searchQuery]);

  // Initial load and reload when filters change
  useEffect(() => {
    setPage(0);
    fetchContent(0, true);
  }, [filters, searchQuery]);

  // Load more when page changes
  useEffect(() => {
    if (page > 0) {
      fetchContent(page);
    }
  }, [page]);

  const handleFiltersChange = (newFilters: any) => {
    setFilters(newFilters);
  };

  // If using one of the original view modes, render the enhanced content
  if (propViewMode === 'gallery' || propViewMode === 'compact') {
    if (loading && items.length === 0) {
      return (
        <div style={{ textAlign: 'center', padding: '40px' }}>
          <div className="spinner"></div>
          <p className="text text-muted">Loading content...</p>
        </div>
      );
    }

    return (
      <div className="discovery-feed">
        {/* Enhanced Search Filters */}
        <SearchFilters
          searchQuery={searchQuery}
          filters={filters}
          onSearchChange={setSearchQuery}
          onFiltersChange={handleFiltersChange}
        />

        {/* Content Grid */}
        <div className="feed-grid" style={{
          display: 'grid',
          gap: propViewMode === 'compact' ? '12px' : '20px',
          gridTemplateColumns: propViewMode === 'compact'
            ? denseMode ? 'repeat(auto-fit, minmax(200px, 1fr))' : 'repeat(auto-fit, minmax(250px, 1fr))'
            : 'repeat(auto-fit, minmax(300px, 1fr))',
          marginTop: '24px'
        }}>
          {items.map((item, index) => (
            <div
              key={item.id}
              ref={index === items.length - 1 ? lastItemRef : null}
            >
              <ContentCard item={item} />
            </div>
          ))}
        </div>

        {loading && items.length > 0 && (
          <div style={{ textAlign: 'center', padding: '20px' }}>
            <div className="spinner"></div>
            <p className="text text-muted">Loading more content...</p>
          </div>
        )}

        {!hasMore && items.length > 0 && (
          <div style={{ textAlign: 'center', padding: '40px' }}>
            <p className="text text-muted">You've reached the end!</p>
          </div>
        )}

        {!loading && items.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px' }}>
            <p className="text text-muted">No content found. Try adjusting your filters.</p>
          </div>
        )}
      </div>
    );
  }

  // For technical view, keep the existing complex implementation
  return <LegacyDiscoveryFeed viewMode={propViewMode} denseMode={denseMode} />;
};

// Legacy component to maintain technical view functionality
const LegacyDiscoveryFeed = ({ viewMode, denseMode }: { viewMode?: string; denseMode?: boolean }) => {
  // ... keep the existing technical implementation here for now
  return (
    <div className="text-center" style={{ padding: '40px' }}>
      <p className="text text-muted">Technical view coming soon...</p>
    </div>
  );
};

export default DiscoveryFeed;
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import SearchFiltersComponent from './SearchFilters';
import ContentCard from './ContentCard';
import type { FeedItem, DiscoveryFeedProps, SearchFilters } from './types';
import '../../design-system.css';

const DiscoveryFeed = ({ viewMode = 'gallery', denseMode = false, initialLocation }: DiscoveryFeedProps) => {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<SearchFilters>({
    contentTypes: ['all'],
    location: initialLocation,
    radius: 50, // miles
    dateRange: 'all',
    sortBy: 'recent'
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

      console.log('Fetching content with filters:', filters, 'searchQuery:', searchQuery);

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
            metadata
          `)
          .order('created_at', { ascending: false })
          .range(offset, offset + limit - 1);

        if (!timelineError && timelineEvents) {
          const timelineItems: FeedItem[] = timelineEvents.map(event => ({
            id: event.id,
            type: 'timeline_event',
            title: event.title || `${event.event_type} Event`,
            description: event.description || '',
            images: event.image_urls || [],
            image_url: event.image_urls?.[0],
            user_id: event.user_id,
            user_name: undefined,
            user_avatar: undefined,
            created_at: event.created_at,
            metadata: {
              ...event.metadata,
              event_type: event.event_type,
              vehicle_id: event.vehicle_id
            }
          }));
          feedItems.push(...timelineItems);
        }
      }

      // Fetch recent vehicles
      if (filters.contentTypes.includes('all') || filters.contentTypes.includes('vehicle')) {
        console.log('Fetching vehicles...');

        let vehicleQuery = supabase
          .from('vehicles')
          .select(`
            id,
            year,
            make,
            model,
            vin,
            color,
            description,
            created_at,
            uploaded_by,
            msrp,
            current_value,
            purchase_price,
            asking_price,
            sale_price,
            is_for_sale,
            vehicle_images(
              image_url
            )
          `);

        // Add search filtering if query exists
        if (searchQuery && searchQuery.trim()) {
          const searchTerm = searchQuery.trim();
          vehicleQuery = vehicleQuery.or(`
            year::text.ilike.%${searchTerm}%,
            make.ilike.%${searchTerm}%,
            model.ilike.%${searchTerm}%,
            color.ilike.%${searchTerm}%,
            description.ilike.%${searchTerm}%
          `);
        }

        const { data: vehicles, error: vehiclesError } = await vehicleQuery
          .order('created_at', { ascending: false })
          .range(Math.floor(offset/2), Math.floor(offset/2) + Math.floor(limit/2) - 1);

        console.log('Vehicles response:', { vehicles, vehiclesError, count: vehicles?.length });

        if (!vehiclesError && vehicles) {
          const vehicleItems: FeedItem[] = vehicles.map(vehicle => ({
            id: vehicle.id,
            type: 'vehicle',
            title: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
            description: vehicle.description || `${vehicle.color} ${vehicle.make} ${vehicle.model}`,
            image_url: (vehicle.vehicle_images as any)?.[0]?.image_url,
            images: Array.isArray((vehicle as any).vehicle_images)
              ? ((vehicle as any).vehicle_images as any[]).map((vi: any) => vi?.image_url).filter(Boolean)
              : [],
            user_id: (vehicle as any).uploaded_by || '',
            user_name: undefined,
            user_avatar: undefined,
            created_at: vehicle.created_at,
            metadata: {
              year: vehicle.year,
              make: vehicle.make,
              model: vehicle.model,
              vin: (vehicle as any).vin,
              description: vehicle.description,
              color: vehicle.color,
              msrp: (vehicle as any).msrp,
              current_value: (vehicle as any).current_value,
              purchase_price: (vehicle as any).purchase_price,
              asking_price: (vehicle as any).asking_price,
              sale_price: (vehicle as any).sale_price,
              is_for_sale: (vehicle as any).is_for_sale
            }
          }));

          // Enrich with materialized view first, then RPC for misses (best-effort)
          try {
            const ids = vehicles.map((v: any) => v.id);
            if (ids.length > 0) {
              const haveMap: Record<string, any> = {};
              // 1) Cached view
              const { data: cached, error: mvErr } = await supabase
                .from('vehicle_price_signal_view')
                .select('*')
                .in('vehicle_id', ids);
              if (!mvErr && Array.isArray(cached)) {
                (cached as any[]).forEach((s: any) => { if (s?.vehicle_id) haveMap[s.vehicle_id] = s; });
              }
              // 2) RPC for misses
              const missing = ids.filter((id: string) => !haveMap[id]);
              if (missing.length > 0) {
                const { data: fresh, error: rpcErr } = await supabase.rpc('vehicle_price_signal', { vehicle_ids: missing });
                if (!rpcErr && Array.isArray(fresh)) {
                  (fresh as any[]).forEach((s: any) => { if (s?.vehicle_id) haveMap[s.vehicle_id] = s; });
                }
              }
              // 3) Attach
              vehicleItems.forEach(it => {
                const s = haveMap[it.id];
                if (s) {
                  (it as any).metadata.priceSignal = s; // camelCase for UI
                }
              });
            }
          } catch (e) {
            console.debug('price signal enrichment skipped:', e);
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
            vehicle_id,
            image_url,
            caption,
            user_id,
            created_at,
            latitude,
            longitude
          `)
          .order('created_at', { ascending: false })
          .range(Math.floor(offset/3), Math.floor(offset/3) + Math.floor(limit/3) - 1);

        if (!imagesError && images) {
          const imageItems: FeedItem[] = images.map(image => ({
            id: image.id,
            type: 'image',
            title: 'Vehicle Image',
            description: (image as any).caption || 'New vehicle image shared',
            image_url: image.image_url,
            user_id: (image as any).user_id || '',
            user_name: undefined,
            user_avatar: undefined,
            location: (image as any).latitude && (image as any).longitude ? {
              lat: (image as any).latitude,
              lng: (image as any).longitude
            } : undefined,
            created_at: image.created_at,
            engagement: undefined,
            metadata: { vehicle_id: (image as any).vehicle_id }
          }));
          feedItems.push(...imageItems);
        }
      }

      // Attach profile username/avatar for attribution
      try {
        const ids = Array.from(new Set(feedItems.map(i => i.user_id).filter(Boolean)));
        if (ids.length > 0) {
          const { data: profiles, error: pErr } = await supabase
            .from('profiles')
            .select('id, username, avatar_url')
            .in('id', ids);
          if (!pErr && Array.isArray(profiles)) {
            const pmap: Record<string, { id: string; username?: string; avatar_url?: string }> = {};
            (profiles as any[]).forEach((p: any) => { if (p?.id) pmap[p.id] = p; });
            feedItems = feedItems.map(it => ({
              ...it,
              user_name: pmap[it.user_id]?.username ?? it.user_name,
              user_avatar: pmap[it.user_id]?.avatar_url ?? it.user_avatar,
            }));
          }
        }
      } catch (e) {
        console.debug('profile enrichment skipped:', e);
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
  }, [filters]);

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

  const handleFiltersChange = (newFilters: SearchFilters) => {
    setFilters(newFilters);
  };

  if (loading && items.length === 0) {
    return (
      <div className="layout">
        <div className="container">
          <div className="main">
            <div style={{ textAlign: 'center', padding: '40px' }}>
              <div className="spinner"></div>
              <p className="text text-muted">Loading content...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="layout compact">
      <div className="container compact">
        <div className="main">
          <div style={{ marginBottom: '12px' }}>
            <h1 className="heading-1">Discover</h1>
          </div>

          <SearchFiltersComponent
            searchQuery={searchQuery}
            filters={filters}
            onSearchChange={setSearchQuery}
            onFiltersChange={handleFiltersChange}
          />

          <div className="feed-grid" style={{
            display: 'grid',
            gap: viewMode === 'compact' ? '4px' : '8px',
            gridTemplateColumns: 
              viewMode === 'gallery' ? 'repeat(auto-fill, minmax(280px, 1fr))' :
              viewMode === 'compact' ? 'repeat(auto-fill, minmax(200px, 1fr))' :
              '1fr', // technical = full width list
            marginTop: '8px'
          }}>
            {items.map((item, index) => (
              <div
                key={item.id}
                ref={index === items.length - 1 ? lastItemRef : null}
              >
                <ContentCard item={item} viewMode={viewMode} denseMode={denseMode} />
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
      </div>
    </div>
  );
};

export default DiscoveryFeed;
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

      console.log('Fetching vehicles with filters:', filters, 'searchQuery:', searchQuery);

      // Build vehicle query - ONLY VEHICLES, no timeline events or images
      let vehicleQuery = supabase
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
        .range(offset, offset + limit - 1);

      console.log('Vehicles response:', { vehicles, vehiclesError, count: vehicles?.length });

      let feedItems: FeedItem[] = [];

      if (!vehiclesError && vehicles) {
        const vehicleItems: FeedItem[] = vehicles.map(vehicle => ({
          id: vehicle.id,
          type: 'vehicle',
          title: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
          description: vehicle.description || `${vehicle.color} ${vehicle.make} ${vehicle.model}`,
          image_url: (vehicle.vehicle_images as any)?.[0]?.image_url,
          user_id: (vehicle as any).uploaded_by || '',
          user_name: undefined,
          user_avatar: undefined,
          created_at: vehicle.created_at,
          metadata: {
            year: vehicle.year,
            make: vehicle.make,
            model: vehicle.model,
            color: vehicle.color,
            msrp: (vehicle as any).msrp,
            current_value: (vehicle as any).current_value,
            purchase_price: (vehicle as any).purchase_price,
            asking_price: (vehicle as any).asking_price,
            sale_price: (vehicle as any).sale_price,
            is_for_sale: (vehicle as any).is_for_sale
          }
        }));

        // Enrich with price signals
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
                (it as any).metadata.priceSignal = s;
              }
            });
          }
        } catch (e) {
          console.debug('price signal enrichment skipped:', e);
        }
        feedItems = vehicleItems;
      }

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
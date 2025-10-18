import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import AppLayout from '../components/layout/AppLayout';
import VehicleThumbnail from '../components/VehicleThumbnail';
import { FeedService, type FeedItem } from '../services/feedService';
import '../design-system.css';

const LiveFeed: React.FC = () => {
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<any>(null);
  const navigate = useNavigate();

  // Check authentication status
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });
  }, []);

  useEffect(() => {
    loadFeedItems();
    
    // Subscribe to real-time feed updates
    const subscription = FeedService.subscribeToFeedUpdates((newItem) => {
      setFeedItems(prev => [newItem, ...prev]);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const loadFeedItems = async () => {
    try {
      setLoading(true);
      
      // Query vehicles with their primary images (left join to include vehicles without images)
      const { data: vehicles, error } = await supabase
        .from('vehicles')
        .select(`
          *,
          vehicle_images(
            image_url,
            is_primary
          )
        `)
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) {
        console.error('Error fetching vehicles:', error);
        setFeedItems([]);
        return;
      }

      if (!vehicles || vehicles.length === 0) {
        setFeedItems([]);
        return;
      }

      const feedItems: FeedItem[] = vehicles.map((vehicle: any) => ({
        id: `vehicle_${vehicle.id}`,
        type: 'new_vehicle' as const,
        title: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
        description: vehicle.description || 'Added to database',
        timestamp: vehicle.created_at,
        user_id: vehicle.user_id,
        username: undefined,
        vehicle_id: vehicle.id,
        metadata: {
          make: vehicle.make,
          model: vehicle.model,
          year: vehicle.year,
          color: vehicle.color,
          mileage: vehicle.mileage,
          vin: vehicle.vin,
          primaryImageUrl: vehicle.vehicle_images?.find((img: any) => img.is_primary)?.image_url || vehicle.vehicle_images?.[0]?.image_url,
          isForSale: vehicle.is_for_sale,
          salePrice: vehicle.sale_price
        },
        priority: 1
      }));

      setFeedItems(feedItems);
    } catch (error) {
      console.error('Error loading feed:', error);
      setFeedItems([]);
    } finally {
      setLoading(false);
    }
  };

  const formatTimeAgo = (timestamp: string) => {
    const now = new Date();
    const time = new Date(timestamp);
    const diffInMinutes = Math.floor((now.getTime() - time.getTime()) / (1000 * 60));

    if (diffInMinutes < 60) {
      return `${diffInMinutes}m ago`;
    } else if (diffInMinutes < 1440) {
      return `${Math.floor(diffInMinutes / 60)}h ago`;
    } else {
      return `${Math.floor(diffInMinutes / 1440)}d ago`;
    }
  };

  const getFeedTypeIcon = (type: string) => {
    switch (type) {
      case 'new_vehicle':
        return 'CAR';
      case 'timeline_event':
        return 'TIME';
      case 'new_images':
        return 'IMG';
      case 'skynalysis_result':
        return 'DATA';
      default:
        return 'NEWS';
    }
  };

  const getFeedTypeLabel = (type: string) => {
    switch (type) {
      case 'new_vehicle':
        return 'New Vehicle';
      case 'timeline_event':
        return 'Timeline Event';
      case 'new_images':
        return 'New Images';
      case 'skynalysis_result':
        return 'Skynalysis';
      case 'vehicle_update':
        return 'Vehicle Update';
      default:
        return 'Update';
    }
  };

  if (loading) {
    return (
      <AppLayout title="Loading...">
        <div className="section">
          <div className="card">
            <div className="card-body text-center">
              <div className="text text-muted">Loading your feed...</div>
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Nuke Live Feed">
      <div className="fade-in">
        {/* Discovery Welcome for Non-Authenticated Users */}
        {!session && (
          <section className="section">
            <div className="card">
              <div className="card-body text-center" style={{ padding: '24px' }}>
                <p className="text-small text-muted" style={{ marginBottom: '16px' }}>
                  Join to participate in the vehicle community
                </p>
                <div className="flex justify-center gap-3">
                  <a href="/login" className="button button-primary">
                    Join Community
                  </a>
                  <a href="/vehicles" className="button button-secondary button-small">
                    Browse Vehicles
                  </a>
                </div>
              </div>
            </div>
          </section>
        )}


        {/* Feed Items */}
        <section className="section">
          {feedItems.length === 0 ? (
            <div className="card">
              <div className="card-body text-center py-12">
                <p className="text-gray-600 mb-6">
                  {session 
                    ? "Add a vehicle to see activity"
                    : "Join to see community activity"
                  }
                </p>
                {session ? (
                  <a href="/vehicles" className="btn btn-primary">View Vehicles</a>
                ) : (
                  <div className="flex justify-center gap-3">
                    <a href="/login" className="button button-primary">Join Community</a>
                    <a href="/all-vehicles" className="button button-secondary">Browse Vehicles</a>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div 
              style={{ 
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: '8px',
                padding: '8px'
              }}
            >
              {feedItems.map((item) => (
                <div 
                  key={item.id} 
                  className="bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden"
                  style={{ 
                    width: '100%',
                    minHeight: 'fit-content'
                  }}
                >
                  {/* Vehicle Image */}
                  <div className="aspect-[4/3] bg-gray-100 relative">
                    {item.metadata?.primaryImageUrl ? (
                      <img
                        src={item.metadata.primaryImageUrl}
                        alt={item.title}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          console.log('Image failed to load:', item.metadata.primaryImageUrl);
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    ) : null}
                    
                    {/* Fallback when no image or image fails */}
                    {!item.metadata?.primaryImageUrl && (
                      <div className="w-full h-full flex items-center justify-center bg-gray-200">
                        <div className="text-center">
                          <div className="text-2xl font-bold text-gray-400" style={{ marginBottom: '8px' }}>
                            {item.metadata?.make?.[0] || 'V'}
                          </div>
                          <div className="text-xs text-gray-500">No Image</div>
                        </div>
                      </div>
                    )}
                    
                    {/* Status Badge */}
                    <div className="absolute" style={{ top: '4px', left: '4px' }}>
                      <span 
                        className="text-xs bg-blue-600 text-white rounded"
                        style={{ padding: '2px 6px' }}
                      >
                        {item.type === 'new_vehicle' ? 'New Vehicle' : 
                         item.type === 'timeline_event' ? 'Timeline Event' :
                         item.type === 'new_images' ? 'New Image' : 'Analysis'}
                      </span>
                    </div>
                    
                    {/* Sale Badge */}
                    {item.metadata?.isForSale && (
                      <div className="absolute" style={{ top: '4px', right: '4px' }}>
                        <span 
                          className="text-xs bg-green-600 text-white rounded"
                          style={{ padding: '2px 6px' }}
                        >
                          For Sale
                        </span>
                      </div>
                    )}
                  </div>
                  
                  {/* Content with DSG 8pt spacing */}
                  <div style={{ padding: '8px' }}>
                    <div style={{ marginBottom: '8px' }}>
                      <div className="text-xs text-gray-500" style={{ marginBottom: '8px' }}>
                        {formatTimeAgo(item.timestamp)} ago
                      </div>
                      
                      <h3 className="font-semibold text-gray-900 text-sm leading-tight" style={{ marginBottom: '8px' }}>
                        {item.title}
                      </h3>
                      
                      <p className="text-xs text-gray-600" style={{ marginBottom: '8px' }}>
                        {item.description}
                      </p>
                    </div>
                    
                    {/* Vehicle Details */}
                    <div className="text-xs" style={{ marginBottom: '8px' }}>
                      {item.metadata?.color && (
                        <div className="flex justify-between" style={{ marginBottom: '4px' }}>
                          <span className="text-gray-500">Color:</span>
                          <span className="text-gray-900">{item.metadata.color}</span>
                        </div>
                      )}
                      
                      {item.metadata?.mileage && (
                        <div className="flex justify-between" style={{ marginBottom: '4px' }}>
                          <span className="text-gray-500">Mileage:</span>
                          <span className="text-gray-900">{item.metadata.mileage.toLocaleString()} mi</span>
                        </div>
                      )}
                      
                      {item.metadata?.vin && (
                        <div className="flex justify-between" style={{ marginBottom: '4px' }}>
                          <span className="text-gray-500">VIN:</span>
                          <span className="text-gray-900 font-mono text-xs">
                            {item.metadata.vin.slice(-6)}
                          </span>
                        </div>
                      )}
                      
                      {item.metadata?.salePrice && (
                        <div className="flex justify-between" style={{ marginBottom: '4px' }}>
                          <span className="text-gray-500">Price:</span>
                          <span className="text-green-600 font-semibold">
                            ${item.metadata.salePrice.toLocaleString()}
                          </span>
                        </div>
                      )}
                    </div>
                    
                    {/* Action Button */}
                    <button 
                      className="w-full text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded transition-colors"
                      style={{ padding: '8px' }}
                      onClick={() => window.location.href = `/vehicle/${item.vehicle_id}`}
                    >
                      View Details
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Load More */}
          {feedItems.length > 0 && (
            <div className="text-center mt-8">
              <button className="btn btn-secondary">
                Load More Feed Items
              </button>
            </div>
          )}
        </section>
      </div>
    </AppLayout>
  );
};

export default LiveFeed;


import React from 'react';
import { ContentCard } from '../content/ContentCard';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Compass } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Skeleton } from '@/components/ui/skeleton';

interface DiscoverFeedProps {
  filter: string;
}

export const DiscoverFeed = ({ filter }: DiscoverFeedProps) => {
  const { data, isLoading } = useQuery({
    queryKey: ['discover-feed', filter],
    queryFn: async () => {
      // Try to get data from Supabase
      const adjustedFilter = 
        filter === 'vehicles' ? 'vehicle' : 
        filter === 'auctions' ? 'auction' : 
        filter === 'events' ? 'event' : 
        filter === 'garages' ? 'garage' : filter;
      
      const query = supabase
        .from('explore_content')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(9);
      
      // Apply filter if not 'all'
      if (adjustedFilter !== 'all') {
        query.eq('type', adjustedFilter);
      }
      
      const { data, error } = await query;
      
      if (error || !data || data.length === 0) {
        console.log('Falling back to mock discover feed data');
        // Fallback to mock data
        return [
          {
            id: '1',
            type: 'vehicle',
            title: 'Vintage Volkswagen Microbus',
            subtitle: 'Fully restored classic',
            image: 'https://images.unsplash.com/photo-1550616543-4f6b3d16c38e?auto=format&fit=crop&w=600&q=80',
            tags: ['Vintage', 'Collector', 'Iconic'],
            reason: 'Expand your knowledge of classic vehicles',
            location: 'Portland, OR',
            relevanceScore: 75
          },
          {
            id: '2',
            type: 'event',
            title: 'Off-Road Adventure Day',
            subtitle: 'Experience extreme terrain driving',
            image: 'https://images.unsplash.com/photo-1697527025456-c79ab0a15ab5?auto=format&fit=crop&w=600&q=80',
            tags: ['Off-road', 'Adventure', 'Experience'],
            reason: 'Something different you might enjoy',
            location: 'Moab, UT',
            relevanceScore: 72
          },
          {
            id: '3',
            type: 'garage',
            title: 'Classic Restorations',
            subtitle: 'Specializing in vintage vehicle restoration',
            image: 'https://images.unsplash.com/photo-1607603750909-408e193868c7?auto=format&fit=crop&w=600&q=80',
            tags: ['Restoration', 'Vintage', 'Craftsmanship'],
            reason: 'Discover master craftspeople in automotive restoration',
            location: 'Charleston, SC',
            relevanceScore: 68
          },
          {
            id: '4',
            type: 'auction',
            title: 'Motorcycle Collection Auction',
            subtitle: 'Rare vintage motorcycles',
            image: 'https://images.unsplash.com/photo-1558981806-ec527fa84c39?auto=format&fit=crop&w=600&q=80',
            tags: ['Motorcycles', 'Vintage', 'Collection'],
            reason: 'Broaden your automotive interests',
            location: 'Milwaukee, WI',
            relevanceScore: 65
          },
          {
            id: '5',
            type: 'vehicle',
            title: 'Custom Hot Rod',
            subtitle: 'Award-winning custom build',
            image: 'https://images.unsplash.com/photo-1637511180523-99be8034700c?auto=format&fit=crop&w=600&q=80',
            tags: ['Custom', 'Hot Rod', 'Unique'],
            reason: 'Explore custom automotive culture',
            location: 'Las Vegas, NV',
            relevanceScore: 62
          }
        ].filter(item => filter === 'all' || item.type === adjustedFilter);
      }
      
      // Transform data to match ContentCardItem format
      return data.map(item => ({
        id: item.id,
        type: item.type,
        title: item.title,
        subtitle: item.subtitle,
        image: item.image_url,
        tags: item.tags || [],
        reason: item.reason || 'Discover something new',
        location: item.location,
        relevanceScore: item.relevance_score
      }));
    }
  });
  
  // Loading state with skeleton UI
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Compass className="h-5 w-5 text-purple-500" />
          <h3 className="text-xl font-medium">Discover Something New</h3>
          <span className="text-sm text-muted-foreground">
            (Loading...)
          </span>
        </div>
        
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {Array(6).fill(0).map((_, index) => (
            <div key={index} className="bg-muted/30 rounded-lg overflow-hidden">
              <Skeleton className="h-48 w-full" />
              <div className="p-4 space-y-3">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <div className="flex gap-1 flex-wrap">
                  {Array(3).fill(0).map((_, i) => (
                    <Skeleton key={i} className="h-4 w-16 rounded-full" />
                  ))}
                </div>
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  
  if (!data || data.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">No discovery content found for the selected filter.</p>
      </div>
    );
  }
  
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Compass className="h-5 w-5 text-purple-500" />
        <h3 className="text-xl font-medium">Discover Something New</h3>
        <span className="text-sm text-muted-foreground">
          ({data.length} items)
        </span>
      </div>
      
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {data.map(item => (
          <ContentCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
};

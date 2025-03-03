
import React from 'react';
import { ContentCard } from '../content/ContentCard';
import { useQuery } from '@tanstack/react-query';
import { Loader2, TrendingUp } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Skeleton } from '@/components/ui/skeleton';

interface TrendingFeedProps {
  filter: string;
}

export const TrendingFeed = ({ filter }: TrendingFeedProps) => {
  const { data, isLoading } = useQuery({
    queryKey: ['trending-feed', filter],
    queryFn: async () => {
      // Try to get data from Supabase 
      const adjustedFilter = 
        filter === 'vehicles' ? 'vehicle' : 
        filter === 'auctions' ? 'auction' : 
        filter === 'events' ? 'event' : 
        filter === 'garages' ? 'garage' : filter;
      
      // Get content with most interactions
      const { data: interactionData, error: interactionError } = await supabase
        .from('content_interactions')
        .select('content_id, count')
        .gt('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()) // Past week
        .order('count', { ascending: false })
        .limit(10);
      
      if (!interactionError && interactionData && interactionData.length > 0) {
        const contentIds = interactionData.map(item => item.content_id);
        
        let query = supabase
          .from('explore_content')
          .select('*')
          .in('id', contentIds);
        
        // Apply filter if not 'all'
        if (adjustedFilter !== 'all') {
          query = query.eq('type', adjustedFilter);
        }
        
        const { data, error } = await query;
        
        if (!error && data && data.length > 0) {
          // Transform to ContentCardItem format
          return data.map(item => ({
            id: item.id,
            type: item.type,
            title: item.title,
            subtitle: item.subtitle,
            image: item.image_url,
            tags: item.tags || [],
            reason: 'Hot topic in the automotive community',
            location: item.location,
            relevanceScore: item.relevance_score,
            trending: '+' + Math.floor(Math.random() * 200 + 100) + '% views'
          }));
        }
      }
      
      console.log('Falling back to mock trending feed data');
      // Fallback to mock data
      return [
        {
          id: '1',
          type: 'auction',
          title: 'Rare Ferrari F40 Auction',
          subtitle: 'One of the most iconic supercars',
          image: 'https://images.unsplash.com/photo-1669367379640-0f4873e61d18?auto=format&fit=crop&w=600&q=80',
          tags: ['Supercar', 'Collector', 'Trending'],
          reason: 'Gaining significant attention this week',
          location: 'Miami, FL',
          trending: '+248% views',
          relevanceScore: 95
        },
        {
          id: '2',
          type: 'event',
          title: 'International Auto Show',
          subtitle: 'Featuring 2025 model reveals',
          image: 'https://images.unsplash.com/photo-1577371241476-12c4494ebcfb?auto=format&fit=crop&w=600&q=80',
          tags: ['Exhibition', 'New Models', 'Industry'],
          reason: 'Hot topic in the automotive community',
          location: 'New York, NY',
          trending: '+186% registrations',
          relevanceScore: 90
        },
        {
          id: '3',
          type: 'vehicle',
          title: 'Rivian R1T',
          subtitle: 'Electric adventure vehicle',
          image: 'https://images.unsplash.com/photo-1629829453215-9aaa196543ca?auto=format&fit=crop&w=600&q=80',
          tags: ['Electric', 'Off-road', 'Innovative'],
          reason: 'Rapidly gaining interest in the market',
          location: 'Denver, CO',
          trending: '+162% searches',
          relevanceScore: 88
        },
        {
          id: '4',
          type: 'garage',
          title: 'Quantum Performance Labs',
          subtitle: 'Cutting-edge vehicle modifications',
          image: 'https://images.unsplash.com/photo-1593174255631-66106f8a2c67?auto=format&fit=crop&w=600&q=80',
          tags: ['Performance', 'Innovation', 'Premium'],
          reason: 'Becoming popular among enthusiasts',
          location: 'Austin, TX',
          trending: '+153% reviews',
          relevanceScore: 85
        },
        {
          id: '5',
          type: 'vehicle',
          title: 'Lucid Air Dream Edition',
          subtitle: 'Luxury electric sedan',
          image: 'https://images.unsplash.com/photo-1554996560-41f5023d85d8?auto=format&fit=crop&w=600&q=80',
          tags: ['Luxury', 'Electric', 'High-performance'],
          reason: 'Trending in luxury vehicle segment',
          location: 'San Diego, CA',
          trending: '+118% inquiries',
          relevanceScore: 82
        }
      ].filter(item => adjustedFilter === 'all' || item.type === adjustedFilter);
    }
  });
  
  // Loading state with skeleton UI
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-red-500" />
          <h3 className="text-xl font-medium">Trending Now</h3>
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
        <p className="text-muted-foreground">No trending content found for the selected filter.</p>
      </div>
    );
  }
  
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <TrendingUp className="h-5 w-5 text-red-500" />
        <h3 className="text-xl font-medium">Trending Now</h3>
        <span className="text-sm text-muted-foreground">
          ({data.length} items)
        </span>
      </div>
      
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {data.map(item => (
          <ContentCard 
            key={item.id} 
            item={item}
            showTrending
          />
        ))}
      </div>
    </div>
  );
};

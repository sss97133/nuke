
import React from 'react';
import { ContentCard } from '../content/ContentCard';
import { useQuery } from '@tanstack/react-query';
import { Loader2, TrendingUp } from 'lucide-react';

interface TrendingFeedProps {
  filter: string;
}

export const TrendingFeed = ({ filter }: TrendingFeedProps) => {
  const { data, isLoading } = useQuery({
    queryKey: ['trending-feed', filter],
    queryFn: async () => {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1200));
      
      // Mock data
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
          trending: '+248% views'
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
          trending: '+186% registrations'
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
          trending: '+162% searches'
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
          trending: '+153% reviews'
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
          trending: '+118% inquiries'
        }
      ].filter(item => filter === 'all' || item.type === filter);
    }
  });
  
  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
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
          <ContentCard key={item.id} item={item} showTrending />
        ))}
      </div>
    </div>
  );
};

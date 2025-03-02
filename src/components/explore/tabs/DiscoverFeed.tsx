
import React from 'react';
import { ContentCard } from '../content/ContentCard';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Compass } from 'lucide-react';

interface DiscoverFeedProps {
  filter: string;
}

export const DiscoverFeed = ({ filter }: DiscoverFeedProps) => {
  const { data, isLoading } = useQuery({
    queryKey: ['discover-feed', filter],
    queryFn: async () => {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 800));
      
      // Mock data for discovery - items outside user's normal interests
      return [
        {
          id: '1',
          type: 'vehicle',
          title: 'Vintage Volkswagen Microbus',
          subtitle: 'Fully restored classic',
          image: 'https://images.unsplash.com/photo-1550616543-4f6b3d16c38e?auto=format&fit=crop&w=600&q=80',
          tags: ['Vintage', 'Collector', 'Iconic'],
          reason: 'Expand your knowledge of classic vehicles',
          location: 'Portland, OR'
        },
        {
          id: '2',
          type: 'event',
          title: 'Off-Road Adventure Day',
          subtitle: 'Experience extreme terrain driving',
          image: 'https://images.unsplash.com/photo-1697527025456-c79ab0a15ab5?auto=format&fit=crop&w=600&q=80',
          tags: ['Off-road', 'Adventure', 'Experience'],
          reason: 'Something different you might enjoy',
          location: 'Moab, UT'
        },
        {
          id: '3',
          type: 'garage',
          title: 'Classic Restorations',
          subtitle: 'Specializing in vintage vehicle restoration',
          image: 'https://images.unsplash.com/photo-1607603750909-408e193868c7?auto=format&fit=crop&w=600&q=80',
          tags: ['Restoration', 'Vintage', 'Craftsmanship'],
          reason: 'Discover master craftspeople in automotive restoration',
          location: 'Charleston, SC'
        },
        {
          id: '4',
          type: 'auction',
          title: 'Motorcycle Collection Auction',
          subtitle: 'Rare vintage motorcycles',
          image: 'https://images.unsplash.com/photo-1558981806-ec527fa84c39?auto=format&fit=crop&w=600&q=80',
          tags: ['Motorcycles', 'Vintage', 'Collection'],
          reason: 'Broaden your automotive interests',
          location: 'Milwaukee, WI'
        },
        {
          id: '5',
          type: 'vehicle',
          title: 'Custom Hot Rod',
          subtitle: 'Award-winning custom build',
          image: 'https://images.unsplash.com/photo-1637511180523-99be8034700c?auto=format&fit=crop&w=600&q=80',
          tags: ['Custom', 'Hot Rod', 'Unique'],
          reason: 'Explore custom automotive culture',
          location: 'Las Vegas, NV'
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
          <ContentCard key={item.id} item={item} isDiscovery />
        ))}
      </div>
    </div>
  );
};

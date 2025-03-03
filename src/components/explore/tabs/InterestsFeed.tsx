
import React from 'react';
import { ContentCard } from '../content/ContentCard';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface InterestsFeedProps {
  filter: string;
}

interface ContentItem {
  id: string;
  type: string;
  title: string;
  subtitle: string;
  image_url: string;
  tags: string[];
  reason: string;
  location: string;
  relevance_score: number;
}

export const InterestsFeed = ({ filter }: InterestsFeedProps) => {
  const { data, isLoading, error } = useQuery({
    queryKey: ['interests-feed', filter],
    queryFn: async () => {
      try {
        // Build the query to fetch from Supabase
        let query = supabase.from('explore_content').select('*');
        
        // Apply filter if not 'all'
        if (filter !== 'all') {
          query = query.eq('type', filter);
        }
        
        // Order by relevance_score
        query = query.order('relevance_score', { ascending: false });
        
        const { data, error } = await query;
        
        if (error) throw error;
        
        // If no data from Supabase, return the mock data
        if (!data || data.length === 0) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          return [
            {
              id: '1',
              type: 'vehicle',
              title: '2023 Toyota Supra',
              subtitle: 'High-performance sports car',
              image_url: 'https://images.unsplash.com/photo-1612284421027-15b69bd01bbe?auto=format&fit=crop&w=600&q=80',
              tags: ['Premium', 'Sports', 'Rare'],
              reason: 'Based on your interest in performance vehicles',
              location: 'San Francisco, CA',
              relevance_score: 98
            },
            {
              id: '2',
              type: 'auction',
              title: 'Classic Mustang Auction',
              subtitle: 'Ends in 2 days',
              image_url: 'https://images.unsplash.com/photo-1581134723003-f910e6e8231f?auto=format&fit=crop&w=600&q=80',
              tags: ['Vintage', 'Auction', 'Rare'],
              reason: 'Similar to auctions you\'ve participated in',
              location: 'Los Angeles, CA',
              relevance_score: 94
            },
            {
              id: '3',
              type: 'event',
              title: 'Automotive Tech Conference',
              subtitle: 'July 15-17, 2024',
              image_url: 'https://images.unsplash.com/photo-1511578314322-379afb476865?auto=format&fit=crop&w=600&q=80',
              tags: ['Conference', 'Networking', 'Technology'],
              reason: 'Matches your professional development interests',
              location: 'Chicago, IL',
              relevance_score: 92
            },
            {
              id: '4',
              type: 'vehicle',
              title: '2022 Tesla Model 3',
              subtitle: 'Electric sedan with latest upgrades',
              image_url: 'https://images.unsplash.com/photo-1560958089-b8a1929cea89?auto=format&fit=crop&w=600&q=80',
              tags: ['Electric', 'Modern', 'High-tech'],
              reason: 'You viewed similar electric vehicles recently',
              location: 'Portland, OR',
              relevance_score: 89
            },
            {
              id: '5',
              type: 'garage',
              title: 'Advanced Performance Tuning',
              subtitle: 'Specializing in sports car modifications',
              image_url: 'https://images.unsplash.com/photo-1503596476-1c12a8ba09a9?auto=format&fit=crop&w=600&q=80',
              tags: ['Performance', '5-star', 'Custom'],
              reason: 'Matches your mechanical interests',
              location: 'Seattle, WA',
              relevance_score: 86
            }
          ].filter(item => filter === 'all' || item.type === filter);
        }
        
        return data as ContentItem[];
      } catch (error) {
        console.error('Error fetching interests feed:', error);
        throw error;
      }
    }
  });
  
  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  
  if (error) {
    return (
      <div className="text-center py-12 text-destructive">
        <p>Error loading content. Please try again later.</p>
      </div>
    );
  }
  
  if (!data || data.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">No content found matching your interests and filters.</p>
      </div>
    );
  }
  
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <h3 className="text-xl font-medium">Based on Your Interests</h3>
        <span className="text-sm text-muted-foreground">
          ({data.length} items)
        </span>
      </div>
      
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {data.map(item => (
          <ContentCard 
            key={item.id} 
            item={{
              id: item.id,
              type: item.type,
              title: item.title,
              subtitle: item.subtitle,
              image: item.image_url,
              tags: item.tags,
              reason: item.reason,
              location: item.location,
              relevanceScore: item.relevance_score
            }} 
          />
        ))}
      </div>
    </div>
  );
};

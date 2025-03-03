
import React, { useEffect, useRef, useCallback } from 'react';
import { ContentCard } from '../content/ContentCard';
import { Loader2 } from 'lucide-react';
import { useExploreFeed } from '../hooks/useExploreFeed';
import { Skeleton } from '@/components/ui/skeleton';

interface InterestsFeedProps {
  filter: string;
}

export const InterestsFeed = ({ filter }: InterestsFeedProps) => {
  const {
    feedItems,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    trackContentView,
    likeContent,
    shareContent,
    saveContent
  } = useExploreFeed({ 
    filter: filter === 'vehicles' ? 'vehicle' : 
           filter === 'auctions' ? 'auction' : 
           filter === 'events' ? 'event' : 
           filter === 'garages' ? 'garage' : 'all', 
    limit: 9 
  });

  // Create a ref for the sentinel element (last item)
  const observerRef = useRef<IntersectionObserver | null>(null);
  const lastItemRef = useCallback((node: HTMLDivElement | null) => {
    if (isLoading || isFetchingNextPage) return;
    
    // Disconnect the previous observer
    if (observerRef.current) observerRef.current.disconnect();
    
    // Create a new observer
    observerRef.current = new IntersectionObserver(entries => {
      // If the last item is visible and we have more pages
      if (entries[0].isIntersecting && hasNextPage) {
        fetchNextPage();
      }
    });
    
    // Observe the last item
    if (node) observerRef.current.observe(node);
  }, [isLoading, isFetchingNextPage, hasNextPage, fetchNextPage]);

  // Clean up observer on unmount
  useEffect(() => {
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, []);
  
  // Loading state with skeleton UI
  if (isLoading && feedItems.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
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
  
  if (isError) {
    return (
      <div className="text-center py-12 text-destructive">
        <p>Error loading content. Please try again later.</p>
      </div>
    );
  }
  
  if (!feedItems || feedItems.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">No content found matching your interests and filters.</p>
      </div>
    );
  }
  
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">
          ({feedItems.length} items)
        </span>
      </div>
      
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {feedItems.map((item, index) => {
          const isLastItem = index === feedItems.length - 1;
          
          return (
            <div 
              key={item.id} 
              ref={isLastItem ? lastItemRef : null}
            >
              <ContentCard 
                item={{
                  id: item.id,
                  type: item.type,
                  title: item.title,
                  subtitle: item.subtitle,
                  image: item.image_url,
                  tags: item.tags,
                  reason: item.reason || "Based on your interests",
                  location: item.location,
                  relevanceScore: item.relevance_score,
                  created_at: item.created_at,
                  creator_id: item.creator_id,
                  creator_name: item.creator_name,
                  creator_avatar: item.creator_avatar,
                  view_count: item.view_count,
                  like_count: item.like_count,
                  share_count: item.share_count,
                  save_count: item.save_count,
                  is_liked: item.is_liked,
                  is_saved: item.is_saved
                }} 
                onView={(id, type) => trackContentView(id, type)}
                onLike={(id, type) => likeContent(id, type)}
                onShare={(id, type) => shareContent(id, type)}
                onSave={(id, type) => saveContent(id, type)}
              />
            </div>
          );
        })}
      </div>
      
      {/* Loading indicator for infinite scroll */}
      {isFetchingNextPage && (
        <div className="flex justify-center py-4">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}
    </div>
  );
};

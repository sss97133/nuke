
import React, { useEffect, useRef, useCallback } from 'react';
import { ContentCard } from '../content/ContentCard';
import { Loader2 } from 'lucide-react';
import { useExploreFeed } from '../hooks/useExploreFeed';

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
  } = useExploreFeed({ filter, limit: 9 });

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
  
  if (isLoading && feedItems.length === 0) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
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
        <h3 className="text-xl font-medium">Based on Your Interests</h3>
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
                  relevanceScore: item.relevance_score
                }} 
                onView={trackContentView}
                onLike={likeContent}
                onShare={shareContent}
                onSave={saveContent}
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


import React from 'react';
import { useExploreFeed, ContentItem } from '../hooks/useExploreFeed';
import { ContentCard } from '../content/ContentCard';
import { Skeleton } from '@/components/ui/skeleton';
import { MessageCircle, Video } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface DiscoverFeedProps {
  filter: string;
}

export const DiscoverFeed: React.FC<DiscoverFeedProps> = ({ filter }) => {
  const { 
    feedItems, 
    fetchNextPage, 
    hasNextPage, 
    isFetchingNextPage,
    isLoading,
    isError,
    error,
    trackContentView,
    likeContent,
    shareContent,
    saveContent
  } = useExploreFeed({ 
    filter,
    // Add a specific flag to include streaming content
    includeStreams: true 
  });

  // Handle loading state
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array(6).fill(0).map((_, i) => (
          <Skeleton key={i} className="h-[320px] w-full rounded-md" />
        ))}
      </div>
    );
  }

  // Handle error state
  if (isError) {
    return (
      <Alert variant="destructive" className="my-4">
        <AlertDescription>
          {error instanceof Error ? error.message : 'Error loading discover feed'}
        </AlertDescription>
      </Alert>
    );
  }

  // Handle empty state
  if (feedItems.length === 0) {
    return (
      <div className="text-center py-12">
        <Video className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <h3 className="text-xl font-medium mb-2">No streams or content found</h3>
        <p className="text-muted-foreground">
          {filter !== 'all' 
            ? `No ${filter} content is currently available. Try a different filter.` 
            : 'No content is currently available. Check back later.'}
        </p>
      </div>
    );
  }

  // Transform the feed items to the format expected by ContentCard
  const contentCards = feedItems.map(item => ({
    id: item.id,
    type: item.type,
    title: item.title,
    subtitle: item.subtitle,
    image: item.image_url,
    tags: item.tags,
    reason: item.reason,
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
  }));

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {contentCards.map(item => (
          <ContentCard 
            key={item.id}
            item={item}
            onView={(id, type) => trackContentView(id, type)}
            onLike={(id, type) => likeContent(id, type)}
            onShare={(id, type) => shareContent(id, type)}
            onSave={(id, type) => saveContent(id, type)}
          />
        ))}
      </div>
      
      {hasNextPage && (
        <div className="flex justify-center pt-4">
          <button
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
          >
            {isFetchingNextPage ? 'Loading more...' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
};

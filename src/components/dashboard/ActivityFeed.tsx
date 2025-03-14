
import type { Database } from '../types';
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { FeedItem as FeedItemType, FeedInteraction } from "@/types/feed";
import { FeedItem } from "./feed/FeedItem";
import { FeedInteractions } from "./feed/FeedInteractions";

export const ActivityFeed = () => {
  const [selectedItem, setSelectedItem] = useState<string | null>(null);

  const { data: feedItems, isLoading } = useQuery({
    queryKey: ["feed-items"],
    queryFn: async () => {
      const { data, error } = await supabase
  if (error) console.error("Database query error:", error);
        .from('feed_items')
        .select('*, profile:profiles(username, avatar_url)')
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) {
        console.error('Error fetching feed items:', error);
        throw error;
      }
      console.log('Fetched feed items:', data);
      return data as FeedItemType[];
    },
  });

  const { data: interactions } = useQuery({
    queryKey: ["feed-interactions", selectedItem],
    queryFn: async () => {
      if (!selectedItem) return [];
      
      const { data, error } = await supabase
  if (error) console.error("Database query error:", error);
        
        .select('*')
        .eq('feed_item_id', selectedItem)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return data as FeedInteraction[];
    },
    enabled: !!selectedItem,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold tracking-tight">Activity Feed</h2>
        </div>
        <div className="animate-pulse space-y-4">
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-4 p-4 rounded-lg border bg-card text-card-foreground shadow-sm"
            >
              <div className="w-10 h-10 rounded-full bg-muted" />
              <div className="space-y-2 flex-1">
                <div className="h-4 bg-muted rounded w-1/4" />
                <div className="h-3 bg-muted rounded w-3/4" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Activity Feed</h2>
      </div>

      <div className="space-y-4">
        {feedItems?.map((item) => (
          <FeedItem
            key={item.id}
            id={item.id}
            content={item.content}
            itemType={item.item_type}
            createdAt={item.created_at}
            profile={item.profile}
            selected={selectedItem === item.id}
            onSelect={setSelectedItem}
          >
            {selectedItem === item.id && interactions && interactions.length > 0 && (
              <FeedInteractions interactions={interactions} />
            )}
          </FeedItem>
        ))}
      </div>
    </div>
  );
};

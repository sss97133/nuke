import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarImage } from "@/components/ui/avatar";
import {
  Car,
  Package,
  Tool,
  MessageSquare,
  Star,
  Activity,
  User,
} from "lucide-react";
import { useState } from "react";

interface Profile {
  username: string | null;
  avatar_url: string | null;
}

interface FeedItem {
  id: string;
  user_id: string;
  item_type: string;
  item_id: string;
  content: string;
  metadata: any;
  created_at: string;
  profile: Profile | null;
}

interface FeedInteraction {
  id: string;
  feed_item_id: string;
  interaction_type: string;
  content?: string;
  created_at: string;
}

export const ActivityFeed = () => {
  const [selectedItem, setSelectedItem] = useState<string | null>(null);

  const { data: feedItems, isLoading } = useQuery({
    queryKey: ["feed-items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('feed_items')
        .select(`
          *,
          profile:profiles!feed_items_user_id_fkey (
            username,
            avatar_url
          )
        `)
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) throw error;
      return data as FeedItem[];
    },
  });

  const { data: interactions } = useQuery({
    queryKey: ["feed-interactions", selectedItem],
    queryFn: async () => {
      if (!selectedItem) return [];
      
      const { data, error } = await supabase
        .from('feed_interactions')
        .select('*')
        .eq('feed_item_id', selectedItem)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return data as FeedInteraction[];
    },
    enabled: !!selectedItem,
  });

  const getItemIcon = (type: string) => {
    switch (type) {
      case 'vehicle':
        return <Car className="w-4 h-4" />;
      case 'inventory':
        return <Package className="w-4 h-4" />;
      case 'service':
        return <Tool className="w-4 h-4" />;
      case 'comment':
        return <MessageSquare className="w-4 h-4" />;
      case 'achievement':
        return <Star className="w-4 h-4" />;
      case 'profile':
        return <User className="w-4 h-4" />;
      default:
        return <Activity className="w-4 h-4" />;
    }
  };

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
          <div
            key={item.id}
            className="rounded-lg border bg-card text-card-foreground shadow-sm"
            onClick={() => setSelectedItem(item.id)}
          >
            <div className="flex items-center justify-between text-sm p-2 hover:bg-accent/50 rounded-md transition-colors">
              <div className="flex items-center gap-3">
                <Avatar className="w-8 h-8">
                  <AvatarImage src={item.profile?.avatar_url || undefined} alt={item.profile?.username || undefined} />
                </Avatar>
                <div>
                  <div className="flex items-center gap-2">
                    {getItemIcon(item.item_type)}
                    <span className="font-medium">{item.profile?.username || 'Anonymous'}</span>
                  </div>
                  <p className="text-muted-foreground">{item.content}</p>
                  <span className="text-xs text-muted-foreground">
                    {new Date(item.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>

            {selectedItem === item.id && interactions && interactions.length > 0 && (
              <div className="border-t p-2 space-y-2">
                {interactions.map((interaction) => (
                  <div key={interaction.id} className="text-sm pl-12">
                    <p className="text-muted-foreground">{interaction.content}</p>
                    <span className="text-xs text-muted-foreground">
                      {new Date(interaction.created_at).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
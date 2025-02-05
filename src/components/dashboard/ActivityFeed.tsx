import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { 
  Activity, AlertCircle, CheckCircle2, Clock, MessageCircle, 
  Heart, DollarSign, Map, Video, Coins 
} from "lucide-react";
import { useState } from "react";

interface FeedItem {
  id: string;
  user_id: string;
  item_type: string;
  item_id: string;
  content: string;
  metadata: any;
  created_at: string;
  profiles?: {
    username: string;
    avatar_url: string;
  };
}

interface FeedInteraction {
  id: string;
  feed_item_id: string;
  user_id: string;
  interaction_type: string;
  content?: string;
  amount?: number;
  created_at: string;
}

export const ActivityFeed = () => {
  const { toast } = useToast();
  const [newComment, setNewComment] = useState("");
  const [selectedItem, setSelectedItem] = useState<string | null>(null);

  const { data: feedItems } = useQuery({
    queryKey: ['feed_items'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('feed_items')
        .select(`
          *,
          profiles:user_id (
            username,
            avatar_url
          )
        `)
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) {
        toast({
          title: 'Error loading feed',
          description: error.message,
          variant: 'destructive',
        });
        throw error;
      }
      return data as FeedItem[];
    },
  });

  const { data: interactions } = useQuery({
    queryKey: ['feed_interactions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('feed_interactions')
        .select('*')
        .order('created_at', { ascending: true });

      if (error) {
        toast({
          title: 'Error loading interactions',
          description: error.message,
          variant: 'destructive',
        });
        throw error;
      }
      return data as FeedInteraction[];
    },
  });

  const getItemIcon = (type: string) => {
    switch (type) {
      case 'service':
        return <Wrench className="w-4 h-4 text-blue-500" />;
      case 'location':
        return <Map className="w-4 h-4 text-green-500" />;
      case 'studio':
        return <Video className="w-4 h-4 text-purple-500" />;
      case 'market':
        return <Coins className="w-4 h-4 text-yellow-500" />;
      case 'profile':
        return <Activity className="w-4 h-4 text-pink-500" />;
      default:
        return <AlertCircle className="w-4 h-4 text-gray-500" />;
    }
  };

  const handleAddComment = async (feedItemId: string) => {
    if (!newComment.trim()) return;

    const { error } = await supabase
      .from('feed_interactions')
      .insert({
        feed_item_id: feedItemId,
        user_id: (await supabase.auth.getUser()).data.user?.id,
        interaction_type: 'comment',
        content: newComment,
      });

    if (error) {
      toast({
        title: 'Error adding comment',
        description: error.message,
        variant: 'destructive',
      });
      return;
    }

    setNewComment('');
    setSelectedItem(null);
    toast({
      title: 'Comment added',
      description: 'Your comment has been added successfully.',
    });
  };

  const handleTip = async (feedItemId: string) => {
    const { error } = await supabase
      .from('feed_interactions')
      .insert({
        feed_item_id: feedItemId,
        user_id: (await supabase.auth.getUser()).data.user?.id,
        interaction_type: 'tip',
        amount: 1, // Default tip amount
      });

    if (error) {
      toast({
        title: 'Error sending tip',
        description: error.message,
        variant: 'destructive',
      });
      return;
    }

    toast({
      title: 'Tip sent',
      description: 'Your tip has been sent successfully.',
    });
  };

  const getItemInteractions = (itemId: string) => {
    return interactions?.filter(i => i.feed_item_id === itemId) || [];
  };

  return (
    <div className="border border-border rounded-lg p-4 bg-background shadow-sm space-y-4">
      <div className="flex items-center gap-2 text-sm font-medium border-b border-border pb-2 mb-3">
        <Activity className="w-4 h-4" />
        <span>Activity Feed</span>
      </div>

      <div className="space-y-4">
        {feedItems?.map((item) => (
          <div key={item.id} className="space-y-2">
            <div className="flex items-center justify-between text-sm p-2 hover:bg-accent/50 rounded-md transition-colors">
              <div className="flex items-center gap-3">
                <Avatar className="w-8 h-8">
                  <img src={item.profiles?.avatar_url} alt={item.profiles?.username} />
                </Avatar>
                <div>
                  <div className="flex items-center gap-2">
                    {getItemIcon(item.item_type)}
                    <span className="font-medium">{item.profiles?.username}</span>
                  </div>
                  <p className="text-muted-foreground">{item.content}</p>
                  <span className="text-xs text-muted-foreground">
                    {new Date(item.created_at).toLocaleString()}
                  </span>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedItem(selectedItem === item.id ? null : item.id)}
                >
                  <MessageCircle className="w-4 h-4 mr-1" />
                  {getItemInteractions(item.id).filter(i => i.interaction_type === 'comment').length}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleTip(item.id)}
                >
                  <DollarSign className="w-4 h-4 mr-1" />
                  {getItemInteractions(item.id).filter(i => i.interaction_type === 'tip').length}
                </Button>
              </div>
            </div>

            {selectedItem === item.id && (
              <div className="ml-11 space-y-2">
                {getItemInteractions(item.id)
                  .filter(i => i.interaction_type === 'comment')
                  .map(interaction => (
                    <div key={interaction.id} className="text-sm text-muted-foreground bg-accent/20 p-2 rounded">
                      {interaction.content}
                    </div>
                  ))}
                <div className="flex gap-2">
                  <Input
                    placeholder="Add a comment..."
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    className="text-sm"
                  />
                  <Button size="sm" onClick={() => handleAddComment(item.id)}>
                    Comment
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
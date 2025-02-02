import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatDistance } from "date-fns";
import { MessageSquare, Reply, Trash2 } from "lucide-react";

interface Profile {
  username: string | null;
  avatar_url: string | null;
}

interface Comment {
  id: string;
  comment: string;
  created_at: string;
  user_id: string;
  parent_comment_id: string | null;
  profiles?: Profile | null;
}

export const AuctionComments = ({ auctionId }: { auctionId: string }) => {
  const { toast } = useToast();
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setCurrentUserId(user?.id ?? null);
    });
    fetchComments();
    subscribeToComments();
  }, [auctionId]);

  const fetchComments = async () => {
    const { data, error } = await supabase
      .from("auction_comments")
      .select(`
        id,
        comment,
        created_at,
        user_id,
        parent_comment_id,
        profiles:user_id (
          username,
          avatar_url
        )
      `)
      .eq("auction_id", auctionId)
      .order("created_at", { ascending: true });

    if (error) {
      toast({
        title: "Error fetching comments",
        description: error.message,
        variant: "destructive",
      });
      return;
    }

    if (data) {
      setComments(data as Comment[]);
    }
  };

  const subscribeToComments = () => {
    const channel = supabase
      .channel("auction_comments")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "auction_comments",
          filter: `auction_id=eq.${auctionId}`,
        },
        () => {
          fetchComments();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  };

  const handleSubmitComment = async () => {
    if (!newComment.trim()) return;

    const { error } = await supabase.from("auction_comments").insert([
      {
        auction_id: auctionId,
        comment: newComment,
        parent_comment_id: replyTo,
      },
    ]);

    if (error) {
      toast({
        title: "Error posting comment",
        description: error.message,
        variant: "destructive",
      });
      return;
    }

    setNewComment("");
    setReplyTo(null);
  };

  const handleDeleteComment = async (commentId: string) => {
    const { error } = await supabase
      .from("auction_comments")
      .delete()
      .eq("id", commentId);

    if (error) {
      toast({
        title: "Error deleting comment",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const renderComment = (comment: Comment, level = 0) => {
    const replies = comments.filter(
      (c) => c.parent_comment_id === comment.id
    );

    return (
      <div
        key={comment.id}
        className={`space-y-2 ${level > 0 ? "ml-8 border-l pl-4" : ""}`}
      >
        <div className="flex items-start space-x-4">
          <Avatar className="h-8 w-8">
            <AvatarImage src={comment.profiles?.avatar_url ?? undefined} />
            <AvatarFallback>
              {comment.profiles?.username?.[0]?.toUpperCase() || "U"}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 space-y-1">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">
                {comment.profiles?.username || "Anonymous"}
              </p>
              <span className="text-xs text-muted-foreground">
                {formatDistance(new Date(comment.created_at), new Date(), {
                  addSuffix: true,
                })}
              </span>
            </div>
            <p className="text-sm text-foreground/90">{comment.comment}</p>
            <div className="flex items-center space-x-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2"
                onClick={() => setReplyTo(comment.id)}
              >
                <Reply className="mr-2 h-4 w-4" />
                Reply
              </Button>
              {currentUserId === comment.user_id && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-destructive"
                  onClick={() => handleDeleteComment(comment.id)}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </Button>
              )}
            </div>
          </div>
        </div>
        {replies.map((reply) => renderComment(reply, level + 1))}
      </div>
    );
  };

  const rootComments = comments.filter((c) => !c.parent_comment_id);

  return (
    <div className="space-y-4">
      <div className="flex items-center space-x-2">
        <MessageSquare className="h-5 w-5" />
        <h3 className="text-lg font-semibold">Comments</h3>
      </div>

      <div className="space-y-4">
        <Textarea
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          placeholder={
            replyTo
              ? "Write a reply..."
              : "Share your thoughts about this auction..."
          }
          className="min-h-[100px]"
        />
        <div className="flex justify-between items-center">
          {replyTo && (
            <Button
              variant="ghost"
              onClick={() => setReplyTo(null)}
            >
              Cancel Reply
            </Button>
          )}
          <Button onClick={handleSubmitComment}>
            Post {replyTo ? "Reply" : "Comment"}
          </Button>
        </div>
      </div>

      <div className="space-y-6">
        {rootComments.map((comment) => renderComment(comment))}
      </div>
    </div>
  );
};
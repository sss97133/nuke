import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { formatDistanceToNow } from "date-fns";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageSquare, Reply } from "lucide-react";

interface Profile {
  username: string;
  avatar_url: string;
}

interface Comment {
  id: string;
  comment: string;
  created_at: string;
  user_id: string;
  parent_comment_id: string | null;
  profiles: Profile;
}

interface AuctionCommentsProps {
  auctionId: string;
}

export const AuctionComments = ({ auctionId }: AuctionCommentsProps) => {
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    fetchComments();
  }, [auctionId]);

  const fetchComments = async () => {
    const { data, error } = await supabase
      .from("auction_comments")
      .select(`
        *,
        profiles:user_id (
          username,
          avatar_url
        )
      `)
      .eq("auction_id", auctionId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Error fetching comments:", error);
      return;
    }

    if (data) {
      setComments(data as unknown as Comment[]);
    }
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
        title: "Error",
        description: "Failed to post comment. Please try again.",
        variant: "destructive",
      });
      return;
    }

    setNewComment("");
    setReplyTo(null);
    fetchComments();
  };

  const handleReply = (commentId: string) => {
    setReplyTo(commentId);
  };

  const renderComment = (comment: Comment) => {
    const replies = comments.filter((c) => c.parent_comment_id === comment.id);
    const profile = comment.profiles || { username: "Unknown", avatar_url: "" };

    return (
      <div key={comment.id} className="space-y-4">
        <div className="flex items-start space-x-4 group hover:bg-accent/50 p-2 rounded-lg transition-colors">
          <Avatar className="h-8 w-8">
            <AvatarImage src={profile.avatar_url} />
            <AvatarFallback>{profile.username[0]}</AvatarFallback>
          </Avatar>
          <div className="flex-1 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-medium">{profile.username}</span>
              <span className="text-sm text-muted-foreground">
                {formatDistanceToNow(new Date(comment.created_at), {
                  addSuffix: true,
                })}
              </span>
            </div>
            <p className="text-sm">{comment.comment}</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleReply(comment.id)}
              className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <Reply className="w-4 h-4 mr-1" />
              Reply
            </Button>
          </div>
        </div>

        {replies.length > 0 && (
          <div className="ml-12 space-y-4">
            {replies.map((reply) => renderComment(reply))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4 bg-card p-4 rounded-lg border">
      <h3 className="text-lg font-semibold flex items-center">
        <MessageSquare className="w-5 h-5 mr-2" />
        Comments
      </h3>
      
      <div className="flex items-center space-x-2">
        <Textarea
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          placeholder={
            replyTo
              ? "Write a reply..."
              : "Write a comment about this auction..."
          }
          className="flex-1 resize-none"
          rows={2}
        />
        <div className="flex flex-col space-y-2">
          <Button onClick={handleSubmitComment}>
            {replyTo ? "Reply" : "Comment"}
          </Button>
          {replyTo && (
            <Button variant="ghost" onClick={() => setReplyTo(null)}>
              Cancel
            </Button>
          )}
        </div>
      </div>

      <ScrollArea className="h-[300px] pr-4">
        <div className="space-y-6">
          {comments
            .filter((c) => !c.parent_comment_id)
            .map((comment) => renderComment(comment))}
        </div>
      </ScrollArea>
    </div>
  );
};
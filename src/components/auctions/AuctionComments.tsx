import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { checkQueryError } from '@/utils/supabase-helpers';
import { formatDistanceToNow } from 'date-fns';

interface AuctionCommentsProps {
  auctionId: string;
}

interface CommentType {
  id: string;
  comment: string;
  created_at: string;
  user_id: string;
  parent_comment_id: string | null;
  profiles?: {
    username: string;
    avatar_url: string;
    full_name: string;
  };
  replies?: CommentType[];
}

interface User {
  id: string;
  email: string;
  full_name: string;
  avatar_url?: string;
  role: string;
  created_at: string;
}

export const AuctionComments: React.FC<AuctionCommentsProps> = ({ auctionId }) => {
  const [comments, setComments] = useState<CommentType[]>([]);
  const [newComment, setNewComment] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [replyTo, setReplyTo] = useState<string | null>(null);

  useEffect(() => {
    fetchComments();
    fetchCurrentUser();
  }, [auctionId]);

  const fetchCurrentUser = async () => {
    try {
      const { data: { user }, error } = await supabase.auth.getUser();
      checkQueryError(error);
      
      if (user) {
        setCurrentUser(user);
      }
    } catch (err) {
      console.error('Error fetching current user:', err);
    }
  };

  const fetchComments = async () => {
    try {
      setLoading(true);
      
      const { data, error } = await supabase
        .from('auction_comments')
        .select(`
          *,
          profiles:profiles(username, avatar_url, full_name)
        `)
        .eq('auction_id', auctionId)
        .order('created_at', { ascending: true });
      
      checkQueryError(error);
      
      if (data) {
        // Organize comments into a hierarchy
        const rootComments: CommentType[] = [];
        const commentMap: Record<string, CommentType> = {};
        
        // First pass: create a map of all comments
        data.forEach((comment: CommentType) => {
          commentMap[comment.id] = { ...comment, replies: [] };
        });
        
        // Second pass: build the hierarchy
        data.forEach((comment: CommentType) => {
          const processedComment = commentMap[comment.id];
          
          if (comment.parent_comment_id) {
            // This is a reply, add it to its parent's replies
            if (commentMap[comment.parent_comment_id]) {
              commentMap[comment.parent_comment_id].replies?.push(processedComment);
            }
          } else {
            // This is a root comment
            rootComments.push(processedComment);
          }
        });
        
        setComments(rootComments);
      }
    } catch (err) {
      console.error('Error fetching comments:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitComment = async () => {
    if (!newComment.trim() || !currentUser) return;
    
    try {
      setSubmitting(true);
      
      const commentData = {
        auction_id: auctionId,
        user_id: currentUser.id,
        comment: newComment.trim(),
        parent_comment_id: replyTo
      };
      
      const { error } = await supabase
        .from('auction_comments')
        .insert(commentData);
      
      checkQueryError(error);
      
      // Clear form and refresh comments
      setNewComment('');
      setReplyTo(null);
      fetchComments();
    } catch (err) {
      console.error('Error submitting comment:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const renderComment = (comment: CommentType) => {
    const createdAt = new Date(comment.created_at);
    const timeAgo = formatDistanceToNow(createdAt, { addSuffix: true });
    
    return (
      <div key={comment.id} className="mb-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <Avatar className="h-8 w-8">
                {comment.profiles?.avatar_url && (
                  <AvatarImage src={comment.profiles.avatar_url} alt={comment.profiles.username || 'User'} />
                )}
                <AvatarFallback>
                  {(comment.profiles?.username?.[0] || 'U').toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">
                    {comment.profiles?.full_name || comment.profiles?.username || 'Anonymous'}
                  </span>
                  <span className="text-xs text-muted-foreground">{timeAgo}</span>
                </div>
                <p className="mt-1">{comment.comment}</p>
                {currentUser && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="mt-1 h-auto p-0 text-xs text-muted-foreground"
                    onClick={() => setReplyTo(comment.id)}
                  >
                    Reply
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
        
        {/* Render replies */}
        {comment.replies && comment.replies.length > 0 && (
          <div className="ml-8 mt-2">
            {comment.replies.map(reply => renderComment(reply))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <h3 className="text-xl font-semibold">Comments</h3>
      
      {currentUser && (
        <div className="space-y-2">
          <Textarea
            placeholder={replyTo ? "Write a reply..." : "Add a comment..."}
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            className="min-h-[100px]"
          />
          <div className="flex items-center justify-between">
            {replyTo && (
              <Button variant="ghost" onClick={() => setReplyTo(null)}>
                Cancel Reply
              </Button>
            )}
            <Button 
              onClick={handleSubmitComment} 
              disabled={submitting || !newComment.trim()}
            >
              {submitting ? 'Posting...' : replyTo ? 'Post Reply' : 'Post Comment'}
            </Button>
          </div>
        </div>
      )}
      
      {loading ? (
        <p className="text-center text-muted-foreground">Loading comments...</p>
      ) : comments.length > 0 ? (
        <div>
          {comments.map(comment => renderComment(comment))}
        </div>
      ) : (
        <p className="text-center text-muted-foreground">No comments yet. Be the first to comment!</p>
      )}
    </div>
  );
};

export default AuctionComments;
